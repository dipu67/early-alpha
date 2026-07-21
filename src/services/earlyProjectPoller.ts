// Early-project real-time refresh via usersByIds (100/batch).
//
// Flow each hour:
//   1. Select early TwitterAccount rows (LRU by lastProfilePolledAt)
//   2. getUsersByIds in batches of 100
//   3. Diff: username, bio, followers, tweetCount
//   4. If tweetCount ↑ → getUserTweets → signal intel → PostAlert + Telegram
//   5. Metric snapshots (for 7d growth reports)
//   6. Bio change → optional reclassify
//
// Rate limits: batch budget + timeline budget + delays; markRateLimited on 0 remaining.

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
import { formatSignalAlert, formatProfileChangeAlert } from "./formatAlert.js";
import {
  sendTelegramAlert,
  topicForSlug,
  isAlertEnabled,
} from "../tg/sendAlert.js";
import { prunePostAlertsForSlug } from "./postAlerts.js";
import { EARLY_MAX_FOLLOWERS, EARLY_MAX_AGE_MS } from "./earlyProjectFilter.js";

const USERS_BY_IDS_BATCH = Math.min(
  100,
  Math.max(10, Number(process.env.EARLY_POLL_BATCH ?? 100)),
);
/** Max usersByIds HTTP calls per cycle (100 ids each → up to 1000 accounts). */
const MAX_USERS_BY_IDS_REQ = Math.max(
  1,
  Number(process.env.EARLY_POLL_MAX_BATCHES ?? 10),
);
/** Max getUserTweets calls when tweetCount rises. */
const MAX_TIMELINE_FETCHES = Math.max(
  1,
  Number(process.env.EARLY_POLL_MAX_TIMELINES ?? 40),
);
const FETCH_DELAY_MS = Math.max(0, Number(process.env.EARLY_POLL_DELAY_MS ?? 400));
/** Only re-poll accounts not polled within this window (default 55m). */
const STALE_MS = Math.max(
  60_000,
  Number(process.env.EARLY_POLL_STALE_MS ?? 55 * 60 * 1000),
);
/** Max account age for “early” pool (default 1y, same as early filter). */
const MAX_AGE_MS = Number(process.env.EARLY_POLL_MAX_AGE_MS ?? EARLY_MAX_AGE_MS);
const MAX_FOLLOWERS = Number(
  process.env.EARLY_POLL_MAX_FOLLOWERS ?? EARLY_MAX_FOLLOWERS,
);
/** Snapshot at most once per this interval per account (default 6h). */
const SNAPSHOT_MIN_MS = Math.max(
  60_000,
  Number(process.env.EARLY_SNAPSHOT_MIN_MS ?? 6 * 3600 * 1000),
);

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
  signalAlerts: number;
  snapshots: number;
  missing: number;
  errors: number;
  usersByIdsReqs: number;
};

/**
 * Early pool: recent or still-small accounts, plus soft/hot hunter stages.
 * Ordered by oldest profile poll first (fair rotation).
 */
export async function selectEarlyProjectIds(limit: number): Promise<string[]> {
  const staleBefore = new Date(Date.now() - STALE_MS);
  const minCreated = new Date(Date.now() - MAX_AGE_MS);

  const rows = await prisma.twitterAccount.findMany({
    where: {
      AND: [
        {
          OR: [
            { lastProfilePolledAt: null },
            { lastProfilePolledAt: { lte: staleBefore } },
          ],
        },
        {
          OR: [
            { huntStage: { in: ["soft", "hot"] } },
            { firstSeenAt: { gte: new Date(Date.now() - 90 * 86400 * 1000) } },
            {
              AND: [
                {
                  OR: [
                    { followersCount: { lte: MAX_FOLLOWERS } },
                    { followersCount: null },
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
            },
          ],
        },
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

/** Returns { wrote, jump } — jump = 2x or +500 followers since previous DB value. */
async function maybeSnapshot(
  accountId: string,
  u: UserData,
  prevFollowers: number | null | undefined,
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

  if (last && now - last.recordedAt.getTime() < SNAPSHOT_MIN_MS && followerDelta < 50) {
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

async function processNewTweets(opts: {
  accountId: string;
  username: string;
  name: string;
  tags: string[];
  lastTweetId: string | null;
  client: Awaited<ReturnType<typeof getTwitterClient>>["client"];
  authAccountId: bigint;
}): Promise<{ alerted: number; newestId: string | null }> {
  const res = await opts.client.getUserTweets(opts.accountId, 20);
  if (res.rateLimit && res.rateLimit.remaining === 0) {
    await markRateLimited(opts.authAccountId, res.rateLimit.reset);
  }
  if (!res.success) {
    const msg = res.error ?? "getUserTweets failed";
    if (isTwitterAuthError(msg)) await markAuthInvalid(opts.authAccountId, msg);
    console.warn(`[early-poll] tweets @${opts.username}: ${msg}`);
    return { alerted: 0, newestId: opts.lastTweetId };
  }

  const tweets = res.tweets ?? [];
  const newest = maxTweetId(tweets);

  // First seed: set watermark only (no backlog flood)
  if (!opts.lastTweetId) {
    return { alerted: 0, newestId: newest ?? opts.lastTweetId };
  }

  const cutoff = toId(opts.lastTweetId);
  const fresh = tweets
    .filter((t) => toId(t.id) > cutoff)
    .sort((a, b) => (toId(a.id) < toId(b.id) ? -1 : 1));

  let alerted = 0;
  const tagHint =
    opts.tags.find((t) => t !== "unknown" && t !== "other" && t !== "alpha") ??
    opts.tags[0] ??
    null;

  for (const tweet of fresh) {
    const did = await handleProjectTweet({
      accountId: opts.accountId,
      username: opts.username,
      name: opts.name,
      tagSlug: tagHint,
      tweet,
    });
    if (did) alerted++;
  }

  const advanced =
    newest && toId(newest) > cutoff ? newest : opts.lastTweetId;
  return { alerted, newestId: advanced };
}

async function handleProjectTweet(opts: {
  accountId: string;
  username: string;
  name: string;
  tagSlug: string | null;
  tweet: TweetData;
}): Promise<boolean> {
  const seen = await prisma.postAlert.findUnique({
    where: { tweetId: opts.tweet.id },
  });
  if (seen) return false;

  const signals = await detectSignalsWithRules(
    opts.tweet.text,
    opts.tagSlug,
  );
  if (signals.length === 0) return false;

  const imp = evaluateSignalImportance({
    text: opts.tweet.text,
    signals,
    tagSlug: opts.tagSlug,
    isOfficialAuthor: true,
  });
  if (!shouldPersistSignal(imp)) return false;

  const slug = opts.tagSlug ?? "early";
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

  if (!(await isAlertEnabled("signal"))) return true;
  if (!shouldTelegramSignal(imp)) return true;

  const thread = await topicForSlug(slug);
  await sendTelegramAlert(
    formatSignalAlert({
      accountId: opts.accountId ,
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
  return true;
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
    signalAlerts: 0,
    snapshots: 0,
    missing: 0,
    errors: 0,
    usersByIdsReqs: 0,
  };

  const maxAccounts = USERS_BY_IDS_BATCH * MAX_USERS_BY_IDS_REQ;
  const ids = await selectEarlyProjectIds(maxAccounts);
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

  for (let i = 0; i < ids.length; i += USERS_BY_IDS_BATCH) {
    if (result.usersByIdsReqs >= MAX_USERS_BY_IDS_REQ) break;

    const chunkIds = ids.slice(i, i + USERS_BY_IDS_BATCH);
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
        result.missing++;
        await prisma.twitterAccount.update({
          where: { id },
          data: { lastProfilePolledAt: new Date() },
        });
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

      const snap = await maybeSnapshot(id, u, db.followersCount);
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

      // Profile change alerts (rename / bio) — soft, rate-limited via alert type
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
            6864, // profile update thread
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

    if (FETCH_DELAY_MS > 0) await sleep(Math.min(FETCH_DELAY_MS, 250));
  }

  // Phase 2 — timelines only when tweetCount moved
  let timelineBudget = MAX_TIMELINE_FETCHES;
  for (const need of needTimeline) {
    if (timelineBudget <= 0) {
      console.warn(
        `[early-poll] timeline budget exhausted (${MAX_TIMELINE_FETCHES}); deferred=${needTimeline.length - result.timelines}`,
      );
      break;
    }
    timelineBudget--;
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
      });
      result.signalAlerts += r.alerted;
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

    if (FETCH_DELAY_MS > 0) await sleep(FETCH_DELAY_MS);
  }

  console.log(
    `[early-poll] candidates=${result.candidates} checked=${result.checked} ` +
      `renames=${result.renames} bio=${result.bioChanges} jumps=${result.followerJumps} ` +
      `timelines=${result.timelines} signals=${result.signalAlerts} ` +
      `snaps=${result.snapshots} missing=${result.missing} errors=${result.errors} ` +
      `usersByIds=${result.usersByIdsReqs}`,
  );

  return result;
}
