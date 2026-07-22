// Per-user / tag-based project tweet monitor (NOT Project Lists).
//
// Cheap path (scale to 1k+ projects):
//   1) getUsersByIds in batches of 100 → compare statuses_count (tweetCount)
//   2) If tweetCount unchanged vs DB → skip (no new posts)
//   3) If tweetCount increased (or first seed) → getUserTweets for that user only
//   4) Only process tweets with snowflake id > lastTweetId
//
// Rate limits (per auth account, ~15 min window — rotate via pool):
//   UsersByRestIds ~100 req, up to 100 ids/req
//   UserTweets     ~50 req
//
// Username changes: usersByIds returns current screen_name by rest id; we update
// monitor + twitter_accounts and set previousUsername / usernameChangedAt.

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
import { detectSignalsWithRules } from "./signalRules.js";
import {
  evaluateSignalImportance,
  shouldPersistSignal,
  shouldTelegramSignal,
  toAlertImportanceView,
  type SignalImportance,
} from "./signalIntel.js";
import { formatMonitorAlert } from "./formatAlert.js";
import { sendTelegramAlert, isAlertEnabled } from "../tg/sendAlert.js";
import { getHotBoard } from "./hunter.js";
import { prunePostAlertsForSlug } from "./postAlerts.js";

const TWEETS_PER_USER = Number(process.env.MONITOR_POLL_COUNT ?? 20);
const FETCH_DELAY_MS = Number(process.env.MONITOR_FETCH_DELAY_MS ?? 400);
/** UsersByRestIds batch size (API allows up to ~100). */
const USERS_BY_IDS_BATCH = Math.min(
  Number(process.env.MONITOR_USERS_BATCH ?? 100),
  100,
);
/** Soft cap UserTweets calls per poll cycle (RL ~50 / 15m per auth). */
const MAX_TIMELINE_FETCHES = Number(process.env.MONITOR_MAX_TIMELINES ?? 50);
/** Soft cap UsersByRestIds requests per cycle (RL ~100 / 15m per auth). */
const MAX_USERS_BY_IDS_REQ = Number(process.env.MONITOR_MAX_USERS_REQ ?? 100);

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

export type MonitorSource = "manual" | "hunter" | "stage" | "signal" | "tag";
export type MonitorAlertMode = "all" | "signals";

export interface AddMonitorOpts {
  username: string;
  twitterUserId?: string;
  name?: string;
  source?: MonitorSource;
  alertMode?: MonitorAlertMode;
  alertEnabled?: boolean;
  topicId?: number | null;
  intervalSec?: number;
  heatAtEnroll?: number | null;
  profile?: UserData | null;
  primaryTag?: string | null;
  tags?: string[];
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
  intervalSec: number;
  lastTweetId: string | null;
  lastTweetCount: number | null;
  lastPolledAt: Date | null;
  lastError: string | null;
  alertCount: number;
  heatAtEnroll: number | null;
  previousUsername: string | null;
  usernameChangedAt: Date | null;
  createdAt: Date;
}

type MonitorRow = {
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
  intervalSec: number;
  lastTweetId: string | null;
  lastTweetCount: number | null;
  lastPolledAt: Date | null;
  lastError: string | null;
  alertCount: number;
  heatAtEnroll: number | null;
  previousUsername: string | null;
  usernameChangedAt: Date | null;
  createdAt: Date;
};

function viewRow(m: MonitorRow): MonitorView {
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
    intervalSec: m.intervalSec,
    lastTweetId: m.lastTweetId,
    lastTweetCount: m.lastTweetCount,
    lastPolledAt: m.lastPolledAt,
    lastError: m.lastError,
    alertCount: m.alertCount,
    heatAtEnroll: m.heatAtEnroll,
    previousUsername: m.previousUsername,
    usernameChangedAt: m.usernameChangedAt,
    createdAt: m.createdAt,
  };
}

function isDue(row: MonitorRow, now = Date.now()): boolean {
  if (!row.lastPolledAt) return true;
  const intervalMs = Math.max(30, row.intervalSec) * 1000;
  return now - row.lastPolledAt.getTime() >= intervalMs;
}

/** Resolve username via Twitter and upsert a ProjectMonitor (keyed by rest id). */
export async function addMonitor(opts: AddMonitorOpts): Promise<MonitorView> {
  const screenName = opts.username.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(screenName)) {
    throw new Error("invalid_username");
  }
  const usernameKey = screenName.toLowerCase();

  let twitterUserId = opts.twitterUserId?.trim();
  let name = opts.name ?? "";
  let profile = opts.profile ?? null;
  let tags: string[] = opts.tags ?? [];

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

  const existing = await prisma.projectMonitor.findUnique({
    where: { twitterUserId },
  });
  if (existing?.isActive && opts.source !== "tag" && opts.source !== "manual") {
    return viewRow(existing as MonitorRow);
  }

  if (tags.length === 0) {
    tags = await classifyAccount(profile);
  }
  const primaryTag =
    opts.primaryTag ??
    tags.find((t) => t !== DEFAULT_SLUG && t !== "unknown") ??
    tags[0] ??
    null;

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
      ...(profile.tweetCount != null ? { tweetCount: profile.tweetCount } : {}),
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
    intervalSec: opts.intervalSec ?? 300,
    heatAtEnroll: opts.heatAtEnroll ?? null,
    lastError: null as string | null,
    ...(profile.tweetCount != null
      ? { lastTweetCount: profile.tweetCount }
      : {}),
  };

  const row = existing
    ? await prisma.projectMonitor.update({
        where: { id: existing.id },
        data: {
          ...data,
          source:
            opts.source === "manual" || existing.source === "manual"
              ? opts.source === "manual"
                ? "manual"
                : existing.source
              : (opts.source ?? existing.source),
        },
      })
    : await prisma.projectMonitor.create({ data });

  return viewRow(row as MonitorRow);
}

export async function listMonitors(): Promise<MonitorView[]> {
  const items = await prisma.projectMonitor.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  return items.map((m) => viewRow(m as MonitorRow));
}

// ── Tag rules ──────────────────────────────────────────────────────────

export interface TagRuleView {
  id: string;
  tagSlug: string;
  enabled: boolean;
  intervalSec: number;
  topicId: number | null;
  alertMode: string;
  alertEnabled: boolean;
  maxProjects: number;
  lastEnrollAt: Date | null;
  lastRunAt: Date | null;
  enrolledCount: number;
  createdAt: Date;
}

export async function listTagRules(): Promise<TagRuleView[]> {
  const rules = await prisma.projectMonitorTagRule.findMany({
    orderBy: { tagSlug: "asc" },
  });
  const out: TagRuleView[] = [];
  for (const r of rules) {
    const enrolledCount = await prisma.projectMonitor.count({
      where: {
        isActive: true,
        source: "tag",
        OR: [{ primaryTag: r.tagSlug }, { tags: { has: r.tagSlug } }],
      },
    });
    out.push({
      id: r.id.toString(),
      tagSlug: r.tagSlug,
      enabled: r.enabled,
      intervalSec: r.intervalSec,
      topicId: r.topicId,
      alertMode: r.alertMode,
      alertEnabled: r.alertEnabled,
      maxProjects: r.maxProjects,
      lastEnrollAt: r.lastEnrollAt,
      lastRunAt: r.lastRunAt,
      enrolledCount,
      createdAt: r.createdAt,
    });
  }
  return out;
}

export async function upsertTagRule(input: {
  tagSlug: string;
  enabled?: boolean;
  intervalSec?: number;
  topicId?: number | null;
  alertMode?: MonitorAlertMode;
  alertEnabled?: boolean;
  maxProjects?: number;
}): Promise<TagRuleView> {
  const tagSlug = input.tagSlug.trim().toLowerCase();
  if (!tagSlug) throw new Error("tag_required");

  const row = await prisma.projectMonitorTagRule.upsert({
    where: { tagSlug },
    create: {
      tagSlug,
      enabled: input.enabled ?? true,
      intervalSec: input.intervalSec ?? 3600,
      topicId: input.topicId ?? null,
      alertMode: input.alertMode ?? "all",
      alertEnabled: input.alertEnabled ?? true,
      maxProjects: input.maxProjects ?? 1000,
    },
    update: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.intervalSec !== undefined
        ? { intervalSec: Math.max(60, input.intervalSec) }
        : {}),
      ...(input.topicId !== undefined ? { topicId: input.topicId } : {}),
      ...(input.alertMode !== undefined ? { alertMode: input.alertMode } : {}),
      ...(input.alertEnabled !== undefined
        ? { alertEnabled: input.alertEnabled }
        : {}),
      ...(input.maxProjects !== undefined
        ? { maxProjects: Math.max(1, Math.min(5000, input.maxProjects)) }
        : {}),
    },
  });

  const rules = await listTagRules();
  return rules.find((r) => r.tagSlug === tagSlug)!;
}

export type EnrollByTagResult = {
  tagSlug: string;
  scanned: number;
  enrolled: number;
  updated: number;
  /** Tag-sourced monitors paused because project no longer has this tag (or fell off max cap). */
  deactivated: number;
  /** Tag-sourced monitors re-activated because project regained the tag. */
  reactivated: number;
  ruleId: string;
};

/**
 * Full sync of monitored projects for a tag rule (safe to re-run anytime):
 *   + enroll new accounts that have the tag
 *   ~ update settings for existing
 *   − deactivate source=tag monitors that no longer carry the tag (or over max)
 * Manual monitors are never removed.
 */
export async function enrollByTag(
  tagSlug: string,
  opts: { allowDisabled?: boolean } = {},
): Promise<EnrollByTagResult> {
  const slug = tagSlug.trim().toLowerCase();
  const rule = await prisma.projectMonitorTagRule.findUnique({
    where: { tagSlug: slug },
  });
  if (!rule) throw new Error("tag_rule_not_found");
  if (!rule.enabled && !opts.allowDisabled) throw new Error("tag_rule_disabled");

  const accounts = await prisma.twitterAccount.findMany({
    where: { tags: { has: slug } },
    orderBy: { firstSeenAt: "desc" },
    take: rule.maxProjects,
    select: {
      id: true,
      username: true,
      name: true,
      tags: true,
      tweetCount: true,
      followersCount: true,
      isBlueVerified: true,
      description: true,
    },
  });

  const keepIds = new Set(accounts.map((a) => a.id));
  let enrolled = 0;
  let updated = 0;
  let reactivated = 0;

  for (const acc of accounts) {
    const existing = await prisma.projectMonitor.findUnique({
      where: { twitterUserId: acc.id },
    });

    const profile: UserData = {
      id: acc.id,
      username: acc.username,
      name: acc.name,
    };
    if (acc.description != null) profile.description = acc.description;
    if (acc.followersCount != null) profile.followersCount = acc.followersCount;
    if (acc.tweetCount != null) profile.tweetCount = acc.tweetCount;
    if (acc.isBlueVerified != null) profile.isBlueVerified = acc.isBlueVerified;

    if (existing) {
      const wasInactive = !existing.isActive;
      await prisma.projectMonitor.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          username: acc.username.toLowerCase(),
          name: acc.name,
          // Tag enroll owns primaryTag only for non-manual sources
          primaryTag:
            existing.source === "manual" ? existing.primaryTag : slug,
          tags: acc.tags,
          topicId:
            existing.source === "manual" ? existing.topicId : rule.topicId,
          alertMode:
            existing.source === "manual"
              ? existing.alertMode
              : rule.alertMode,
          alertEnabled:
            existing.source === "manual"
              ? existing.alertEnabled
              : rule.alertEnabled,
          intervalSec:
            existing.source === "manual"
              ? existing.intervalSec
              : rule.intervalSec,
          source: existing.source === "manual" ? "manual" : "tag",
          lastError: null,
          ...(acc.tweetCount != null && existing.lastTweetCount == null
            ? { lastTweetCount: acc.tweetCount }
            : {}),
        },
      });
      if (wasInactive && existing.source !== "manual") reactivated++;
      else updated++;
      continue;
    }

    await addMonitor({
      username: acc.username,
      twitterUserId: acc.id,
      name: acc.name,
      source: "tag",
      alertMode: (rule.alertMode === "signals" ? "signals" : "all") as MonitorAlertMode,
      alertEnabled: rule.alertEnabled,
      topicId: rule.topicId,
      intervalSec: rule.intervalSec,
      primaryTag: slug,
      tags: acc.tags,
      profile,
    });
    enrolled++;
  }

  // Deactivate tag-owned monitors no longer in the tag set (decrease)
  const stale = await prisma.projectMonitor.findMany({
    where: {
      isActive: true,
      source: "tag",
      primaryTag: slug,
    },
    select: { id: true, twitterUserId: true, username: true },
  });

  let deactivated = 0;
  for (const m of stale) {
    if (keepIds.has(m.twitterUserId)) continue;
    await prisma.projectMonitor.update({
      where: { id: m.id },
      data: {
        isActive: false,
        lastError: `tag_sync: no longer tagged “${slug}”`,
      },
    });
    deactivated++;
  }

  await prisma.projectMonitorTagRule.update({
    where: { id: rule.id },
    data: { lastEnrollAt: new Date(), lastRunAt: new Date() },
  });

  // Propagate interval/topic to active tag monitors for this slug
  await prisma.projectMonitor.updateMany({
    where: {
      isActive: true,
      source: "tag",
      primaryTag: slug,
    },
    data: {
      intervalSec: rule.intervalSec,
      topicId: rule.topicId,
      alertMode: rule.alertMode,
      alertEnabled: rule.alertEnabled,
    },
  });

  console.log(
    `[monitor] tag-sync ${slug} scanned=${accounts.length} +${enrolled} ~${updated} ` +
      `reactivated=${reactivated} -${deactivated}`,
  );

  return {
    tagSlug: slug,
    scanned: accounts.length,
    enrolled,
    updated,
    deactivated,
    reactivated,
    ruleId: rule.id.toString(),
  };
}

/**
 * Re-sync every enabled tag rule (auto-run on monitor poll).
 * Adds new tagged projects, drops tag monitors that lost the tag.
 */
export async function syncAllEnabledTagRules(): Promise<{
  rules: number;
  enrolled: number;
  updated: number;
  deactivated: number;
  reactivated: number;
}> {
  const rules = await prisma.projectMonitorTagRule.findMany({
    where: { enabled: true },
  });
  let enrolled = 0;
  let updated = 0;
  let deactivated = 0;
  let reactivated = 0;
  for (const r of rules) {
    try {
      const res = await enrollByTag(r.tagSlug);
      enrolled += res.enrolled;
      updated += res.updated;
      deactivated += res.deactivated;
      reactivated += res.reactivated;
    } catch (err) {
      console.warn(
        `[monitor] tag-sync ${r.tagSlug} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (rules.length > 0) {
    console.log(
      `[monitor] tag-sync-all rules=${rules.length} +${enrolled} ~${updated} ` +
        `reactivated=${reactivated} -${deactivated}`,
    );
  }
  return {
    rules: rules.length,
    enrolled,
    updated,
    deactivated,
    reactivated,
  };
}

// ── Poll: tweetCount prefilter → selective getUserTweets ───────────────

/**
 * Fetch timeline for one monitor (after tweetCount said "maybe new").
 * First poll with empty lastTweetId seeds watermark only.
 */
export async function pollMonitor(
  monitorId: bigint,
  opts: { forceTimeline?: boolean } = {},
): Promise<{
  fetched: number;
  fresh: number;
  alerted: number;
  seeded?: boolean;
  skipped?: boolean;
  usernameChanged?: boolean;
  error?: string;
}> {
  const row = await prisma.projectMonitor.findUnique({ where: { id: monitorId } });
  if (!row || !row.isActive) return { fetched: 0, fresh: 0, alerted: 0 };

  // Force full path when explicitly requested; otherwise still allow single poll
  if (!opts.forceTimeline) {
    // Single-monitor poll always does timeline (UI "Poll" button)
  }

  return fetchTimelineAndAlert(row as MonitorRow);
}

async function fetchTimelineAndAlert(row: MonitorRow): Promise<{
  fetched: number;
  fresh: number;
  alerted: number;
  seeded?: boolean;
  error?: string;
}> {
  let client;
  let accountId: bigint;
  try {
    const resolved = await getTwitterClient();
    client = resolved.client;
    accountId = resolved.accountId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.projectMonitor.update({
      where: { id: row.id },
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
      where: { id: row.id },
      data: { lastError: msg, lastPolledAt: new Date() },
    });
    return { fetched: 0, fresh: 0, alerted: 0, error: msg };
  }

  const tweets = res.tweets ?? [];
  const newest = maxTweetId(tweets);

  // First poll: baseline only
  if (!row.lastTweetId) {
    await prisma.projectMonitor.update({
      where: { id: row.id },
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

  // Only advance watermark forward
  const advanced =
    newest && toId(newest) > cutoff ? newest : row.lastTweetId;

  await prisma.projectMonitor.update({
    where: { id: row.id },
    data: {
      lastTweetId: advanced,
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
  const seen = await prisma.postAlert.findUnique({ where: { tweetId: tweet.id } });
  if (seen) return false;

  const tagHint =
    row.primaryTag && row.primaryTag !== "unknown"
      ? row.primaryTag
      : row.tags.find((t) => t !== "unknown") ?? undefined;
  const allTags = [
    ...(tagHint ? [tagHint] : []),
    ...row.tags.filter((t) => t && t !== "unknown" && t !== tagHint),
  ];

  let signals = await detectSignalsWithRules(tweet.text, allTags, {
    structuralFallback: true,
  });
  if (signals.length === 0) {
    signals = detectSignals(tweet.text, tagHint);
  }
  const mode = row.alertMode === "signals" ? "signals" : "all";

  if (mode === "signals" && signals.length === 0) return false;

  let imp: SignalImportance | null = null;
  let storeSignals = signals;
  if (signals.length > 0) {
    imp = evaluateSignalImportance({
      text: tweet.text,
      signals,
      tagSlug: tagHint ?? null,
      isOfficialAuthor: true,
    });
    if (mode === "signals" && !shouldPersistSignal(imp)) {
      console.log(
        `[monitor] drop @${row.username} score=${imp.score} labels=${signals.join(",")}`,
      );
      return false;
    }
    if (shouldPersistSignal(imp)) {
      storeSignals = imp.displayLabels;
    }
  }

  const feedSlug = `user:@${row.username}`;
  try {
    await prisma.postAlert.create({
      data: {
        tweetId: tweet.id,
        accountId: row.twitterUserId,
        username: tweet.author.username || row.username,
        slug: feedSlug,
        signals: storeSignals.length > 0 ? storeSignals : mode === "all" ? ["post"] : [],
        text: tweet.text,
        postedAt: postedAt(tweet),
      },
    });
  } catch {
    return false;
  }
  try {
    await prunePostAlertsForSlug(feedSlug);
  } catch (err) {
    console.warn(`[monitor] prune slug=${feedSlug}:`, err);
  }

  if (!row.alertEnabled) return false;
  if (!(await isAlertEnabled("monitor"))) return false;
  if (imp && mode === "signals" && !shouldTelegramSignal(imp)) return true;

  const msg = formatMonitorAlert({
    accountId: row.twitterUserId,
    username: tweet.author.username || row.username,
    name: tweet.author.name || row.name || row.username,
    slug: tagHint ?? "user",
    signals: storeSignals,
    text: tweet.text,
    tweetId: tweet.id,
    alertMode: mode,
    importance: imp ? toAlertImportanceView(imp) : undefined,
  });

  const thread = row.topicId != null ? row.topicId : undefined;
  await sendTelegramAlert(msg, "MarkdownV2", thread, "monitor");
  return true;
}

/**
 * Efficient bulk poll:
 *   usersByIds (100/batch) → tweetCount delta → getUserTweets only when needed.
 * Also detects username changes by rest id.
 */
export async function pollAllMonitors(): Promise<{
  due: number;
  checked: number;
  skippedUnchanged: number;
  timelines: number;
  alerted: number;
  usernameChanges: number;
  missing: number;
  errors: number;
}> {
  const now = Date.now();

  let checked = 0;
  let skippedUnchanged = 0;
  let timelines = 0;
  let alerted = 0;
  let usernameChanges = 0;
  let missing = 0;
  let errors = 0;
  let usersByIdsReqs = 0;
  let timelineBudget = MAX_TIMELINE_FETCHES;

  // Auto-sync tag membership (add / remove as tag sets grow or shrink)
  try {
    await syncAllEnabledTagRules();
  } catch (err) {
    console.warn(
      "[monitor] tag-sync-all failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // Load due list after tag sync (new enrollments may be due immediately)
  const afterSync = await prisma.projectMonitor.findMany({
    where: { isActive: true },
    orderBy: { lastPolledAt: { sort: "asc", nulls: "first" } },
  });
  const due = afterSync.filter((m) => isDue(m as MonitorRow, now)) as MonitorRow[];

  if (due.length === 0) {
    console.log(
      `[monitor] poll-all nothing due (active=${afterSync.length} after tag-sync)`,
    );
    return {
      due: 0,
      checked: 0,
      skippedUnchanged: 0,
      timelines: 0,
      alerted: 0,
      usernameChanges: 0,
      missing: 0,
      errors: 0,
    };
  }

  let client;
  let accountId: bigint;
  try {
    const resolved = await getTwitterClient();
    client = resolved.client;
    accountId = resolved.accountId;
  } catch (err) {
    console.error("[monitor] poll-all no twitter client:", err);
    return {
      due: due.length,
      checked: 0,
      skippedUnchanged: 0,
      timelines: 0,
      alerted: 0,
      usernameChanges: 0,
      missing: 0,
      errors: 1,
    };
  }

  /** Monitors that need a timeline fetch after tweetCount check. */
  const needTimeline: MonitorRow[] = [];

  for (let i = 0; i < due.length; i += USERS_BY_IDS_BATCH) {
    if (usersByIdsReqs >= MAX_USERS_BY_IDS_REQ) {
      console.warn(
        `[monitor] usersByIds request budget exhausted (${MAX_USERS_BY_IDS_REQ})`,
      );
      break;
    }

    const chunk = due.slice(i, i + USERS_BY_IDS_BATCH);
    const ids = chunk.map((m) => m.twitterUserId);
    usersByIdsReqs++;

    const res = await client.getUsersByIds(ids);
    if (res.rateLimit && res.rateLimit.remaining === 0) {
      await markRateLimited(accountId, res.rateLimit.reset);
    }
    if (!res.success) {
      errors++;
      const msg = res.error ?? "getUsersByIds failed";
      if (isTwitterAuthError(msg)) await markAuthInvalid(accountId, msg);
      console.warn(`[monitor] getUsersByIds: ${msg}`);
      // Fall back: mark chunk errors but continue other chunks
      for (const m of chunk) {
        await prisma.projectMonitor.update({
          where: { id: m.id },
          data: { lastError: msg, lastPolledAt: new Date() },
        });
      }
      continue;
    }

    const byId = new Map((res.users ?? []).map((u) => [u.id, u]));

    for (const m of chunk) {
      checked++;
      const u = byId.get(m.twitterUserId);

      if (!u) {
        missing++;
        await prisma.projectMonitor.update({
          where: { id: m.id },
          data: {
            lastError: "user_not_found_or_suspended",
            lastPolledAt: new Date(),
          },
        });
        continue;
      }

      const liveUsername = (u.username ?? m.username).toLowerCase();
      const liveName = u.name ?? m.name;
      const liveCount =
        typeof u.tweetCount === "number" ? u.tweetCount : null;

      let usernameChanged = false;
      if (liveUsername && liveUsername !== m.username.toLowerCase()) {
        usernameChanged = true;
        usernameChanges++;
        console.log(
          `[monitor] username change id=${m.twitterUserId} @${m.username} → @${liveUsername}`,
        );
      }

      // Keep TwitterAccount in sync (username + counts)
      try {
        const { freeUsernameIfHeldByOther } = await import(
          "./earlyProjectPoller.js"
        );
        await freeUsernameIfHeldByOther(m.twitterUserId, liveUsername);
        await prisma.twitterAccount.update({
          where: { id: m.twitterUserId },
          data: {
            username: liveUsername,
            name: liveName,
            ...(liveCount != null ? { tweetCount: liveCount } : {}),
            ...(u.followersCount != null
              ? { followersCount: u.followersCount }
              : {}),
            ...(u.isBlueVerified != null
              ? { isBlueVerified: u.isBlueVerified }
              : {}),
          },
        });
      } catch {
        /* account row may not exist or rare race */
      }

      const prevCount = m.lastTweetCount;
      const needsTweets =
        // Never seeded timeline watermark
        !m.lastTweetId ||
        // No prior count baseline — seed count + check timeline once
        prevCount == null ||
        // Tweet count went up → new posts likely
        (liveCount != null && liveCount > prevCount);

      if (!needsTweets) {
        skippedUnchanged++;
        await prisma.projectMonitor.update({
          where: { id: m.id },
          data: {
            username: liveUsername,
            name: liveName,
            lastTweetCount: liveCount ?? prevCount,
            lastPolledAt: new Date(),
            lastError: null,
            ...(usernameChanged
              ? {
                  previousUsername: m.username,
                  usernameChangedAt: new Date(),
                }
              : {}),
          },
        });
        continue;
      }

      // Queue for timeline — update profile fields first
      await prisma.projectMonitor.update({
        where: { id: m.id },
        data: {
          username: liveUsername,
          name: liveName,
          lastTweetCount: liveCount ?? prevCount,
          ...(usernameChanged
            ? {
                previousUsername: m.username,
                usernameChangedAt: new Date(),
              }
            : {}),
        },
      });

      needTimeline.push({
        ...m,
        username: liveUsername,
        name: liveName,
        lastTweetCount: liveCount ?? prevCount,
      });
    }

    if (FETCH_DELAY_MS > 0) await sleep(Math.min(FETCH_DELAY_MS, 200));
  }

  // Phase 2 — getUserTweets only for candidates (budget-capped)
  for (const m of needTimeline) {
    if (timelineBudget <= 0) {
      console.warn(
        `[monitor] UserTweets budget exhausted (${MAX_TIMELINE_FETCHES}); remaining=${needTimeline.length - timelines} deferred`,
      );
      break;
    }
    timelineBudget--;
    timelines++;

    try {
      const freshRow = await prisma.projectMonitor.findUnique({
        where: { id: m.id },
      });
      if (!freshRow?.isActive) continue;
      const r = await fetchTimelineAndAlert(freshRow as MonitorRow);
      alerted += r.alerted;
      if (r.error) errors++;
    } catch (err) {
      errors++;
      console.error(`[monitor] timeline @${m.username}:`, err);
    }

    if (FETCH_DELAY_MS > 0) await sleep(FETCH_DELAY_MS);
  }

  console.log(
    `[monitor] poll-all due=${due.length} checked=${checked} ` +
      `unchanged=${skippedUnchanged} timelines=${timelines} alerted=${alerted} ` +
      `renames=${usernameChanges} missing=${missing} errors=${errors} ` +
      `usersByIdsReqs=${usersByIdsReqs}`,
  );

  return {
    due: due.length,
    checked,
    skippedUnchanged,
    timelines,
    alerted,
    usernameChanges,
    missing,
    errors,
  };
}

// ── Hunter auto-enroll (unchanged behaviour, keyed by twitterUserId) ───

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

  const candidates = board
    .filter((b) => b.huntStage !== "skip" && b.huntStage !== "taken")
    .filter(
      (b) =>
        b.heat >= AUTO_MIN_HEAT ||
        b.huntStage === "hot" ||
        b.huntStage === "soft",
    )
    .slice(0, AUTO_CAP);

  const candidateIds = new Set(candidates.map((c) => c.accountId));
  let enrolled = 0;
  let reactivated = 0;

  for (const c of candidates) {
    const existing = await prisma.projectMonitor.findUnique({
      where: { twitterUserId: c.accountId },
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

  const autoActive = await prisma.projectMonitor.findMany({
    where: {
      isActive: true,
      source: { in: ["hunter", "stage"] },
    },
  });

  let deactivated = 0;
  for (const m of autoActive) {
    if (!candidateIds.has(m.twitterUserId)) {
      const overCap = autoActive.length - deactivated > AUTO_CAP;
      if (overCap || !candidateIds.has(m.twitterUserId)) {
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
