// HomeLatest timeline signal scanner.
//
// Per tag: pin an auth account that follows projects of that tag.
// Poll getHomeLatestTimeline → only tweets with snowflake id > lastTweetId →
// detectSignalsWithRules(tag) → PostAlert + Telegram "signal".
//
// Auto-follow is OFF by default; enable on SignalScan.autoFollow.
// Manual follow via followProjectForTag().

import { prisma } from "../db/prisma.js";
import type { TweetData } from "../TwitterClient/types.js";
import {
  getTwitterClientById,
  markRateLimited,
  markAuthInvalid,
} from "../twitter/getClient.js";
import { isTwitterAuthError } from "../TwitterClient/TwitterClient.js";
import { detectSignalsWithRules } from "./signalRules.js";
import { formatSignalAlert } from "./formatAlert.js";
import { sendTelegramAlert, topicForSlug, isAlertEnabled } from "../tg/sendAlert.js";
import { prunePostAlertsForSlug, pruneAllPostAlerts } from "./postAlerts.js";

function toId(id: string): bigint {
  try {
    return BigInt(id);
  } catch {
    return 0n;
  }
}

function maxTweetId(tweets: TweetData[]): string | null {
  let max: bigint | undefined;
  let maxStr: string | null = null;
  for (const t of tweets) {
    const n = toId(t.id);
    if (max === undefined || n > max) {
      max = n;
      maxStr = t.id;
    }
  }
  return maxStr;
}

function postedAt(tweet: TweetData): Date | null {
  if (!tweet.createdAt) return null;
  const d = new Date(tweet.createdAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function pollSignalScan(scanId: bigint): Promise<{
  fetched: number;
  fresh: number;
  alerted: number;
  seeded?: boolean;
  error?: string;
}> {
  const scan = await prisma.signalScan.findUnique({ where: { id: scanId } });
  if (!scan || !scan.enabled) return { fetched: 0, fresh: 0, alerted: 0 };

  if (scan.lastPolledAt) {
    const elapsed = Date.now() - scan.lastPolledAt.getTime();
    if (elapsed < scan.intervalSec * 1000) {
      return { fetched: 0, fresh: 0, alerted: 0 };
    }
  }

  let client;
  let accountId: bigint;
  try {
    const resolved = await getTwitterClientById(scan.authAccountId);
    client = resolved.client;
    accountId = resolved.accountId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.signalScan.update({
      where: { id: scanId },
      data: { lastError: msg, lastPolledAt: new Date() },
    });
    return { fetched: 0, fresh: 0, alerted: 0, error: msg };
  }

  const res = await client.getHomeLatestTimeline(40, {
    enableRanking: false,
    includePromotedContent: false,
  });

  if (res.rateLimit && res.rateLimit.remaining === 0) {
    await markRateLimited(accountId, res.rateLimit.reset);
  }

  if (!res.success) {
    const msg = res.error ?? "HomeLatestTimeline failed";
    if (isTwitterAuthError(msg)) await markAuthInvalid(accountId, msg);
    await prisma.signalScan.update({
      where: { id: scanId },
      data: { lastError: msg, lastPolledAt: new Date() },
    });
    return { fetched: 0, fresh: 0, alerted: 0, error: msg };
  }

  const tweets = res.tweets ?? [];
  const newest = maxTweetId(tweets) ?? res.nextCursor ?? null;

  // First poll: seed watermark only (no history flood)
  if (!scan.lastTweetId) {
    await prisma.signalScan.update({
      where: { id: scanId },
      data: {
        lastTweetId: newest,
        lastPolledAt: new Date(),
        lastError:
          tweets.length === 0
            ? "HomeLatest returned 0 tweets — follow projects first"
            : null,
      },
    });
    return { fetched: tweets.length, fresh: 0, alerted: 0, seeded: true };
  }

  const cutoff = toId(scan.lastTweetId);
  // New tweet ids always greater than old tweet id (snowflake)
  const fresh = tweets
    .filter((t) => toId(t.id) > cutoff)
    .sort((a, b) => (toId(a.id) < toId(b.id) ? -1 : 1));

  let alerted = 0;
  for (const tweet of fresh) {
    const did = await handleHomeTweet(scan.tagSlug, tweet, {
      alertEnabled: scan.alertEnabled,
      topicId: scan.topicId,
    });
    if (did) alerted++;
  }

  // Advance watermark only forward
  const advanced =
    newest && toId(newest) > cutoff ? newest : scan.lastTweetId;

  await prisma.signalScan.update({
    where: { id: scanId },
    data: {
      lastTweetId: advanced,
      lastPolledAt: new Date(),
      lastError: null,
      ...(alerted > 0 ? { hitCount: { increment: alerted } } : {}),
    },
  });

  return { fetched: tweets.length, fresh: fresh.length, alerted };
}

/**
 * Pipeline for one new HomeLatest tweet:
 *   1) skip if already alerted (PostAlert tweetId)
 *   2) run rules: generic mint/wl/… + tag-specific
 *   3) if any match → save PostAlert + Telegram "signal"
 */
async function handleHomeTweet(
  tagSlug: string,
  tweet: TweetData,
  opts: { alertEnabled: boolean; topicId: number | null },
): Promise<boolean> {
  const seen = await prisma.postAlert.findUnique({ where: { tweetId: tweet.id } });
  if (seen) return false;

  // Check mint live, public mint, wl application, whitelist open, tge, …
  const signals = await detectSignalsWithRules(tweet.text, tagSlug);
  if (signals.length === 0) return false;

  const username = (tweet.author.username || "").toLowerCase();
  if (!username) return false;

  const accountRow = await prisma.twitterAccount.findUnique({
    where: { username },
    select: { id: true },
  });
  const accountId = accountRow?.id ?? tweet.author.username;

  try {
    await prisma.postAlert.create({
      data: {
        tweetId: tweet.id,
        accountId,
        username: tweet.author.username,
        slug: tagSlug,
        signals,
        text: tweet.text,
        postedAt: postedAt(tweet),
      },
    });
  } catch {
    return false;
  }
  // Signals Feed: keep only latest 20 posts per tag
  try {
    await prunePostAlertsForSlug(tagSlug);
  } catch (err) {
    console.warn(`[signal-scan] prune slug=${tagSlug}:`, err);
  }

  if (!opts.alertEnabled) {
    console.log(
      `[signal-scan] matched @${tweet.author.username} ${signals.join(",")} (tg off for scan)`,
    );
    return true;
  }
  if (!(await isAlertEnabled("signal"))) {
    console.log(
      `[signal-scan] matched @${tweet.author.username} ${signals.join(",")} (global signal alert disabled)`,
    );
    return true;
  }

  const thread =
    opts.topicId != null ? opts.topicId : await topicForSlug(tagSlug);

  await sendTelegramAlert(
    formatSignalAlert({
      accountId,
      username: tweet.author.username,
      name: tweet.author.name || tweet.author.username,
      slug: tagSlug,
      signals,
      text: tweet.text,
      tweetId: tweet.id,
    }),
    "MarkdownV2",
    thread,
    "signal",
  );
  console.log(
    `[signal-scan] TG alert @${tweet.author.username} signals=[${signals.join(", ")}] tag=${tagSlug}`,
  );
  return true;
}

export async function pollAllSignalScans(): Promise<{
  polled: number;
  alerted: number;
  errors: number;
}> {
  const scans = await prisma.signalScan.findMany({
    where: { enabled: true },
    orderBy: { lastPolledAt: { sort: "asc", nulls: "first" } },
  });

  let polled = 0;
  let alerted = 0;
  let errors = 0;
  for (const s of scans) {
    try {
      const r = await pollSignalScan(s.id);
      polled++;
      alerted += r.alerted;
      if (r.error) errors++;
    } catch (err) {
      errors++;
      console.error(`[signal-scan] ${s.tagSlug} failed:`, err);
    }
  }
  // Cap feed storage: latest 20 PostAlerts per tag slug
  try {
    const pruned = await pruneAllPostAlerts();
    if (pruned > 0) {
      console.log(`[signal-scan] feed prune deleted=${pruned}`);
    }
  } catch (err) {
    console.warn("[signal-scan] feed prune failed:", err);
  }

  console.log(
    `[signal-scan] polled=${polled} alerted=${alerted} errors=${errors}`,
  );
  return { polled, alerted, errors };
}

/**
 * Follow a project with the auth account bound to a tag (or explicit auth).
 * Used by manual UI and optional auto-follow.
 *
 * If tag has no SignalScan yet but authAccountId is provided, creates the
 * scan binding automatically (autoFollow stays false).
 */
export async function followProjectForTag(opts: {
  twitterUserId: string;
  username: string;
  tagSlug: string;
  authAccountId?: bigint;
  source?: "manual" | "auto_classify";
  /** When true and no scan exists, create SignalScan for tag+auth. Default true for manual. */
  ensureScan?: boolean;
}): Promise<{ ok: boolean; error?: string; authUsername?: string }> {
  const tagSlug = opts.tagSlug.trim().toLowerCase();
  let scan = await prisma.signalScan.findUnique({
    where: { tagSlug },
  });

  let authId = opts.authAccountId ?? scan?.authAccountId;

  // Manual follow can create the tag→auth binding on the fly
  if (authId == null && opts.authAccountId == null) {
    return {
      ok: false,
      error:
        `No auth bound for tag “${tagSlug}”. Open Tag → Auth, pick an auth account for “${tagSlug}”, save, then try again — or pass authAccountId.`,
    };
  }

  if (authId != null && !scan && (opts.ensureScan ?? opts.source === "manual")) {
    const auth = await prisma.twitterAuthAccount.findUnique({
      where: { id: authId },
    });
    if (!auth) {
      return { ok: false, error: "auth_account_not_found" };
    }
    scan = await prisma.signalScan.create({
      data: {
        tagSlug,
        authAccountId: authId,
        enabled: true,
        autoFollow: false,
        alertEnabled: true,
      },
    });
    console.log(
      `[signal-scan] auto-created scan tag=${tagSlug} auth=@${auth.username}`,
    );
  }

  authId = opts.authAccountId ?? scan?.authAccountId;
  if (authId == null) {
    return {
      ok: false,
      error: `No auth bound for tag “${tagSlug}”. Assign an auth account on Tag → Auth first.`,
    };
  }

  const existing = await prisma.authFollow.findUnique({
    where: {
      authAccountId_twitterUserId: {
        authAccountId: authId,
        twitterUserId: opts.twitterUserId,
      },
    },
  });
  if (existing) {
    return { ok: true };
  }

  try {
    const { client, username: authUsername } =
      await getTwitterClientById(authId);
    const res = await client.follow(opts.twitterUserId);
    if (!res.success) {
      const msg = res.error ?? "follow failed";
      if (isTwitterAuthError(msg)) await markAuthInvalid(authId, msg);
      return { ok: false, error: msg };
    }

    await prisma.authFollow.create({
      data: {
        authAccountId: authId,
        twitterUserId: opts.twitterUserId,
        username: opts.username.toLowerCase().replace(/^@/, ""),
        tagSlug,
        source: opts.source ?? "manual",
      },
    });
    return { ok: true, authUsername };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * After classify/reclassify: if any tag has SignalScan.autoFollow, follow
 * with that tag's auth. Default autoFollow=false so this is a no-op until enabled.
 */
export async function maybeAutoFollowForTags(
  twitterUserId: string,
  username: string,
  tags: string[],
): Promise<void> {
  for (const tag of tags) {
    if (!tag || tag === "unknown" || tag === "alpha") continue;
    const scan = await prisma.signalScan.findUnique({
      where: { tagSlug: tag },
      select: { autoFollow: true, enabled: true, authAccountId: true },
    });
    if (!scan?.autoFollow || !scan.enabled) continue;
    const r = await followProjectForTag({
      twitterUserId,
      username,
      tagSlug: tag,
      source: "auto_classify",
    });
    if (r.ok) {
      console.log(
        `[signal-scan] auto-follow @${username} for tag=${tag} via auth`,
      );
    } else {
      console.warn(
        `[signal-scan] auto-follow @${username} tag=${tag} failed: ${r.error}`,
      );
    }
  }
}
