// Early-project real-time refresh via usersByIds (100/batch).
//
// Flow each hour:
//   1. Select early TwitterAccount rows only (detection rules from UI/settings)
//   2. getUsersByIds in batches of 100
//   3. Diff: username, bio, followers, tweetCount
//   4. If tweetCount ↑ → enqueue early-timeline jobs (getUserTweets ~50/15m)
//   5. Metric snapshots (for 7d growth reports)
//   6. Bio change → optional reclassify
//
// Timeline worker drains the queue under a 15-minute tweet-request budget so a
// 1k+ pool does not burn the UserTweets rate limit in one cycle.

import { prisma } from "../db/prisma.js";
import type { TweetData, UserData } from "../TwitterClient/types.js";
import {
  getTwitterClient,
  markRateLimited,
  markAuthInvalid,
} from "../twitter/getClient.js";
import { isTwitterAuthError } from "../TwitterClient/TwitterClient.js";
import { classifyAccount } from "./projectTagger.js";
import { detectSignalsWithRules } from "./signalRules.js";
import {
  evaluateSignalImportance,
  shouldPersistSignal,
  shouldTelegramSignal,
  toAlertImportanceView,
} from "./signalIntel.js";
import {
  formatSignalAlert,
  formatProfileChangeAlert,
  formatEarlyRawPostAlert,
} from "./formatAlert.js";
import {
  sendTelegramAlert,
  topicForSlug,
  isAlertEnabled,
} from "../tg/sendAlert.js";
import { prunePostAlertsForSlug } from "./postAlerts.js";
import {
  EARLY_MAX_FOLLOWERS,
  EARLY_MAX_FOLLOWING,
  EARLY_MAX_AGE_MS,
} from "./earlyProjectFilter.js";
import { getConfig, setConfig, CONFIG_KEYS } from "./appConfig.js";
import { enqueueJob } from "../enqueue.js";

/** Env defaults — overridden at runtime by settings (admin Early Monitor). */
const ENV_BATCH = Math.min(100, Math.max(10, Number(process.env.EARLY_POLL_BATCH ?? 100)));
const ENV_MAX_BATCHES = Math.max(1, Number(process.env.EARLY_POLL_MAX_BATCHES ?? 10));
const ENV_MAX_TIMELINES = Math.max(0, Number(process.env.EARLY_POLL_MAX_TIMELINES ?? 40));
const ENV_DELAY_MS = Math.max(0, Number(process.env.EARLY_POLL_DELAY_MS ?? 400));
const ENV_STALE_MS = Math.max(60_000, Number(process.env.EARLY_POLL_STALE_MS ?? 55 * 60 * 1000));
const ENV_MAX_AGE_MS = Number(process.env.EARLY_POLL_MAX_AGE_MS ?? EARLY_MAX_AGE_MS);
const ENV_MAX_FOLLOWERS = Number(process.env.EARLY_POLL_MAX_FOLLOWERS ?? EARLY_MAX_FOLLOWERS);
const ENV_MAX_FOLLOWING = Number(process.env.EARLY_POLL_MAX_FOLLOWING ?? EARLY_MAX_FOLLOWING);
const ENV_FIRST_SEEN_DAYS = Math.max(
  1,
  Number(process.env.EARLY_POLL_FIRST_SEEN_DAYS ?? 90),
);
const ENV_SNAPSHOT_MIN_MS = Math.max(
  60_000,
  Number(process.env.EARLY_SNAPSHOT_MIN_MS ?? 6 * 3600 * 1000),
);
/** Twitter UserTweets ~50 / 15 min — leave headroom. */
const ENV_TWEET_BUDGET = Math.min(
  50,
  Math.max(5, Number(process.env.EARLY_POLL_TWEET_BUDGET ?? 45)),
);
const TWEET_WINDOW_MS = 15 * 60 * 1000;

/** Resolved poller knobs for one cycle (DB settings → env fallback). */
export type EarlyPollRuntimeConfig = {
  batchSize: number;
  maxBatches: number;
  /** Max timelines processed inline per poll (rest always go to queue). */
  maxTimelines: number;
  delayMs: number;
  staleMs: number;
  maxAgeMs: number;
  maxAgeDays: number;
  maxFollowers: number;
  maxFollowing: number;
  firstSeenDays: number;
  /** soft/hot hunter stages always in pool (even if over age). */
  includeSoftHot: boolean;
  /** Drop soft/hot that exceed follower/following/age caps. */
  strictEarlyOnly: boolean;
  snapshotMinMs: number;
  maxAccountsPerCycle: number;
  signalTopicId: number | null;
  rawTopicId: number | null;
  sendRawPosts: boolean;
  tweetReqBudget: number;
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return fallback;
}

/** Live config for early poll (settings table wins over env). */
export async function resolveEarlyPollConfig(): Promise<EarlyPollRuntimeConfig> {
  const [
    batchRaw,
    maxBatchesRaw,
    maxTimelinesRaw,
    delayRaw,
    staleRaw,
    maxFollowersRaw,
    maxFollowingRaw,
    maxAgeDaysRaw,
    firstSeenDaysRaw,
    includeSoftHotRaw,
    strictEarlyOnlyRaw,
    snapshotRaw,
    signalTopicRaw,
    rawTopicRaw,
    sendRawRaw,
    tweetBudgetRaw,
  ] = await Promise.all([
    getConfig<number | null>(CONFIG_KEYS.earlyPollBatch, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollMaxBatches, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollMaxTimelines, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollDelayMs, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollStaleMs, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollMaxFollowers, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollMaxFollowing, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollMaxAgeDays, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollFirstSeenDays, null),
    getConfig<boolean | null>(CONFIG_KEYS.earlyPollIncludeSoftHot, null),
    getConfig<boolean | null>(CONFIG_KEYS.earlyPollStrictEarlyOnly, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollSnapshotMinMs, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollSignalTopicId, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollRawTopicId, null),
    getConfig<boolean | null>(CONFIG_KEYS.earlyPollSendRawPosts, null),
    getConfig<number | null>(CONFIG_KEYS.earlyPollTweetReqBudget, null),
  ]);

  const batchSize = clampInt(batchRaw ?? ENV_BATCH, 10, 100, ENV_BATCH);
  const maxBatches = clampInt(maxBatchesRaw ?? ENV_MAX_BATCHES, 1, 50, ENV_MAX_BATCHES);
  const maxTimelines = clampInt(
    maxTimelinesRaw ?? ENV_MAX_TIMELINES,
    0,
    500,
    ENV_MAX_TIMELINES,
  );
  const delayMs = clampInt(delayRaw ?? ENV_DELAY_MS, 0, 10_000, ENV_DELAY_MS);
  const staleMs = clampInt(staleRaw ?? ENV_STALE_MS, 60_000, 7 * 86400_000, ENV_STALE_MS);
  const maxFollowers = clampInt(
    maxFollowersRaw ?? ENV_MAX_FOLLOWERS,
    100,
    5_000_000,
    ENV_MAX_FOLLOWERS,
  );
  const maxFollowing = clampInt(
    maxFollowingRaw ?? ENV_MAX_FOLLOWING,
    100,
    5_000_000,
    ENV_MAX_FOLLOWING,
  );
  const maxAgeDays = clampInt(
    maxAgeDaysRaw ?? Math.round(ENV_MAX_AGE_MS / 86400_000),
    7,
    3650,
    Math.round(ENV_MAX_AGE_MS / 86400_000),
  );
  const firstSeenDays = clampInt(
    firstSeenDaysRaw ?? ENV_FIRST_SEEN_DAYS,
    1,
    3650,
    ENV_FIRST_SEEN_DAYS,
  );
  const snapshotMinMs = clampInt(
    snapshotRaw ?? ENV_SNAPSHOT_MIN_MS,
    60_000,
    7 * 86400_000,
    ENV_SNAPSHOT_MIN_MS,
  );
  const tweetReqBudget = clampInt(
    tweetBudgetRaw ?? ENV_TWEET_BUDGET,
    5,
    50,
    ENV_TWEET_BUDGET,
  );

  const signalTopicId =
    signalTopicRaw != null && Number.isFinite(Number(signalTopicRaw))
      ? Number(signalTopicRaw)
      : null;
  const rawTopicId =
    rawTopicRaw != null && Number.isFinite(Number(rawTopicRaw))
      ? Number(rawTopicRaw)
      : null;

  return {
    batchSize,
    maxBatches,
    maxTimelines,
    delayMs,
    staleMs,
    maxAgeMs: maxAgeDays * 86400_000,
    maxAgeDays,
    maxFollowers,
    maxFollowing,
    firstSeenDays,
    includeSoftHot: toBool(includeSoftHotRaw, true),
    strictEarlyOnly: toBool(strictEarlyOnlyRaw, true),
    snapshotMinMs,
    maxAccountsPerCycle: batchSize * maxBatches,
    signalTopicId,
    rawTopicId,
    sendRawPosts: toBool(sendRawRaw, false),
    tweetReqBudget,
  };
}

/** Claim one getUserTweets slot under the 15m budget. */
export async function claimTweetRequest(
  budget: number,
): Promise<{ ok: true } | { ok: false; waitMs: number; used: number; budget: number }> {
  const now = Date.now();
  const w = await getConfig<{ start: number; count: number } | null>(
    CONFIG_KEYS.earlyPollTweetReqWindow,
    null,
  );
  if (!w || now - w.start >= TWEET_WINDOW_MS) {
    await setConfig(CONFIG_KEYS.earlyPollTweetReqWindow, { start: now, count: 1 });
    return { ok: true };
  }
  if (w.count >= budget) {
    return {
      ok: false,
      waitMs: Math.max(5_000, TWEET_WINDOW_MS - (now - w.start) + 2_000),
      used: w.count,
      budget,
    };
  }
  await setConfig(CONFIG_KEYS.earlyPollTweetReqWindow, {
    start: w.start,
    count: w.count + 1,
  });
  return { ok: true };
}

/** True if account still matches early detection rules (for timeline jobs). */
export function accountMatchesEarlyRules(
  a: {
    followersCount: number | null;
    followingCount?: number | null;
    createdAt: Date | null;
    firstSeenAt: Date;
    huntStage: string;
  },
  cfg: EarlyPollRuntimeConfig,
): boolean {
  const overFollowers =
    a.followersCount != null && a.followersCount > cfg.maxFollowers;
  const overFollowing =
    a.followingCount != null && a.followingCount > cfg.maxFollowing;
  const ageMs = a.createdAt
    ? Date.now() - a.createdAt.getTime()
    : a.firstSeenAt
      ? Date.now() - a.firstSeenAt.getTime()
      : 0;
  const overAge = ageMs > cfg.maxAgeMs;

  if (cfg.includeSoftHot && (a.huntStage === "soft" || a.huntStage === "hot")) {
    if (cfg.strictEarlyOnly && (overFollowers || overFollowing || overAge)) {
      return false;
    }
    return true;
  }

  if (overFollowers || overFollowing || overAge) return false;
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toId(id: string): bigint {
  try {
    return BigInt(id);
  } catch {
    return 0n;
  }
}

function postedAt(tweet: TweetData): Date | null {
  if (!tweet.createdAt) return null;
  const d = new Date(tweet.createdAt);
  return Number.isNaN(d.getTime()) ? null : d;
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

function normBio(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function biosDiffer(a: string | null | undefined, b: string | null | undefined): boolean {
  return normBio(a) !== normBio(b);
}

/**
 * Free a username held by a stale/other rest-id row so the live account can claim it.
 * X usernames are unique at a point in time; our DB keeps history by rest id, so when
 * A renames to B's old handle (or B is deleted on X but still in DB), claim would collide.
 */
export async function freeUsernameIfHeldByOther(
  accountId: string,
  desiredUsername: string,
): Promise<void> {
  const key = desiredUsername.toLowerCase();
  const holder = await prisma.twitterAccount.findUnique({
    where: { username: key },
    select: { id: true, username: true },
  });
  if (!holder || holder.id === accountId) return;

  // Vacate: keep previousUsername for forensics; new username must stay unique.
  const vacated = `stale_${holder.id}`.slice(0, 64);
  // If that placeholder already exists (re-claim loop), make it unique.
  let freeName = vacated;
  const clash = await prisma.twitterAccount.findUnique({
    where: { username: freeName },
    select: { id: true },
  });
  if (clash && clash.id !== holder.id) {
    freeName = `stale_${holder.id}_${Date.now()}`.slice(0, 64);
  }

  await prisma.twitterAccount.update({
    where: { id: holder.id },
    data: {
      previousUsername: holder.username,
      username: freeName,
      usernameChangedAt: new Date(),
    },
  });
  console.warn(
    `[early-poll] vacated @${key} from id=${holder.id} → ${freeName} (claimed by id=${accountId})`,
  );
}

/** Update profile fields; resolves username unique conflicts safely. */
async function updateAccountProfile(
  accountId: string,
  data: {
    username: string;
    name: string;
    description: string | null;
    tags: string[];
    liveTweets: number | null;
    liveFollowers: number | null;
    followingCount: number | null | undefined;
    likeCount: number | null | undefined;
    isBlueVerified: boolean | null | undefined;
    profileImageUrl: string | null | undefined;
    profileBannerUrl: string | null | undefined;
    location: string | null | undefined;
    setFollowersAtDetect: number | null;
    renamed: boolean;
    previousUsername: string;
  },
): Promise<void> {
  await freeUsernameIfHeldByOther(accountId, data.username);

  const payload = {
    username: data.username,
    name: data.name,
    description: data.description,
    tags: data.tags,
    lastProfilePolledAt: new Date(),
    ...(data.liveTweets != null ? { tweetCount: data.liveTweets } : {}),
    ...(data.liveFollowers != null ? { followersCount: data.liveFollowers } : {}),
    ...(data.followingCount != null
      ? { followingCount: data.followingCount }
      : {}),
    ...(data.likeCount != null ? { likeCount: data.likeCount } : {}),
    ...(data.isBlueVerified != null
      ? { isBlueVerified: data.isBlueVerified }
      : {}),
    ...(data.profileImageUrl != null
      ? { profileImageUrl: data.profileImageUrl }
      : {}),
    ...(data.profileBannerUrl != null
      ? { profileBannerUrl: data.profileBannerUrl }
      : {}),
    ...(data.location != null ? { location: data.location } : {}),
    ...(data.setFollowersAtDetect != null
      ? { followersAtDetect: data.setFollowersAtDetect }
      : {}),
    ...(data.renamed
      ? {
          previousUsername: data.previousUsername,
          usernameChangedAt: new Date(),
        }
      : {}),
  };

  try {
    await prisma.twitterAccount.update({
      where: { id: accountId },
      data: payload,
    });
  } catch (err) {
    // Race: another row claimed the handle between free and update — retry once.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Unique constraint|username/i.test(msg)) throw err;
    await freeUsernameIfHeldByOther(accountId, data.username);
    await prisma.twitterAccount.update({
      where: { id: accountId },
      data: payload,
    });
  }
}

export type EarlyPollResult = {
  candidates: number;
  checked: number;
  skippedFresh: number;
  renames: number;
  bioChanges: number;
  followerJumps: number;
  timelines: number;
  timelinesQueued: number;
  signalAlerts: number;
  rawAlerts: number;
  snapshots: number;
  missing: number;
  /** Suspended / deleted on X — removed from DB. */
  deleted: number;
  errors: number;
  usersByIdsReqs: number;
};

/**
 * Account missing from UsersByRestIds (or UserUnavailable) = suspended / deactivated
 * / deleted on X. Remove from DB so early pool + joins stay clean.
 * Cascades: list_members, metric_snapshots, follow_edges, alerts (FK).
 * Also cleans post_alerts + project_monitors + auth_follows (no FK).
 */
export async function deleteUnavailableAccount(
  accountId: string,
  reason = "unavailable",
): Promise<boolean> {
  const row = await prisma.twitterAccount.findUnique({
    where: { id: accountId },
    select: { id: true, username: true },
  });
  if (!row) return false;

  try {
    await prisma.$transaction([
      prisma.postAlert.deleteMany({ where: { accountId } }),
      prisma.projectMonitor.deleteMany({ where: { twitterUserId: accountId } }),
      prisma.authFollow.deleteMany({ where: { twitterUserId: accountId } }),
      prisma.twitterAccount.delete({ where: { id: accountId } }),
    ]);
    console.warn(
      `[early-poll] deleted unavailable @${row.username} id=${accountId} (${reason})`,
    );
    return true;
  } catch (err) {
    console.error(
      `[early-poll] delete unavailable @${row.username} id=${accountId}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** True when getUserTweets / GraphQL error means the user is gone. */
export function isUserGoneError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("user is suspended") ||
    m.includes("account is suspended") ||
    m.includes("user not found") ||
    m.includes("could not find user") ||
    m.includes("no user matches") ||
    m.includes("user has been suspended") ||
    m.includes("account does not exist") ||
    m.includes("not found.") ||
    (m.includes("authorization") && m.includes("suspended"))
  );
}

/**
 * Early pool only — detection rules from UI (age, followers, following, soft/hot).
 * Ordered by oldest profile poll first (fair rotation).
 */
export async function selectEarlyProjectIds(
  limit: number,
  cfg: EarlyPollRuntimeConfig,
): Promise<string[]> {
  const staleBefore = new Date(Date.now() - cfg.staleMs);
  const minCreated = new Date(Date.now() - cfg.maxAgeMs);
  const minFirstSeen = new Date(Date.now() - cfg.firstSeenDays * 86400_000);

  const sizeAndAge = {
    AND: [
      {
        OR: [
          { followersCount: { lte: cfg.maxFollowers } },
          { followersCount: null },
        ],
      },
      {
        OR: [
          { followingCount: { lte: cfg.maxFollowing } },
          { followingCount: null },
        ],
      },
      {
        OR: [
          { createdAt: { gte: minCreated } },
          { createdAt: null },
          { firstSeenAt: { gte: minCreated } },
        ],
      },
    ],
  };

  // soft/hot: optional always-include; strictEarlyOnly still applies size/age
  const softHotClause = cfg.includeSoftHot
    ? cfg.strictEarlyOnly
      ? { AND: [{ huntStage: { in: ["soft", "hot"] } }, sizeAndAge] }
      : { huntStage: { in: ["soft", "hot"] } }
    : null;

  const earlyOr: object[] = [
    {
      AND: [
        sizeAndAge,
        {
          OR: [
            { firstSeenAt: { gte: minFirstSeen } },
            {
              AND: [
                { firstSeenAt: { gte: minCreated } },
                sizeAndAge,
              ],
            },
          ],
        },
      ],
    },
  ];
  if (softHotClause) earlyOr.unshift(softHotClause);

  const rows = await prisma.twitterAccount.findMany({
    where: {
      AND: [
        {
          OR: [
            { lastProfilePolledAt: null },
            { lastProfilePolledAt: { lte: staleBefore } },
          ],
        },
        { OR: earlyOr },
      ],
    },
    select: { id: true },
    orderBy: [
      { lastProfilePolledAt: { sort: "asc", nulls: "first" } },
      { firstSeenAt: "desc" },
    ],
    take: limit,
  });
  return rows.map((r) => r.id);
}

/** Shared Prisma where for pool stats / list API. */
export function earlyPoolWhereFromConfig(cfg: EarlyPollRuntimeConfig) {
  const minCreated = new Date(Date.now() - cfg.maxAgeMs);
  const minFirstSeen = new Date(Date.now() - cfg.firstSeenDays * 86400_000);
  const sizeAndAge = {
    AND: [
      {
        OR: [
          { followersCount: { lte: cfg.maxFollowers } },
          { followersCount: null },
        ],
      },
      {
        OR: [
          { followingCount: { lte: cfg.maxFollowing } },
          { followingCount: null },
        ],
      },
      {
        OR: [
          { createdAt: { gte: minCreated } },
          { createdAt: null },
          { firstSeenAt: { gte: minCreated } },
        ],
      },
    ],
  };
  const softHotClause = cfg.includeSoftHot
    ? cfg.strictEarlyOnly
      ? { AND: [{ huntStage: { in: ["soft", "hot"] } }, sizeAndAge] }
      : { huntStage: { in: ["soft", "hot"] } }
    : null;
  const earlyOr: object[] = [
    {
      AND: [sizeAndAge, { firstSeenAt: { gte: minFirstSeen } }],
    },
  ];
  if (softHotClause) earlyOr.unshift(softHotClause);
  return { OR: earlyOr };
}

/** Returns { wrote, jump } — jump = 2x or +500 followers since previous DB value. */
async function maybeSnapshot(
  accountId: string,
  u: UserData,
  prevFollowers: number | null | undefined,
  snapshotMinMs: number,
): Promise<{ wrote: boolean; jump: boolean }> {
  const followers = u.followersCount ?? null;
  const last = await prisma.accountMetricSnapshot.findFirst({
    where: { accountId },
    orderBy: { recordedAt: "desc" },
    select: { recordedAt: true, followersCount: true },
  });

  const now = Date.now();
  const followerDelta =
    followers != null && last?.followersCount != null
      ? Math.abs(followers - last.followersCount)
      : followers != null
        ? 999
        : 0;

  if (last && now - last.recordedAt.getTime() < snapshotMinMs && followerDelta < 50) {
    const jump =
      prevFollowers != null &&
      followers != null &&
      ((followers >= prevFollowers * 2 && followers - prevFollowers >= 200) ||
        followers - prevFollowers >= 500);
    return { wrote: false, jump };
  }

  await prisma.accountMetricSnapshot.create({
    data: {
      accountId,
      followersCount: followers,
      followingCount: u.followingCount ?? null,
      tweetCount: u.tweetCount ?? null,
      source: "poll",
    },
  });

  const jump =
    prevFollowers != null &&
    followers != null &&
    ((followers >= prevFollowers * 2 && followers - prevFollowers >= 200) ||
      followers - prevFollowers >= 500);

  return { wrote: true, jump };
}

async function resolveSignalThread(
  slug: string,
  cfg: EarlyPollRuntimeConfig,
): Promise<number | undefined> {
  if (cfg.signalTopicId != null) return cfg.signalTopicId;
  return topicForSlug(slug);
}

async function processNewTweets(opts: {
  accountId: string;
  username: string;
  name: string;
  tags: string[];
  lastTweetId: string | null;
  client: Awaited<ReturnType<typeof getTwitterClient>>["client"];
  authAccountId: bigint;
  cfg: EarlyPollRuntimeConfig;
}): Promise<{
  signalAlerts: number;
  rawAlerts: number;
  newestId: string | null;
  rateLimited: boolean;
  rateLimitWaitMs?: number;
  deleted?: boolean;
}> {
  const claim = await claimTweetRequest(opts.cfg.tweetReqBudget);
  if (!claim.ok) {
    return {
      signalAlerts: 0,
      rawAlerts: 0,
      newestId: opts.lastTweetId,
      rateLimited: true,
      rateLimitWaitMs: claim.waitMs,
    };
  }

  const res = await opts.client.getUserTweets(opts.accountId, 20);
  if (res.rateLimit && res.rateLimit.remaining === 0) {
    await markRateLimited(opts.authAccountId, res.rateLimit.reset);
    const resetMs =
      res.rateLimit.reset != null
        ? Math.max(5_000, res.rateLimit.reset * 1000 - Date.now() + 2_000)
        : TWEET_WINDOW_MS;
    return {
      signalAlerts: 0,
      rawAlerts: 0,
      newestId: opts.lastTweetId,
      rateLimited: true,
      rateLimitWaitMs: resetMs,
    };
  }
  if (!res.success) {
    const msg = res.error ?? "getUserTweets failed";
    if (isTwitterAuthError(msg)) await markAuthInvalid(opts.authAccountId, msg);
    if (isUserGoneError(msg)) {
      await deleteUnavailableAccount(opts.accountId, `tweets: ${msg}`);
      return {
        signalAlerts: 0,
        rawAlerts: 0,
        newestId: opts.lastTweetId,
        rateLimited: false,
        deleted: true,
      };
    }
    console.warn(`[early-poll] tweets @${opts.username}: ${msg}`);
    return {
      signalAlerts: 0,
      rawAlerts: 0,
      newestId: opts.lastTweetId,
      rateLimited: false,
    };
  }

  const tweets = res.tweets ?? [];
  const newest = maxTweetId(tweets);

  // First seed: set watermark only (no backlog flood)
  if (!opts.lastTweetId) {
    return {
      signalAlerts: 0,
      rawAlerts: 0,
      newestId: newest ?? opts.lastTweetId,
      rateLimited: false,
    };
  }

  const cutoff = toId(opts.lastTweetId);
  const fresh = tweets
    .filter((t) => toId(t.id) > cutoff)
    .sort((a, b) => (toId(a.id) < toId(b.id) ? -1 : 1));

  let signalAlerts = 0;
  let rawAlerts = 0;
  const tagSlugs = opts.tags.filter(
    (t) => t && t !== "unknown" && t !== "other" && t !== "alpha" && t !== "noise",
  );
  const primaryTag = tagSlugs[0] ?? null;

  for (const tweet of fresh) {
    const r = await handleProjectTweet({
      accountId: opts.accountId,
      username: opts.username,
      name: opts.name,
      tagSlugs,
      primaryTag,
      tweet,
      cfg: opts.cfg,
    });
    if (r === "signal") signalAlerts++;
    else if (r === "raw") rawAlerts++;
  }

  const advanced =
    newest && toId(newest) > cutoff ? newest : opts.lastTweetId;
  return {
    signalAlerts,
    rawAlerts,
    newestId: advanced,
    rateLimited: false,
  };
}

async function handleProjectTweet(opts: {
  accountId: string;
  username: string;
  name: string;
  tagSlugs: string[];
  primaryTag: string | null;
  tweet: TweetData;
  cfg: EarlyPollRuntimeConfig;
}): Promise<"signal" | "raw" | false> {
  const seen = await prisma.postAlert.findUnique({
    where: { tweetId: opts.tweet.id },
  });
  if (seen) return false;

  // Early mode: multi-tag + expand verticals when untagged; structural fallback
  const signals = await detectSignalsWithRules(opts.tweet.text, opts.tagSlugs, {
    mode: "early",
    structuralFallback: true,
  });

  // ── Signal path ────────────────────────────────────────────────────
  if (signals.length > 0) {
    const imp = evaluateSignalImportance({
      text: opts.tweet.text,
      signals,
      tagSlug: opts.primaryTag,
      isOfficialAuthor: true,
    });
    if (!shouldPersistSignal(imp)) {
      // Soft/drop signal — still allow raw path if enabled
      if (!opts.cfg.sendRawPosts) return false;
    } else {
      const slug =
        opts.primaryTag ??
        (imp.vertical !== "generic" ? imp.vertical : "early");
      const storeSignals = imp.displayLabels;

      try {
        await prisma.postAlert.create({
          data: {
            tweetId: opts.tweet.id,
            accountId: opts.accountId,
            username: opts.username,
            slug: `early:@${opts.username}`,
            signals: storeSignals,
            text: opts.tweet.text,
            postedAt: postedAt(opts.tweet),
          },
        });
      } catch {
        return false;
      }
      try {
        await prunePostAlertsForSlug(`early:@${opts.username}`);
      } catch {
        /* ignore */
      }

      if ((await isAlertEnabled("signal")) && shouldTelegramSignal(imp)) {
        const thread = await resolveSignalThread(slug, opts.cfg);
        try {
          await sendTelegramAlert(
            formatSignalAlert({
              accountId: opts.accountId,
              username: opts.username,
              name: opts.name,
              slug,
              signals: storeSignals,
              text: opts.tweet.text,
              tweetId: opts.tweet.id,
              importance: toAlertImportanceView(imp),
            }),
            "MarkdownV2",
            thread,
            "signal",
          );
        } catch (err) {
          console.warn(
            `[early-poll] signal TG @${opts.username}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      return "signal";
    }
  }

  // ── Raw / non-signal path (optional) ───────────────────────────────
  if (!opts.cfg.sendRawPosts) return false;

  try {
    await prisma.postAlert.create({
      data: {
        tweetId: opts.tweet.id,
        accountId: opts.accountId,
        username: opts.username,
        slug: `early-raw:@${opts.username}`,
        signals: ["raw"],
        text: opts.tweet.text,
        postedAt: postedAt(opts.tweet),
      },
    });
  } catch {
    return false;
  }
  try {
    await prunePostAlertsForSlug(`early-raw:@${opts.username}`);
  } catch {
    /* ignore */
  }

  const rawThread =
    opts.cfg.rawTopicId != null
      ? opts.cfg.rawTopicId
      : opts.cfg.signalTopicId != null
        ? opts.cfg.signalTopicId
        : await topicForSlug(opts.primaryTag ?? "early");

  try {
    await sendTelegramAlert(
      formatEarlyRawPostAlert({
        accountId: opts.accountId,
        username: opts.username,
        name: opts.name,
        text: opts.tweet.text,
        tweetId: opts.tweet.id,
        tags: opts.tagSlugs,
      }),
      "MarkdownV2",
      rawThread,
      "signal",
    );
  } catch (err) {
    console.warn(
      `[early-poll] raw TG @${opts.username}:`,
      err instanceof Error ? err.message : err,
    );
  }
  return "raw";
}

/**
 * Queue getUserTweets for one early account (deduped by jobId).
 * Used when tweetCount rises — respects UserTweets ~50/15m via claimTweetRequest.
 */
export async function enqueueEarlyTimeline(need: {
  accountId: string;
  username: string;
  name: string;
  tags: string[];
  lastTweetId: string | null;
  delayMs?: number;
}): Promise<{ jobId?: string; deduped?: boolean }> {
  const r = await enqueueJob(
    "early-timeline",
    {
      accountId: need.accountId,
      username: need.username,
      name: need.name,
      tags: need.tags,
      lastTweetId: need.lastTweetId,
    },
    {
      // BullMQ custom jobId cannot contain ":"
      jobId: `early-tl-${need.accountId}`,
      ...(need.delayMs != null && need.delayMs > 0
        ? { delay: need.delayMs }
        : {}),
    },
  );
  const out: { jobId?: string; deduped?: boolean } = {};
  if (r.jobId != null) out.jobId = r.jobId;
  if (r.deduped != null) out.deduped = r.deduped;
  return out;
}

/**
 * Worker: process one early-timeline job (getUserTweets + signal/raw alerts).
 * Re-queues with delay when rate budget is exhausted.
 */
export async function processEarlyTimelineJob(data: {
  accountId: string;
  username?: string;
  name?: string;
  tags?: string[];
  lastTweetId?: string | null;
}): Promise<{
  ok: boolean;
  signalAlerts: number;
  rawAlerts: number;
  requeued?: boolean;
  skipped?: string;
  deleted?: boolean;
}> {
  const cfg = await resolveEarlyPollConfig();
  const account = await prisma.twitterAccount.findUnique({
    where: { id: data.accountId },
  });
  if (!account) {
    return { ok: false, signalAlerts: 0, rawAlerts: 0, skipped: "not_found" };
  }

  if (!accountMatchesEarlyRules(account, cfg)) {
    return { ok: true, signalAlerts: 0, rawAlerts: 0, skipped: "not_early" };
  }

  let client;
  let authAccountId: bigint;
  try {
    const resolved = await getTwitterClient();
    client = resolved.client;
    authAccountId = resolved.accountId;
  } catch (err) {
    console.error("[early-timeline] no twitter client:", err);
    return { ok: false, signalAlerts: 0, rawAlerts: 0, skipped: "no_client" };
  }

  const r = await processNewTweets({
    accountId: account.id,
    username: data.username ?? account.username,
    name: data.name ?? account.name,
    tags: data.tags ?? account.tags,
    lastTweetId:
      data.lastTweetId !== undefined ? data.lastTweetId : account.lastTweetId,
    client,
    authAccountId,
    cfg,
  });

  if (r.rateLimited) {
    const delayMs = r.rateLimitWaitMs ?? TWEET_WINDOW_MS;
    await enqueueEarlyTimeline({
      accountId: account.id,
      username: account.username,
      name: account.name,
      tags: account.tags,
      lastTweetId: account.lastTweetId,
      delayMs,
    });
    return {
      ok: true,
      signalAlerts: 0,
      rawAlerts: 0,
      requeued: true,
    };
  }

  if (r.deleted) {
    return {
      ok: true,
      signalAlerts: 0,
      rawAlerts: 0,
      deleted: true,
      skipped: "user_gone",
    };
  }

  if (r.newestId && r.newestId !== account.lastTweetId) {
    await prisma.twitterAccount.update({
      where: { id: account.id },
      data: { lastTweetId: r.newestId },
    });
  }

  if (cfg.delayMs > 0) await sleep(cfg.delayMs);

  return {
    ok: true,
    signalAlerts: r.signalAlerts,
    rawAlerts: r.rawAlerts,
  };
}

/**
 * Hourly early-project refresh cycle.
 */
export async function pollEarlyProjects(): Promise<EarlyPollResult> {
  const result: EarlyPollResult = {
    candidates: 0,
    checked: 0,
    skippedFresh: 0,
    renames: 0,
    bioChanges: 0,
    followerJumps: 0,
    timelines: 0,
    timelinesQueued: 0,
    signalAlerts: 0,
    rawAlerts: 0,
    snapshots: 0,
    missing: 0,
    deleted: 0,
    errors: 0,
    usersByIdsReqs: 0,
  };

  const cfg = await resolveEarlyPollConfig();
  const maxAccounts = cfg.maxAccountsPerCycle;
  const ids = await selectEarlyProjectIds(maxAccounts, cfg);
  result.candidates = ids.length;
  if (ids.length === 0) {
    console.log("[early-poll] no candidates due");
    return result;
  }

  let client;
  let authAccountId: bigint;
  try {
    const resolved = await getTwitterClient();
    client = resolved.client;
    authAccountId = resolved.accountId;
  } catch (err) {
    console.error("[early-poll] no twitter client:", err);
    result.errors = 1;
    return result;
  }

  const accounts = await prisma.twitterAccount.findMany({
    where: { id: { in: ids } },
  });
  const byDbId = new Map(accounts.map((a) => [a.id, a]));

  type TimelineNeed = {
    id: string;
    username: string;
    name: string;
    tags: string[];
    lastTweetId: string | null;
  };
  const needTimeline: TimelineNeed[] = [];

  for (let i = 0; i < ids.length; i += cfg.batchSize) {
    if (result.usersByIdsReqs >= cfg.maxBatches) break;

    const chunkIds = ids.slice(i, i + cfg.batchSize);
    result.usersByIdsReqs++;

    const res = await client.getUsersByIds(chunkIds);
    if (res.rateLimit && res.rateLimit.remaining === 0) {
      await markRateLimited(authAccountId, res.rateLimit.reset);
    }
    if (!res.success) {
      result.errors++;
      const msg = res.error ?? "getUsersByIds failed";
      if (isTwitterAuthError(msg)) await markAuthInvalid(authAccountId, msg);
      console.warn(`[early-poll] getUsersByIds: ${msg}`);
      continue;
    }

    const liveById = new Map((res.users ?? []).map((u) => [u.id, u]));

    for (const id of chunkIds) {
      const db = byDbId.get(id);
      if (!db) continue;
      result.checked++;

      const u = liveById.get(id);
      if (!u) {
        // Missing from a successful UsersByRestIds batch = suspended/deleted/deactivated.
        result.missing++;
        const gone = await deleteUnavailableAccount(id, "missing_from_usersByIds");
        if (gone) result.deleted++;
        continue;
      }

      const liveUsername = (u.username ?? db.username).toLowerCase();
      const liveName = u.name ?? db.name;
      const liveBio =
        u.description != null && u.description.trim() !== ""
          ? u.description.trim()
          : null;
      const liveTweets =
        typeof u.tweetCount === "number" ? u.tweetCount : null;
      const liveFollowers =
        typeof u.followersCount === "number" ? u.followersCount : null;

      const renamed =
        liveUsername !== db.username.toLowerCase() && liveUsername.length > 0;
      const bioChanged = biosDiffer(db.description, liveBio);

      if (renamed) {
        result.renames++;
        console.log(
          `[early-poll] rename id=${id} @${db.username} → @${liveUsername}`,
        );
      }
      if (bioChanged) result.bioChanges++;

      let tags = db.tags;
      if (bioChanged || (renamed && (!tags.length || tags.includes("unknown")))) {
        try {
          tags = await classifyAccount({
            username: liveUsername,
            name: liveName,
            description: liveBio,
          });
        } catch {
          /* keep old tags */
        }
      }

      const prevCount = db.tweetCount;
      const needsTweets =
        !db.lastTweetId ||
        prevCount == null ||
        (liveTweets != null && prevCount != null && liveTweets > prevCount);

      const snap = await maybeSnapshot(id, u, db.followersCount, cfg.snapshotMinMs);
      if (snap.wrote) result.snapshots++;
      if (snap.jump) result.followerJumps++;

      try {
        await updateAccountProfile(id, {
          username: liveUsername,
          name: liveName,
          description: liveBio,
          tags,
          liveTweets,
          liveFollowers,
          followingCount: u.followingCount,
          likeCount: u.likeCount,
          isBlueVerified: u.isBlueVerified,
          profileImageUrl: u.profileImageUrl,
          profileBannerUrl: u.profileBannerUrl,
          location: u.location,
          setFollowersAtDetect:
            db.followersAtDetect == null && liveFollowers != null
              ? liveFollowers
              : null,
          renamed,
          previousUsername: db.username,
        });
      } catch (err) {
        result.errors++;
        console.error(
          `[early-poll] update @${liveUsername} id=${id}:`,
          err instanceof Error ? err.message : err,
        );
        // Still mark polled so we don't tight-loop on permanent conflicts.
        try {
          await prisma.twitterAccount.update({
            where: { id },
            data: { lastProfilePolledAt: new Date() },
          });
        } catch {
          /* ignore */
        }
        continue;
      }

      // Profile change alerts (rename / bio) — topic from alert.topic.profileChange (admin).
      if ((renamed || bioChanged) && (await isAlertEnabled("profileChange"))) {
        try {
          await sendTelegramAlert(
            formatProfileChangeAlert({
              accountId: id,
              username: liveUsername,
              name: liveName,
              previousUsername: renamed ? db.username : null,
              bioChanged,
              oldBio: db.description,
              newBio: liveBio,
              followersCount: liveFollowers,
              tags,
            }),
            "MarkdownV2",
            undefined, // use alert.topic.profileChange → default topic
            "profileChange",
          );
        } catch (err) {
          console.warn(
            `[early-poll] profile alert @${liveUsername}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      if (needsTweets) {
        needTimeline.push({
          id,
          username: liveUsername,
          name: liveName,
          tags,
          lastTweetId: db.lastTweetId,
        });
      }
    }

    if (cfg.delayMs > 0) await sleep(Math.min(cfg.delayMs, 250));
  }

  // Phase 2 — timeline fetches
  // getUserTweets ≈ 50 req / 15 min. Large pools always use the queue so we
  // never burn the whole budget inside one hourly poll.
  // Inline: up to maxTimelines (default 40) when queue is quiet / small backlog.
  // Rest: early-timeline jobs (deduped per accountId), drained by list-worker.
  const INLINE_CAP = Math.min(cfg.maxTimelines, cfg.tweetReqBudget);
  const useQueueForAll =
    needTimeline.length > INLINE_CAP || result.candidates >= 1000;

  let inlineLeft = useQueueForAll ? 0 : INLINE_CAP;

  for (let i = 0; i < needTimeline.length; i++) {
    const need = needTimeline[i]!;

    if (inlineLeft > 0) {
      inlineLeft--;
      result.timelines++;
      try {
        const r = await processNewTweets({
          accountId: need.id,
          username: need.username,
          name: need.name,
          tags: need.tags,
          lastTweetId: need.lastTweetId,
          client,
          authAccountId,
          cfg,
        });
        if (r.rateLimited) {
          // Budget hit mid-cycle — queue remainder including this one
          inlineLeft = 0;
          await enqueueEarlyTimeline({
            accountId: need.id,
            username: need.username,
            name: need.name,
            tags: need.tags,
            lastTweetId: need.lastTweetId,
            delayMs: r.rateLimitWaitMs ?? TWEET_WINDOW_MS,
          });
          result.timelinesQueued++;
          // queue the rest
          for (let j = i + 1; j < needTimeline.length; j++) {
            const n = needTimeline[j]!;
            await enqueueEarlyTimeline({
              accountId: n.id,
              username: n.username,
              name: n.name,
              tags: n.tags,
              lastTweetId: n.lastTweetId,
            });
            result.timelinesQueued++;
          }
          break;
        }
        result.signalAlerts += r.signalAlerts;
        result.rawAlerts += r.rawAlerts;
        if (r.newestId) {
          await prisma.twitterAccount.update({
            where: { id: need.id },
            data: { lastTweetId: r.newestId },
          });
        }
      } catch (err) {
        result.errors++;
        console.error(`[early-poll] timeline @${need.username}:`, err);
      }
      if (cfg.delayMs > 0) await sleep(cfg.delayMs);
      continue;
    }

    // Queue path
    try {
      const q = await enqueueEarlyTimeline({
        accountId: need.id,
        username: need.username,
        name: need.name,
        tags: need.tags,
        lastTweetId: need.lastTweetId,
      });
      if (!q.deduped) result.timelinesQueued++;
      else result.timelinesQueued++; // count attempted enqueue for visibility
    } catch (err) {
      result.errors++;
      console.error(`[early-poll] queue timeline @${need.username}:`, err);
    }
  }

  console.log(
    `[early-poll] candidates=${result.candidates} checked=${result.checked} ` +
      `renames=${result.renames} bio=${result.bioChanges} jumps=${result.followerJumps} ` +
      `timelines=${result.timelines} queued=${result.timelinesQueued} ` +
      `signals=${result.signalAlerts} raw=${result.rawAlerts} ` +
      `snaps=${result.snapshots} missing=${result.missing} deleted=${result.deleted} ` +
      `errors=${result.errors} usersByIds=${result.usersByIdsReqs}`,
  );

  return result;
}
