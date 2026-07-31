// Shared primitives for the snowflake-watermark pollers (search, list monitor,
// list, project monitor).
//
// These pollers all follow the same shape: fetch a page, keep the items newer
// than a stored watermark, persist + alert each one, then advance the watermark.
// The subtle part is step 4 — see `nextWatermark`.

import { Prisma } from "../generated/prisma/client.js";
import type { TweetData } from "../TwitterClient/types.js";

/** Sleep helper — pollers throttle between items to spread API load. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tweet's createdAt as a Date, or null when absent/unparseable. */
export function postedAt(tweet: TweetData): Date | null {
  if (!tweet.createdAt) return null;
  const d = new Date(tweet.createdAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a tweet id to a snowflake.
 *
 * Returns null (never 0n) on garbage: a 0n sentinel compares as "older than
 * everything", which silently makes every tweet look new.
 */
export function toSnowflake(id: string | null | undefined): bigint | null {
  if (!id) return null;
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

/** Max snowflake among a list of ids (null if none parse). */
export function maxSnowflake(ids: (string | null | undefined)[]): string | null {
  let best: bigint | null = null;
  let bestStr: string | null = null;
  for (const id of ids) {
    const n = toSnowflake(id);
    if (n == null) continue;
    if (best == null || n > best) {
      best = n;
      bestStr = id ?? null;
    }
  }
  return bestStr;
}

/**
 * Tweets newer than `lastTweetId`. Does NOT assume timeline order — collects
 * every item with id > watermark (search results can interleave modules).
 */
export function filterNewerThan(
  tweets: TweetData[],
  lastTweetId: string | null,
): TweetData[] {
  if (!lastTweetId) return [];
  const lastNum = toSnowflake(lastTweetId);
  if (lastNum == null) {
    return tweets.filter((t) => t.id !== lastTweetId);
  }
  return tweets.filter((t) => {
    const n = toSnowflake(t.id);
    if (n == null) return t.id !== lastTweetId;
    return n > lastNum;
  });
}

/**
 * True when a write failed only because the row already exists.
 *
 * The pollers deliberately re-insert already-seen items, so a unique-constraint
 * violation is the expected steady state and counts as "processed". Every OTHER
 * error is a real failure and must not be mistaken for a duplicate — that
 * conflation is what silently dropped tweets.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export interface NextWatermarkInput {
  /** Current stored watermark. */
  previous: string | null;
  /** Ids that were durably handled this pass (persisted, or already present). */
  processedIds: (string | null | undefined)[];
  /**
   * Newest id on the fetched page, regardless of whether it was handled.
   * Only safe to jump to when nothing failed — otherwise it skips past the
   * items that failed.
   */
  pageNewest?: string | null;
  /** Count of items that failed for a reason other than duplicate-key. */
  failedCount: number;
}

/**
 * Decide the next watermark, or null to mean "leave it alone and retry later".
 *
 * The rule that matters: when any item failed for a real reason, the watermark
 * must NOT advance. Previously these pollers advanced to the newest id on the
 * page unconditionally, so a transient DB error meant those tweets fell behind
 * the watermark and were never looked at again — silent, permanent data loss.
 *
 * Holding the watermark trades an at-least-once redelivery (harmless: inserts
 * are unique-guarded and dedupe as P2002) for never losing an item. The
 * watermark also never moves backwards.
 */
export function nextWatermark(input: NextWatermarkInput): string | null {
  const { previous, processedIds, pageNewest, failedCount } = input;

  // Something real failed — hold position so the next cycle retries.
  if (failedCount > 0) return null;

  // Nothing failed, so the whole page is accounted for.
  const candidates = [previous, ...processedIds, pageNewest ?? null];
  const best = maxSnowflake(candidates);
  if (best == null) return null;

  // Never regress.
  const bestNum = toSnowflake(best);
  const prevNum = toSnowflake(previous);
  if (bestNum != null && prevNum != null && bestNum <= prevNum) return null;

  return best === previous ? null : best;
}
