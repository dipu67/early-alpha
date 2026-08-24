// Watching poller — monitors projects with projectStatus = 'watching'.
//
// Flow per cycle:
//   1. Fetch TwitterAccount rows whose Project has projectStatus = 'watching'
//   2. Fetch each user's timeline via FxTwitter getProfileStatuses, passing the
//      stored fxCursor (`cursor.top`) so X returns only posts newer than the last
//      page we saw. fxCursor is the sole watermark — a cursored response needs
//      no further filtering.
//   3. First sight of an account seeds the cursor only (no backlog flood)
//   4. Else, for every returned post, run signal detection: a match routes the
//      alert to the signal topic, no match routes it to the row-post topic
//      (see routeWatchingTweet)
//   5. Advance the cursor only when the whole page reached Telegram — a failed
//      send holds it so the page is retried next cycle. A branch the admin
//      turned off does not hold: "off" means drop, not defer.

import { prisma } from "../db/prisma.js";
import { FxTwitterClient, FxTwitterError } from "../fxTwitter/fxTwitterClient.js";
import type { APITwitterStatus } from "../fxTwitter/types.js";
import { CONFIG_KEYS, getConfig } from "./appConfig.js";
import { formatWatchingAlert } from "./formatAlert.js";
import { detectSignalsWithRules } from "./signalRules.js";
import { detectSignals } from "./postSignals.js";
import { sendTelegramAlert } from "../tg/sendAlert.js";
import { toSnowflake } from "./pollerCore.js";

/** Env values are fallbacks only — the Setting keys override them at runtime. */
const TWEETS_PER_USER_FALLBACK = Number(process.env.WATCHING_POLL_COUNT ?? 20);
const MAX_USERS_FALLBACK = Number(process.env.WATCHING_MAX_USERS ?? 10);

/** Which Telegram stream a watching post belongs to. */
export type WatchingBranch = "signal" | "row";

export interface WatchingRouting {
  signalEnabled: boolean;
  rowEnabled: boolean;
  signalTopicId: number | undefined;
  rowTopicId: number | undefined;
}

export interface WatchingRoute {
  branch: WatchingBranch;
  /** False when the admin turned this branch off — skip the send, still advance. */
  enabled: boolean;
  /** undefined falls back to sendTelegramAlert's alert-type / default topic. */
  topicId: number | undefined;
}

/**
 * Route one watching post: a matched signal goes to the signal topic, everything
 * else to the row-post topic. Each branch has its own admin on/off switch.
 */
export function routeWatchingTweet(
  signals: string[],
  cfg: WatchingRouting,
): WatchingRoute {
  return signals.length > 0
    ? { branch: "signal", enabled: cfg.signalEnabled, topicId: cfg.signalTopicId }
    : { branch: "row", enabled: cfg.rowEnabled, topicId: cfg.rowTopicId };
}

/** Coerce a Setting value to a usable forum topic id, or undefined. */
function topicOrUndefined(v: unknown): number | undefined {
  const n = Number(v);
  return typeof v === "number" || (v != null && v !== "" && Number.isFinite(n))
    ? Number.isFinite(n)
      ? n
      : undefined
    : undefined;
}

export interface WatchingPollResult {
  watched: number;
  checked: number;
  timelines: number;
  alerted: number;
  /** Posts routed to the signal topic. */
  alertedSignal: number;
  /** Posts routed to the row-post topic. */
  alertedRow: number;
  /** Posts whose branch is switched off — dropped, watermark still advanced. */
  skippedDisabled: number;
  skippedUnchanged: number;
  /** Accounts seeded with no alerts — first sight, or an expired cursor re-seeded. */
  seeded: number;
  /** Accounts whose cursor was held back by a failed send. */
  held: number;
  rateLimited: boolean;
  error: string | null;
}

export async function pollWatchingProjects(): Promise<WatchingPollResult> {
  const result: WatchingPollResult = {
    watched: 0,
    checked: 0,
    timelines: 0,
    alerted: 0,
    alertedSignal: 0,
    alertedRow: 0,
    skippedDisabled: 0,
    skippedUnchanged: 0,
    seeded: 0,
    held: 0,
    rateLimited: false,
    error: null,
  };

  // Alerting is the only consumer of this poll — with both streams off there is
  // nothing to do, and polling anyway would silently burn through the watermarks.
  const [signalEnabled, rowEnabled] = await Promise.all([
    getConfig<boolean>(CONFIG_KEYS.watchingSignalEnabled, true),
    getConfig<boolean>(CONFIG_KEYS.watchingRowEnabled, true),
  ]);
  if (!signalEnabled && !rowEnabled) return result;

  const maxUsersRaw = await getConfig<number>(CONFIG_KEYS.watchingMaxUsers, MAX_USERS_FALLBACK);
  const tweetsPerUserRaw = await getConfig<number>(
    CONFIG_KEYS.watchingTweetsPerUser,
    TWEETS_PER_USER_FALLBACK,
  );
  const maxUsers = Number.isFinite(Number(maxUsersRaw)) ? Number(maxUsersRaw) : MAX_USERS_FALLBACK;
  const tweetsPerUser = Number.isFinite(Number(tweetsPerUserRaw))
    ? Number(tweetsPerUserRaw)
    : TWEETS_PER_USER_FALLBACK;
  // Admin-selected Watching topics; an explicit thread wins over alert-type routing.
  const routing: WatchingRouting = {
    signalEnabled,
    rowEnabled,
    signalTopicId: topicOrUndefined(
      await getConfig<number | null>(CONFIG_KEYS.watchingSignalTopicId, null),
    ),
    rowTopicId: topicOrUndefined(
      await getConfig<number | null>(CONFIG_KEYS.watchingRowTopicId, null),
    ),
  };

  const watchingAccounts = await prisma.twitterAccount.findMany({
    where: {
      project: {
        projectStatus: "watching",
      },
    },
    select: {
      id: true,
      username: true,
      name: true,
      followersCount: true,
      tweetCount: true,
      fxCursor: true,
      tags: true,
    },
    // Newest-enrolled first. With more watching projects than `maxUsers` the
    // tail never gets polled — raise watching.maxUsers (0 = no cap) if that bites.
    // orderBy: { firstSeenAt: "desc" },
    // ...(maxUsers > 0 ? { take: maxUsers } : {}),
  });

  result.watched = watchingAccounts.length;
  console.log(`[watching] Found ${watchingAccounts.length} accounts to poll`);

  if (watchingAccounts.length === 0) {
    return result;
  }

  const fx = new FxTwitterClient();

  for (const account of watchingAccounts) {
    const username = account.username.toLowerCase().replace(/^@+/, "");

    try {
      // `cursor.top` is X's "load newer" token, so a cursored response carries
      // only posts made since the last page we saw — no further filtering needed
      // (verified: 2 new posts back instead of a full 11-post page). The response
      // carries a refreshed cursor to store.
      //
      // (`since` would be the natural fit but the API 204s even when newer posts
      // exist, so it can't be used here.)
      let resp = await fx.getProfileStatuses(username, {
        count: tweetsPerUser,
        ...(account.fxCursor ? { cursor: account.fxCursor } : {}),
      });

      // An empty page is ambiguous: "nothing newer" on a live cursor, "this
      // cursor is dead" on a stale one. The tell is the refreshed cursor — a
      // live cursor still returns one, a dead cursor returns nothing.
      if (account.fxCursor && !resp?.results?.length && !resp?.cursor?.top) {
        // Dead cursor. Refetch the newest page to re-seed from it, but alert
        // nothing: the cursor is the only watermark, so there is nothing to
        // filter that page against and alerting it would dump the timeline into
        // Telegram. Posts made while the cursor was dead are skipped by design.
        resp = await fx.getProfileStatuses(username, { count: tweetsPerUser });
        await prisma.twitterAccount.update({
          where: { id: account.id },
          data: { fxCursor: resp?.cursor?.top ?? null },
        });
        result.checked++;
        result.seeded++;
        console.log(
          `[watching] @${username}: cursor expired — re-seeded, ` +
            `${resp?.results?.length ?? 0} posts skipped`,
        );
        continue;
      }

      if (!resp || !resp.results || resp.results.length === 0) {
        // Live cursor with nothing behind it: the healthy quiet answer, not a
        // failure. Count it and store the refreshed cursor — otherwise a normal
        // quiet cycle reports checked=0 and looks identical to an outage.
        const refreshed = resp?.cursor?.top ?? null;
        if (refreshed) {
          result.checked++;
          result.skippedUnchanged++;
          if (refreshed !== account.fxCursor) {
            await prisma.twitterAccount.update({
              where: { id: account.id },
              data: { fxCursor: refreshed },
            });
          }
          console.log(`[watching] @${username}: nothing newer`);
        } else {
          console.log(`[watching] @${username}: no tweets returned`);
        }
        continue;
      }

      result.timelines++;
      result.checked++;

      const tweets: APITwitterStatus[] = resp.results;
      const newCursor = resp.cursor?.top ?? null;

      // First sight: seed the cursor, alert nothing. Every other poller in this
      // codebase does the same so enrolling an account can't dump its whole
      // timeline into Telegram.
      if (!account.fxCursor) {
        await prisma.twitterAccount.update({
          where: { id: account.id },
          data: { fxCursor: newCursor },
        });
        result.seeded++;
        console.log(
          `[watching] @${username}: seeded cursor=${newCursor ?? "none"} (fetched=${tweets.length})`,
        );
        continue;
      }

      // Everything on a cursored page is new. Oldest first so alerts arrive in
      // posting order.
      const newTweets = [...tweets].sort((a, b) => {
        const an = toSnowflake(a.id) ?? 0n;
        const bn = toSnowflake(b.id) ?? 0n;
        return an < bn ? -1 : an > bn ? 1 : 0;
      });

      console.log(`[watching] @${username}: ${newTweets.length} new`);

      // The cursor only moves once the whole page reached Telegram. It is
      // page-granular, not per-post, so a mid-batch failure has to hold the
      // entire page and the retry re-sends whatever already went out —
      // at-least-once on purpose, since a duplicate beats a dropped alert.
      let failed = false;

      for (const tweet of newTweets) {
        // skip if repost 
        if (tweet.reposted_by) continue
        
        // DB rules first (mint live, wl application, …), legacy lexicon as fallback —
        // same order listPoller uses, so both pollers agree on what a signal is.
        let signals = await detectSignalsWithRules(tweet.text, account.tags, {
          structuralFallback: true,
        });
        if (signals.length === 0) {
          signals = detectSignals(tweet.text, account.tags[0]);
        }

        const route = routeWatchingTweet(signals, routing);

        if (!route.enabled) {
          result.skippedDisabled++;
          console.log(`[watching] @${username}: ${tweet.id} ${route.branch} stream off — dropped`);
          continue;
        }

        const msg = formatWatchingAlert({
          accountId: account.id,
          username,
          name: tweet.author?.name ?? account.name,
          text: tweet.text,
          tweetId: tweet.id,
          followersCount: account.followersCount ?? 0,
          tweetCount: account.tweetCount ?? 0,
          tags: account.tags,
          signals,
        });

        try {
          await sendTelegramAlert(msg, "MarkdownV2", route.topicId, "monitor");
        } catch (err) {
          failed = true;
          console.error(
            `[watching] @${username}: send ${tweet.id} failed — ${err instanceof Error ? err.message : String(err)}`,
          );
          break;
        }

        result.alerted++;
        if (route.branch === "signal") result.alertedSignal++;
        else result.alertedRow++;
        console.log(
          `[watching] @${username}: ${tweet.id} → ${route.branch} topic ${route.topicId ?? "default"}` +
            (signals.length ? ` [${signals.join(",")}]` : ""),
        );
      }

      if (failed) {
        result.held++;
        console.log(`[watching] @${username}: cursor held — page retried next cycle`);
        continue;
      }

      if (newCursor !== account.fxCursor) {
        await prisma.twitterAccount.update({
          where: { id: account.id },
          data: { fxCursor: newCursor },
        });
      }
      console.log(`[watching] @${username}: cursor advanced`);
    } catch (err) {
      if (err instanceof FxTwitterError && err.status === 429) {
        result.rateLimited = true;
        console.warn(`[watching] @${username}: rate limited — stopping cycle`);
        break;
      }
      console.error(`[watching] @${username}: error ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/** Get current config for the watching scheduler. */
export async function getWatchingConfig() {
  const intervalMs = await getConfig<number>(CONFIG_KEYS.watchingIntervalMs, 3600000);
  return { intervalMs };
}
