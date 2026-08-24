// Watching poller — monitors projects with projectStatus = 'watching'.
//
// Flow per cycle:
//   1. Fetch TwitterAccount rows whose Project has projectStatus = 'watching'
//   2. Fetch each user's timeline via FxTwitter getProfileStatuses, passing the
//      stored fxCursor (`cursor.top`) so X returns only posts newer than the last
//      page we saw. No cursor yet, or an empty cursored page, falls back to the
//      newest page.
//   3. First sight of an account seeds lastTweetId + fxCursor only (no backlog flood)
//   4. Else, for every tweet with snowflake id > lastTweetId, run signal
//      detection: a match routes the alert to the signal topic, no match routes
//      it to the row-post topic (see routeWatchingTweet)
//   5. Advance lastTweetId only past tweets that actually reached Telegram —
//      a failed send holds the watermark so the post is retried next cycle.
//      A branch the admin turned off still advances: "off" means drop, not defer.

import { prisma } from "../db/prisma.js";
import { FxTwitterClient, FxTwitterError } from "../fxTwitter/fxTwitterClient.js";
import type { APITwitterStatus } from "../fxTwitter/types.js";
import { CONFIG_KEYS, getConfig } from "./appConfig.js";
import { formatWatchingAlert } from "./formatAlert.js";
import { detectSignalsWithRules } from "./signalRules.js";
import { detectSignals } from "./postSignals.js";
import { sendTelegramAlert } from "../tg/sendAlert.js";
import { maxSnowflake, toSnowflake } from "./pollerCore.js";

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
  /** Accounts seeded on first sight (watermark set, no alerts). */
  seeded: number;
  /** Accounts whose watermark was held back by a failed send. */
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
      lastTweetId: true,
      tags: true,
    },
    // Newest-enrolled first. With more watching projects than `maxUsers` the
    // tail never gets polled — raise watching.maxUsers (0 = no cap) if that bites.
    orderBy: { firstSeenAt: "desc" },
    ...(maxUsers > 0 ? { take: maxUsers } : {}),
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
      // Ask only for posts newer than the last page we saw: `cursor.top` is X's
      // "load newer" token (verified: 2 new posts back instead of a full 11-post
      // page), and the response carries a refreshed cursor to store.
      //
      // The cursor is an optimization — lastTweetId stays the watermark of record.
      // An empty page is ambiguous: "nothing newer" on a live cursor, "nothing at
      // all" on a stale one, and both are common. The tell is the refreshed cursor:
      // a live cursor still returns one, a dead one returns nothing. Only that
      // second case is refetched uncursored, so a quiet account stays one request.
      // (`since` would be the natural fit but the API 204s even when newer posts
      // exist, so it can't be used here.)
      let resp = await fx.getProfileStatuses(username, {
        count: tweetsPerUser,
        ...(account.fxCursor ? { cursor: account.fxCursor } : {}),
      });

      if (account.fxCursor && !resp?.results?.length && !resp?.cursor?.top) {
        resp = await fx.getProfileStatuses(username, { count: tweetsPerUser });
        console.log(
          `[watching] @${username}: cursor expired — refetched newest page ` +
            `(${resp?.results?.length ?? 0} tweets, filtered by watermark)`,
        );
      }

      if (!resp || !resp.results || resp.results.length === 0) {
        // An empty page from a live cursor is the healthy "nothing newer" answer,
        // not a failure. Count it and store the refreshed cursor — otherwise a
        // normal quiet cycle reports checked=0 and looks identical to an outage.
        const emptyCursor = resp?.cursor?.top ?? null;
        if (emptyCursor) {
          result.checked++;
          result.skippedUnchanged++;
          if (emptyCursor !== account.fxCursor) {
            await prisma.twitterAccount.update({
              where: { id: account.id },
              data: { fxCursor: emptyCursor },
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
      const newCursor = resp.cursor?.top;
      const pageNewest = maxSnowflake(tweets.map((t) => t.id));

      // First sight: seed the watermarks, alert nothing. Every other poller in
      // this codebase does the same so enrolling an account can't dump its
      // whole timeline into Telegram.
      //
      // Seed lastTweetId, not just the cursor: it is the dedup backstop for any
      // page that arrives uncursored (first sight, a cleared cursor, the stale-
      // cursor retry above). With it null, cutoff is null and every post on such
      // a page reads as new — a full-page flood.
      if (!account.lastTweetId) {
        await prisma.twitterAccount.update({
          where: { id: account.id },
          data: { lastTweetId: pageNewest, fxCursor: newCursor },
        });
        result.seeded++;
        console.log(
          `[watching] @${username}: seeded lastTweetId=${pageNewest ?? "none"} (fetched=${tweets.length})`,
        );
        continue;
      }

      const cutoff = toSnowflake(account.lastTweetId);
      // Oldest first so alerts arrive in posting order and a mid-batch failure
      // leaves the watermark on a contiguous prefix.
      const newTweets = tweets
        .filter((t) => {
          const n = toSnowflake(t.id);
          return n == null ? t.id !== account.lastTweetId : cutoff == null || n > cutoff;
        })
        .sort((a, b) => {
          const an = toSnowflake(a.id) ?? 0n;
          const bn = toSnowflake(b.id) ?? 0n;
          return an < bn ? -1 : an > bn ? 1 : 0;
        });

      console.log(`[watching] @${username}: got ${tweets.length} tweets, ${newTweets.length} new`);

      if (newTweets.length === 0) {
        result.skippedUnchanged++;
        if (newCursor !== account.fxCursor) {
          await prisma.twitterAccount.update({
            where: { id: account.id },
            data: { fxCursor: newCursor },
          });
        }
        continue;
      }

      // Advance only past posts that reached Telegram (or were dropped on
      // purpose by an off switch). A send failure stops the batch, so the
      // watermark holds and the post is retried next cycle instead of being
      // silently lost.
      let advanceTo: string | null = null;
      let failed = false;

      for (const tweet of newTweets) {
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
          advanceTo = maxSnowflake([advanceTo, tweet.id]);
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
        advanceTo = maxSnowflake([advanceTo, tweet.id]);
      }

      if (failed) result.held++;

      const data: { lastTweetId?: string; fxCursor?: string | null } = {};
      if (advanceTo && advanceTo !== account.lastTweetId) data.lastTweetId = advanceTo;
      if (!failed && newCursor !== account.fxCursor) data.fxCursor = newCursor;
      if (Object.keys(data).length > 0) {
        await prisma.twitterAccount.update({ where: { id: account.id }, data });
      }

      console.log(
        `[watching] @${username}: watermark ${account.lastTweetId} → ` +
          (data.lastTweetId ?? `${account.lastTweetId} (held)`),
      );
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
