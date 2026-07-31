// Public Twitter list monitor poller — realtime timeline alerts.
//
// Flow per monitor:
//   1. ListLatestTweetsTimeline with pinned (or rotated) auth.
//   2. If lastTweetId empty → seed watermark only (no Telegram flood).
//   3. Else keep tweets with snowflake id > lastTweetId.
//   4. Save ListMonitorHit + Telegram alert to the monitor's topicId.
//   5. Advance lastTweetId only forward.
//   6. Prune hits to latest LIST_MONITOR_HIT_KEEP rows per monitor.

import { prisma } from "../db/prisma.js";
import { getTwitterClientById, markRateLimited } from "../twitter/getClient.js";
import type { TweetData } from "../TwitterClient/types.js";
import { formatListMonitorAlert } from "./formatAlert.js";
import { sendTelegramAlert, isAlertEnabled } from "../tg/sendAlert.js";
import {
  postedAt,
  toSnowflake,
  maxSnowflake,
  filterNewerThan,
  isDuplicateKeyError,
  nextWatermark,
} from "./pollerCore.js";

const TWEETS_PER_POLL = Math.max(
  10,
  Number(process.env.LIST_MONITOR_POLL_COUNT ?? 40),
);

const LIST_MONITOR_HIT_KEEP = Math.max(
  1,
  Number(process.env.LIST_MONITOR_HIT_KEEP ?? 20),
);

/**
 * Accept raw list id or x.com/i/lists/<id> URL.
 * Returns digits-only list rest id or null.
 */
export function parseTwitterListId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{5,30}$/.test(s)) return s;

  // https://x.com/i/lists/123… or twitter.com/i/lists/123…
  const path = s.match(/(?:x|twitter)\.com\/i\/lists\/(\d{5,30})/i);
  if (path?.[1]) return path[1];

  // https://x.com/user/lists/slug-1234567890
  const named = s.match(/(?:x|twitter)\.com\/[^/]+\/lists\/[^/\s]*?(\d{5,30})\b/i);
  if (named?.[1]) return named[1];

  // Loose: last long digit run
  const loose = s.match(/(\d{5,30})(?!.*\d)/);
  return loose?.[1] ?? null;
}

async function sendListAlert(
  row: {
    twitterListId: string;
    label: string | null;
    listName: string | null;
    topicId: number | null;
    alertEnabled: boolean;
  },
  tweet: TweetData,
): Promise<void> {
  if (!row.alertEnabled) return;
  if (!(await isAlertEnabled("listMonitor"))) return;

  const msg = formatListMonitorAlert({
    listId: row.twitterListId,
    label: row.label ?? row.listName,
    username: tweet.author.username,
    name: tweet.author.name ?? tweet.author.username,
    text: tweet.text,
    tweetId: tweet.id,
  });

  const thread = row.topicId ?? undefined;
  await sendTelegramAlert(msg, "MarkdownV2", thread, "listMonitor");
}

export interface ListMonitorPollResult {
  newHits: number;
  seeded?: boolean;
  alerted?: number;
  fetched?: number;
  error?: string;
}

/** Poll one list monitor. Pass `force` to ignore the per-list interval. */
export async function pollListMonitor(
  monitorId: bigint,
  opts: { force?: boolean } = {},
): Promise<ListMonitorPollResult> {
  const row = await prisma.listMonitor.findUnique({ where: { id: monitorId } });
  if (!row || !row.enabled) return { newHits: 0 };

  if (!opts.force && row.lastPolledAt) {
    const elapsed = Date.now() - row.lastPolledAt.getTime();
    if (elapsed < row.intervalSec * 1000) {
      return { newHits: 0 };
    }
  }

  let client;
  let accountId: bigint;
  try {
    const resolved = await getTwitterClientById(row.authAccountId);
    client = resolved.client;
    accountId = resolved.accountId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.listMonitor.update({
      where: { id: monitorId },
      data: { lastError: msg, lastPolledAt: new Date() },
    });
    return { newHits: 0, error: msg };
  }

  const res = await client.getListTweets(row.twitterListId, TWEETS_PER_POLL);
  if (res.rateLimit && res.rateLimit.remaining === 0) {
    await markRateLimited(accountId, res.rateLimit.reset);
  }

  if (!res.success) {
    const msg = res.error ?? "list timeline failed";
    await prisma.listMonitor.update({
      where: { id: monitorId },
      data: { lastError: msg, lastPolledAt: new Date() },
    });
    return { newHits: 0, error: msg };
  }

  const tweets = res.tweets ?? [];
  const fetched = tweets.length;
  const pageNewest = maxSnowflake(tweets.map((t) => t.id));

  // Optional: refresh list display name once in a while when empty.
  let listName = row.listName;
  if (!listName) {
    try {
      const meta = await client.getList(row.twitterListId);
      if (meta.success && meta.list?.name) {
        listName = meta.list.name;
      }
    } catch {
      // non-fatal
    }
  }

  if (!row.lastTweetId) {
    await prisma.listMonitor.update({
      where: { id: monitorId },
      data: {
        lastPolledAt: new Date(),
        lastTweetId: pageNewest,
        listName: listName ?? row.listName,
        lastError:
          fetched === 0
            ? "list returned 0 tweets (private/empty list or bad id?)"
            : null,
      },
    });
    console.log(
      `[list-monitor] ${monitorId} list=${row.twitterListId} seeded lastTweetId=${pageNewest ?? "none"} (fetched=${fetched})`,
    );
    return { newHits: 0, seeded: true, alerted: 0, fetched };
  }

  const fresh = filterNewerThan(tweets, row.lastTweetId);
  fresh.sort((a, b) => {
    const an = toSnowflake(a.id) ?? 0n;
    const bn = toSnowflake(b.id) ?? 0n;
    return an < bn ? -1 : an > bn ? 1 : 0;
  });

  let newHits = 0;
  let alerted = 0;
  // Ids we durably handled — the watermark may only advance over these.
  const processedIds: string[] = [];
  let failed = 0;
  let firstFailure: string | null = null;

  for (const t of fresh) {
    let created = false;
    try {
      await prisma.listMonitorHit.create({
        data: {
          monitorId,
          tweetId: t.id,
          username: t.author.username,
          name: t.author.name ?? "",
          text: t.text,
          authorId: null,
          postedAt: postedAt(t),
        },
      });
      created = true;
      newHits += 1;
      processedIds.push(t.id);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // Expected: unique (monitorId, tweetId) — already stored.
        processedIds.push(t.id);
      } else {
        // A real write failure. Do NOT let the watermark skip this tweet.
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        firstFailure ??= msg;
        console.error(`[list-monitor] hit persist failed for ${t.id}:`, msg);
      }
    }

    if (created) {
      try {
        await sendListAlert(
          {
            twitterListId: row.twitterListId,
            label: row.label,
            listName: listName ?? row.listName,
            topicId: row.topicId,
            alertEnabled: row.alertEnabled,
          },
          t,
        );
        alerted += 1;
      } catch (err) {
        console.error(
          `[list-monitor] telegram alert failed for ${t.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // Hold the watermark when anything failed, so the next cycle retries instead
  // of stepping over tweets that were never stored.
  const advanceTo = nextWatermark({
    previous: row.lastTweetId,
    processedIds,
    pageNewest,
    failedCount: failed,
  });

  await prisma.listMonitor.update({
    where: { id: monitorId },
    data: {
      lastPolledAt: new Date(),
      ...(advanceTo != null ? { lastTweetId: advanceTo } : {}),
      listName: listName ?? row.listName,
      lastError:
        failed > 0
          ? `${failed} hit(s) failed to persist; watermark held. First: ${firstFailure}`
          : fetched === 0
            ? "list returned 0 tweets (private/empty list or bad id?)"
            : null,
      ...(newHits > 0 ? { hitCount: { increment: newHits } } : {}),
    },
  });

  if (newHits > 0) {
    await pruneListMonitorHits(monitorId, LIST_MONITOR_HIT_KEEP);
  }

  console.log(
    `[list-monitor] ${monitorId} list=${row.twitterListId}: fetched=${fetched} fresh=${fresh.length} ` +
      `new=${newHits} alerted=${alerted} failed=${failed} watermark ${row.lastTweetId} → ` +
      (advanceTo ?? `${row.lastTweetId} (held)`),
  );

  return { newHits, alerted, fetched };
}

export async function pruneListMonitorHits(
  monitorId: bigint,
  keep = LIST_MONITOR_HIT_KEEP,
): Promise<number> {
  const survivors = await prisma.listMonitorHit.findMany({
    where: { monitorId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: keep,
    select: { id: true },
  });
  if (survivors.length === 0) return 0;

  const keepIds = survivors.map((r) => r.id);
  const result = await prisma.listMonitorHit.deleteMany({
    where: {
      monitorId,
      id: { notIn: keepIds },
    },
  });
  return result.count;
}

export async function pollAllListMonitors(opts: { force?: boolean } = {}): Promise<{
  monitors: number;
  newHits: number;
}> {
  const rows = await prisma.listMonitor.findMany({
    where: { enabled: true },
    orderBy: { lastPolledAt: { sort: "asc", nulls: "first" } },
  });

  let newHits = 0;
  for (const row of rows) {
    try {
      const r = await pollListMonitor(row.id, opts);
      newHits += r.newHits;
      if (r.error) {
        console.warn(
          `[list-monitor] ${row.id} list=${row.twitterListId}: ${r.error}`,
        );
      }
    } catch (err) {
      console.error(`[list-monitor] ${row.id} failed:`, err);
    }
  }
  console.log(`[list-monitor] polled ${rows.length} monitors, ${newHits} new hits`);
  return { monitors: rows.length, newHits };
}
