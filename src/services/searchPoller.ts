// Live Twitter search poller — realtime alerts only.
//
// Flow per query:
//   1. Search Latest with the query's pinned (or rotated) auth account.
//   2. If lastTweetId is empty → seed watermark only (no Telegram flood).
//   3. Else keep every tweet with snowflake id > lastTweetId (order-independent).
//   4. Save SearchHit + Telegram alert to the query's topicId.
//   5. Advance lastTweetId only forward (max of previous watermark and seen ids).
//   6. Prune SearchHit to latest SEARCH_HIT_KEEP rows per query (default 20).

import { prisma } from "../db/prisma.js";
import { getTwitterClientById, markRateLimited } from "../twitter/getClient.js";
import type { TweetData } from "../TwitterClient/types.js";
import { formatSearchAlert } from "./formatAlert.js";
import { sendTelegramAlert, isAlertEnabled } from "../tg/sendAlert.js";
import {
  postedAt,
  toSnowflake,
  maxSnowflake,
  filterNewerThan,
  isDuplicateKeyError,
  nextWatermark,
} from "./pollerCore.js";

/** Max recent hits kept per query for the admin feed (not full history). */
const SEARCH_HIT_KEEP = Math.max(
  1,
  Number(process.env.SEARCH_HIT_KEEP ?? 20),
);

async function sendSearchAlert(
  row: { query: string; label: string | null; topicId: number | null; alertEnabled: boolean },
  tweet: TweetData,
): Promise<void> {
  if (!row.alertEnabled) return;
  if (!(await isAlertEnabled("search"))) return;

  const msg = formatSearchAlert({
    query: row.query,
    label: row.label,
    username: tweet.author.username,
    name: tweet.author.name ?? tweet.author.username,
    text: tweet.text,
    tweetId: tweet.id,
  });

  const thread = row.topicId ?? undefined;
  await sendTelegramAlert(msg, "MarkdownV2", thread, "search");
}

export interface PollResult {
  newHits: number;
  seeded?: boolean;
  alerted?: number;
  fetched?: number;
  error?: string;
  /** Items that failed to persist for a non-duplicate reason (watermark held). */
  failed?: number;
}

/** Poll one search query. Pass `force` to ignore the per-query interval. */
export async function pollSearchQuery(
  queryId: bigint,
  opts: { force?: boolean } = {},
): Promise<PollResult> {
  const row = await prisma.searchQuery.findUnique({ where: { id: queryId } });
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
    await prisma.searchQuery.update({
      where: { id: queryId },
      data: { lastError: msg, lastPolledAt: new Date() },
    });
    return { newHits: 0, error: msg };
  }

  const res = await client.search(row.query, 40);
  if (res.rateLimit && res.rateLimit.remaining === 0) {
    await markRateLimited(accountId, res.rateLimit.reset);
  }

  if (!res.success) {
    const msg = res.error ?? "search failed";
    await prisma.searchQuery.update({
      where: { id: queryId },
      data: { lastError: msg, lastPolledAt: new Date() },
    });
    return { newHits: 0, error: msg };
  }

  const tweets = res.tweets ?? [];
  const fetched = tweets.length;
  const pageNewest = maxSnowflake(tweets.map((t) => t.id));

  // ── First poll: seed watermark only (no history flood) ──
  if (!row.lastTweetId) {
    await prisma.searchQuery.update({
      where: { id: queryId },
      data: {
        lastPolledAt: new Date(),
        lastTweetId: pageNewest,
        lastError: fetched === 0 ? "search returned 0 tweets (check query syntax)" : null,
      },
    });
    console.log(
      `[search] query ${queryId} "${row.query}" seeded lastTweetId=${pageNewest ?? "none"} (fetched=${fetched})`,
    );
    return { newHits: 0, seeded: true, alerted: 0, fetched };
  }

  // ── Subsequent polls: every id > watermark ──
  const fresh = filterNewerThan(tweets, row.lastTweetId);
  // Chronological send order (oldest first).
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
      await prisma.searchHit.create({
        data: {
          queryId,
          tweetId: t.id,
          username: t.author.username,
          name: t.author.name ?? "",
          text: t.text,
          postedAt: postedAt(t),
        },
      });
      created = true;
      newHits += 1;
      processedIds.push(t.id);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // Expected: unique (queryId, tweetId) — already stored, so it counts
        // as handled and the watermark can move past it.
        processedIds.push(t.id);
      } else {
        // A real write failure. Do NOT let the watermark skip this tweet.
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        firstFailure ??= msg;
        console.error(`[search] hit persist failed for ${t.id}:`, msg);
      }
    }

    if (created) {
      try {
        await sendSearchAlert(row, t);
        alerted += 1;
      } catch (err) {
        console.error(
          `[search] telegram alert failed for ${t.id}:`,
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

  await prisma.searchQuery.update({
    where: { id: queryId },
    data: {
      lastPolledAt: new Date(),
      ...(advanceTo != null ? { lastTweetId: advanceTo } : {}),
      lastError:
        failed > 0
          ? `${failed} hit(s) failed to persist; watermark held. First: ${firstFailure}`
          : fetched === 0
            ? "search returned 0 tweets (check query / operators; use -filter:replies not -is:reply)"
            : null,
      ...(newHits > 0 ? { hitCount: { increment: newHits } } : {}),
    },
  });

  // Realtime only — drop older hits so the table stays small
  if (newHits > 0) {
    await pruneSearchHits(queryId, SEARCH_HIT_KEEP);
  }

  console.log(
    `[search] query ${queryId} "${row.query}": fetched=${fetched} fresh=${fresh.length} ` +
      `new=${newHits} alerted=${alerted} failed=${failed} watermark ${row.lastTweetId} → ` +
      (advanceTo ?? `${row.lastTweetId} (held)`),
  );

  return { newHits, alerted, fetched, ...(failed > 0 ? { failed } : {}) };
}

/** Keep only the newest `keep` SearchHit rows for a query (by createdAt, then id). */
export async function pruneSearchHits(
  queryId: bigint,
  keep = SEARCH_HIT_KEEP,
): Promise<number> {
  const survivors = await prisma.searchHit.findMany({
    where: { queryId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: keep,
    select: { id: true },
  });
  if (survivors.length === 0) return 0;

  const keepIds = survivors.map((r) => r.id);
  const result = await prisma.searchHit.deleteMany({
    where: {
      queryId,
      id: { notIn: keepIds },
    },
  });
  if (result.count > 0) {
    console.log(
      `[search] pruned ${result.count} old hits for query ${queryId} (keep ${keep})`,
    );
  }
  return result.count;
}

/** One-shot prune for all queries (e.g. after deploy). */
export async function pruneAllSearchHits(keep = SEARCH_HIT_KEEP): Promise<number> {
  const queries = await prisma.searchQuery.findMany({ select: { id: true } });
  let deleted = 0;
  for (const q of queries) {
    deleted += await pruneSearchHits(q.id, keep);
  }
  return deleted;
}

/** Poll every enabled query that is due. */
export async function pollAllSearchQueries(opts: { force?: boolean } = {}): Promise<{
  queries: number;
  newHits: number;
}> {
  const rows = await prisma.searchQuery.findMany({
    where: { enabled: true },
    orderBy: { lastPolledAt: { sort: "asc", nulls: "first" } },
  });

  let newHits = 0;
  for (const row of rows) {
    try {
      const r = await pollSearchQuery(row.id, opts);
      newHits += r.newHits;
      if (r.error) console.warn(`[search] query ${row.id} "${row.query}": ${r.error}`);
    } catch (err) {
      console.error(`[search] query ${row.id} failed:`, err);
    }
  }
  // Safety prune (covers queries that got hits earlier / bulk backlog)
  await pruneAllSearchHits(SEARCH_HIT_KEEP);
  console.log(`[search] polled ${rows.length} queries, ${newHits} new hits`);
  return { queries: rows.length, newHits };
}
