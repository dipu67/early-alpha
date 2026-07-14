// Per-user timeline monitor (NOT Project Lists / getListTweets).
//
// Polls getUserTweets for each monitored @username. First poll baselines
// lastTweetId only; later polls alert on newer tweets via Telegram ("monitor").
// No list membership required — fully independent of list-poller.
//
// alertMode:
//   "all"     — every new post from that user
//   "signals" — only posts matching mint/TGE/launch lexicon

import { prisma } from "../db/prisma.js";
import type { TweetData, UserData } from "../TwitterClient/types.js";
import {
  getTwitterClient,
  markRateLimited,
  markAuthInvalid,
} from "../twitter/getClient.js";
import { isTwitterAuthError } from "../TwitterClient/TwitterClient.js";
import { classifyAccount, DEFAULT_SLUG } from "./projectTagger.js";
import { detectSignals } from "./postSignals.js";
import { formatMonitorAlert } from "./formatAlert.js";
import { sendTelegramAlert, isAlertEnabled } from "../tg/sendAlert.js";
import { getHotBoard } from "./hunter.js";
import { prunePostAlertsForSlug } from "./postAlerts.js";

const TWEETS_PER_USER = Number(process.env.MONITOR_POLL_COUNT ?? 20);
const FETCH_DELAY_MS = Number(process.env.MONITOR_FETCH_DELAY_MS ?? 600);
/** Max active auto-enrolled monitors (manual never auto-dropped). */
const AUTO_CAP = Number(process.env.MONITOR_AUTO_CAP ?? 40);
const AUTO_MIN_HEAT = Number(process.env.MONITOR_AUTO_MIN_HEAT ?? 40);
const AUTO_MAX_FOLLOWERS = Number(process.env.MONITOR_AUTO_MAX_FOLLOWERS ?? 80_000);
const AUTO_HOURS = Number(process.env.MONITOR_AUTO_HOURS ?? 72);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

export type MonitorSource = "manual" | "hunter" | "stage" | "signal";
export type MonitorAlertMode = "all" | "signals";

export interface AddMonitorOpts {
  username: string;
  /** Skip Twitter resolve if already known. */
  twitterUserId?: string;
  name?: string;
  source?: MonitorSource;
  alertMode?: MonitorAlertMode;
  alertEnabled?: boolean;
  topicId?: number | null;
  heatAtEnroll?: number | null;
  profile?: UserData | null;
}

export interface MonitorView {
  id: string;
  twitterUserId: string;
  username: string;
  name: string;
  primaryTag: string | null;
  tags: string[];
  isActive: boolean;
  source: string;
  alertMode: string;
  alertEnabled: boolean;
  topicId: number | null;
  lastTweetId: string | null;
  lastPolledAt: Date | null;
  lastError: string | null;
  alertCount: number;
  heatAtEnroll: number | null;
  createdAt: Date;
}

function viewRow(m: {
  id: bigint;
  twitterUserId: string;
  username: string;
  name: string;
  primaryTag: string | null;
  tags: string[];
  isActive: boolean;
  source: string;
  alertMode: string;
  alertEnabled: boolean;
  topicId: number | null;
  lastTweetId: string | null;
  lastPolledAt: Date | null;
  lastError: string | null;
  alertCount: number;
  heatAtEnroll: number | null;
  createdAt: Date;
}): MonitorView {
  return {
    id: m.id.toString(),
    twitterUserId: m.twitterUserId,
    username: m.username,
    name: m.name,
    primaryTag: m.primaryTag,
    tags: m.tags,
    isActive: m.isActive,
    source: m.source,
    alertMode: m.alertMode,
    alertEnabled: m.alertEnabled,
    topicId: m.topicId,
    lastTweetId: m.lastTweetId,
    lastPolledAt: m.lastPolledAt,
    lastError: m.lastError,
    alertCount: m.alertCount,
    heatAtEnroll: m.heatAtEnroll,
    createdAt: m.createdAt,
  };
}

/** Resolve username via Twitter and upsert a ProjectMonitor. */
export async function addMonitor(opts: AddMonitorOpts): Promise<MonitorView> {
  const screenName = opts.username.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(screenName)) {
    throw new Error("invalid_username");
  }
  const usernameKey = screenName.toLowerCase();

  const existing = await prisma.projectMonitor.findUnique({
    where: { username: usernameKey },
  });
  if (existing?.isActive) {
    return viewRow(existing);
  }

  let twitterUserId = opts.twitterUserId?.trim();
  let name = opts.name ?? "";
  let profile = opts.profile ?? null;
  let tags: string[] = [];

  if (!twitterUserId || !profile) {
    const { client, accountId } = await getTwitterClient();
    const result = await client.getUserByScreenName(screenName);
    if (result.rateLimit && result.rateLimit.remaining === 0) {
      await markRateLimited(accountId, result.rateLimit.reset);
    }
    if (!result.success || !result.user) {
      throw new Error(
        result.error ? `user_not_found: ${result.error}` : "user_not_found",
      );
    }
    profile = result.user;
    twitterUserId = result.user.id;
    name = result.user.name ?? name;
  }

  tags = await classifyAccount(profile);
  const primaryTag =
    tags.find((t) => t !== DEFAULT_SLUG && t !== "unknown") ?? tags[0] ?? null;

  // Keep TwitterAccount in sync for hunter / projects
  await prisma.twitterAccount.upsert({
    where: { id: twitterUserId },
    create: {
      id: twitterUserId,
      username: (profile.username ?? usernameKey).toLowerCase(),
      name: profile.name ?? name,
      description: profile.description ?? null,
      tags,
      followersCount: profile.followersCount ?? null,
      followingCount: profile.followingCount ?? null,
      tweetCount: profile.tweetCount ?? null,
      likeCount: profile.likeCount ?? null,
      isBlueVerified: profile.isBlueVerified ?? null,
      profileImageUrl: profile.profileImageUrl ?? null,
      createdAt: profile.createdAt ? new Date(profile.createdAt) : null,
    },
    update: {
      username: (profile.username ?? usernameKey).toLowerCase(),
      name: profile.name ?? name,
      description: profile.description ?? null,
      tags,
      followersCount: profile.followersCount ?? null,
      isBlueVerified: profile.isBlueVerified ?? null,
    },
  });

  const resolvedUsername = (profile.username ?? usernameKey).toLowerCase();
  const data = {
    twitterUserId,
    username: resolvedUsername,
    name: profile.name ?? name,
    primaryTag,
    tags,
    isActive: true,
    source: opts.source ?? "manual",
    alertMode: opts.alertMode ?? "all",
    alertEnabled: opts.alertEnabled ?? true,
    topicId: opts.topicId ?? null,
    heatAtEnroll: opts.heatAtEnroll ?? null,
    lastError: null as string | null,
  };

  const row = existing
    ? await prisma.projectMonitor.update({
        where: { id: existing.id },
        data: {
          ...data,
          // Manual re-add upgrades source to manual so auto-drop won't remove
          source: opts.source ?? "manual",
        },
      })
    : await prisma.projectMonitor.create({ data });

  return viewRow(row);
}

export async function listMonitors(): Promise<MonitorView[]> {
  const items = await prisma.projectMonitor.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  return items.map(viewRow);
}

/**
 * Poll one monitor. First poll seeds watermark only.
 * Returns counts of new tweets processed / alerts sent.
 */
export async function pollMonitor(
  monitorId: bigint,
): Promise<{ fetched: number; fresh: number; alerted: number; seeded?: boolean; error?: string }> {
  const row = await prisma.projectMonitor.findUnique({ where: { id: monitorId } });
  if (!row || !row.isActive) return { fetched: 0, fresh: 0, alerted: 0 };

  let client;
  let accountId: bigint;
  try {
    const resolved = await getTwitterClient();
    client = resolved.client;
    accountId = resolved.accountId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.projectMonitor.update({
      where: { id: monitorId },
      data: { lastError: msg, lastPolledAt: new Date() },
    });
    return { fetched: 0, fresh: 0, alerted: 0, error: msg };
  }

  const res = await client.getUserTweets(row.twitterUserId, TWEETS_PER_USER);
  if (res.rateLimit && res.rateLimit.remaining === 0) {
    await markRateLimited(accountId, res.rateLimit.reset);
  }

  if (!res.success) {
    const msg = res.error ?? "getUserTweets failed";
    if (isTwitterAuthError(msg)) {
      await markAuthInvalid(accountId, msg);
    }
    await prisma.projectMonitor.update({
      where: { id: monitorId },
      data: { lastError: msg, lastPolledAt: new Date() },
    });
    return { fetched: 0, fresh: 0, alerted: 0, error: msg };
  }

  const tweets = res.tweets ?? [];
  const newest = maxTweetId(tweets);

  // First poll: baseline only
  if (!row.lastTweetId) {
    await prisma.projectMonitor.update({
      where: { id: monitorId },
      data: {
        lastTweetId: newest,
        lastPolledAt: new Date(),
        lastError: tweets.length === 0 ? "timeline returned 0 tweets" : null,
      },
    });
    return { fetched: tweets.length, fresh: 0, alerted: 0, seeded: true };
  }

  const cutoff = toId(row.lastTweetId);
  const fresh = tweets
    .filter((t) => toId(t.id) > cutoff)
    .sort((a, b) => (toId(a.id) < toId(b.id) ? -1 : 1));

  let alerted = 0;
  for (const tweet of fresh) {
    const did = await handleMonitorTweet(row, tweet);
    if (did) alerted++;
  }

  await prisma.projectMonitor.update({
    where: { id: monitorId },
    data: {
      lastTweetId: newest ?? row.lastTweetId,
      lastPolledAt: new Date(),
      lastError: null,
      ...(alerted > 0 ? { alertCount: { increment: alerted } } : {}),
    },
  });

  return { fetched: tweets.length, fresh: fresh.length, alerted };
}

async function handleMonitorTweet(
  row: {
    id: bigint;
    twitterUserId: string;
    username: string;
    name: string;
    primaryTag: string | null;
    tags: string[];
    alertMode: string;
    alertEnabled: boolean;
    topicId: number | null;
  },
  tweet: TweetData,
): Promise<boolean> {
  // Dedupe by tweet id (shared with list poller so one TG message max)
  const seen = await prisma.postAlert.findUnique({ where: { tweetId: tweet.id } });
  if (seen) return false;

  // Optional tag only for signal lexicon matching — never requires list membership
  const tagHint =
    row.primaryTag && row.primaryTag !== "unknown"
      ? row.primaryTag
      : row.tags.find((t) => t !== "unknown") ?? undefined;

  const signals = detectSignals(tweet.text, tagHint);
  const mode = row.alertMode === "signals" ? "signals" : "all";

  if (mode === "signals" && signals.length === 0) return false;

  // Record PostAlert for dedupe (even if Telegram muted)
  const feedSlug = `user:@${row.username}`;
  try {
    await prisma.postAlert.create({
      data: {
        tweetId: tweet.id,
        accountId: row.twitterUserId,
        username: row.username,
        // User-timeline source — not a ProjectList slug
        slug: feedSlug,
        signals: signals.length > 0 ? signals : mode === "all" ? ["post"] : [],
        text: tweet.text,
        postedAt: postedAt(tweet),
      },
    });
  } catch {
    return false;
  }
  // Cap monitor feed rows per user slug (same 20 as tag feed)
  try {
    await prunePostAlertsForSlug(feedSlug);
  } catch (err) {
    console.warn(`[monitor] prune slug=${feedSlug}:`, err);
  }

  if (!row.alertEnabled) return false;
  if (!(await isAlertEnabled("monitor"))) return false;

  const msg = formatMonitorAlert({
    accountId: row.twitterUserId,
    username: tweet.author.username || row.username,
    name: tweet.author.name || row.name || row.username,
    slug: tagHint ?? "user",
    signals,
    text: tweet.text,
    tweetId: tweet.id,
    alertMode: mode,
  });

  // Topic: per-user override only. Else Telegram alert-type "monitor" routing
  // (never ProjectList / tag topic maps).
  const thread = row.topicId != null ? row.topicId : undefined;

  await sendTelegramAlert(msg, "MarkdownV2", thread, "monitor");
  return true;
}

/** Poll all active monitors (oldest lastPolled first). */
export async function pollAllMonitors(): Promise<{
  polled: number;
  alerted: number;
  errors: number;
}> {
  const items = await prisma.projectMonitor.findMany({
    where: { isActive: true },
    orderBy: { lastPolledAt: { sort: "asc", nulls: "first" } },
  });

  let polled = 0;
  let alerted = 0;
  let errors = 0;

  for (const m of items) {
    try {
      const r = await pollMonitor(m.id);
      polled++;
      alerted += r.alerted;
      if (r.error) errors++;
      if (FETCH_DELAY_MS > 0) await sleep(FETCH_DELAY_MS);
    } catch (err) {
      errors++;
      console.error(`[monitor] poll ${m.username} failed:`, err);
    }
  }

  console.log(
    `[monitor] polled=${polled} alerted=${alerted} errors=${errors} (of ${items.length} active)`,
  );
  return { polled, alerted, errors };
}

/**
 * Auto-enroll top hunter heat accounts as monitors.
 * Manual monitors are never removed. Auto sources can be deactivated when cold.
 */
export async function autoEnrollFromHunter(): Promise<{
  enrolled: number;
  reactivated: number;
  deactivated: number;
}> {
  const board = await getHotBoard({
    hours: AUTO_HOURS,
    minHeat: AUTO_MIN_HEAT,
    maxFollowers: AUTO_MAX_FOLLOWERS,
    limit: AUTO_CAP + 20,
  });

  // Prefer soft/hot stages; exclude skip/taken
  const candidates = board
    .filter((b) => b.huntStage !== "skip" && b.huntStage !== "taken")
    .filter((b) => b.heat >= AUTO_MIN_HEAT || b.huntStage === "hot" || b.huntStage === "soft")
    .slice(0, AUTO_CAP);

  const candidateIds = new Set(candidates.map((c) => c.accountId));
  let enrolled = 0;
  let reactivated = 0;

  for (const c of candidates) {
    const existing = await prisma.projectMonitor.findUnique({
      where: { username: c.username.toLowerCase() },
    });

    if (existing) {
      if (!existing.isActive && existing.source !== "manual") {
        await prisma.projectMonitor.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            heatAtEnroll: c.heat,
            source: existing.source === "manual" ? "manual" : "hunter",
            lastError: null,
          },
        });
        reactivated++;
      } else if (existing.isActive) {
        // refresh heat snapshot
        await prisma.projectMonitor.update({
          where: { id: existing.id },
          data: { heatAtEnroll: c.heat },
        });
      }
      continue;
    }

    try {
      const profile: UserData = {
        id: c.accountId,
        username: c.username,
        name: c.name,
      };
      if (c.followersCount != null) profile.followersCount = c.followersCount;
      if (c.isBlueVerified != null) profile.isBlueVerified = c.isBlueVerified;
      await addMonitor({
        username: c.username,
        twitterUserId: c.accountId,
        name: c.name,
        source: "hunter",
        alertMode: "all",
        heatAtEnroll: c.heat,
        profile,
      });
      enrolled++;
    } catch (err) {
      console.warn(
        `[monitor] auto-enroll @${c.username} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Deactivate cold auto-monitors not on board (keep manual)
  const autoActive = await prisma.projectMonitor.findMany({
    where: {
      isActive: true,
      source: { in: ["hunter", "stage"] },
    },
  });

  let deactivated = 0;
  for (const m of autoActive) {
    if (!candidateIds.has(m.twitterUserId)) {
      // Only drop if over cap or not in top board
      const overCap = autoActive.length - deactivated > AUTO_CAP;
      if (overCap || !candidateIds.has(m.twitterUserId)) {
        // Keep if still high stage on account
        const acc = await prisma.twitterAccount.findUnique({
          where: { id: m.twitterUserId },
          select: { huntStage: true },
        });
        if (acc?.huntStage === "hot" || acc?.huntStage === "soft") continue;

        await prisma.projectMonitor.update({
          where: { id: m.id },
          data: { isActive: false },
        });
        deactivated++;
      }
    }
  }

  if (enrolled || reactivated || deactivated) {
    console.log(
      `[monitor] auto-enroll enrolled=${enrolled} reactivated=${reactivated} deactivated=${deactivated}`,
    );
  }
  return { enrolled, reactivated, deactivated };
}

/** Enroll a single account when hunt stage flips to hot/soft. */
export async function enrollFromStage(
  accountId: string,
  stage: string,
): Promise<MonitorView | null> {
  if (stage !== "hot" && stage !== "soft") return null;
  const acc = await prisma.twitterAccount.findUnique({ where: { id: accountId } });
  if (!acc) return null;
  const profile: UserData = {
    id: acc.id,
    username: acc.username,
    name: acc.name,
  };
  if (acc.description != null) profile.description = acc.description;
  if (acc.followersCount != null) profile.followersCount = acc.followersCount;
  if (acc.isBlueVerified != null) profile.isBlueVerified = acc.isBlueVerified;
  return addMonitor({
    username: acc.username,
    twitterUserId: acc.id,
    name: acc.name,
    source: "stage",
    alertMode: stage === "hot" ? "all" : "signals",
    profile,
  });
}
