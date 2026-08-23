// Watching poller — monitors projects with projectStatus = 'watching'.
//
// Flow per cycle:
//   1. Fetch TwitterAccount rows whose Project has projectStatus = 'watching'
//   2. Use FxTwitter getProfileStatuses to fetch each user's latest tweets
//   3. First sight of an account seeds lastTweetId only (no backlog flood)
//   4. Else alert on every tweet with snowflake id > lastTweetId
//   5. Advance lastTweetId only past tweets that actually reached Telegram —
//      a failed send holds the watermark so the post is retried next cycle.

import { prisma } from "../db/prisma.js";
import { FxTwitterClient, FxTwitterError } from "../fxTwitter/fxTwitterClient.js";
import type { APITwitterStatus } from "../fxTwitter/types.js";
import { CONFIG_KEYS, getConfig } from "./appConfig.js";
import { formatWatchingAlert } from "./formatAlert.js";
import { sendTelegramAlert } from "../tg/sendAlert.js";
import { maxSnowflake, toSnowflake } from "./pollerCore.js";

/** Env values are fallbacks only — the Setting keys override them at runtime. */
const TWEETS_PER_USER_FALLBACK = Number(process.env.WATCHING_POLL_COUNT ?? 20);
const MAX_USERS_FALLBACK = Number(process.env.WATCHING_MAX_USERS ?? 10);

export interface WatchingPollResult {
  watched: number;
  checked: number;
  timelines: number;
  alerted: number;
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
    skippedUnchanged: 0,
    seeded: 0,
    held: 0,
    rateLimited: false,
    error: null,
  };

  // Alerting is the only consumer of this poll — with it off there is nothing
  // to do, and polling anyway would silently burn through the watermarks.
  const signalEnabled = await getConfig<boolean>(CONFIG_KEYS.watchingSignalEnabled, true);
  if (!signalEnabled) return result;

  const maxUsersRaw = await getConfig<number>(CONFIG_KEYS.watchingMaxUsers, MAX_USERS_FALLBACK);
  const tweetsPerUserRaw = await getConfig<number>(
    CONFIG_KEYS.watchingTweetsPerUser,
    TWEETS_PER_USER_FALLBACK,
  );
  const maxUsers = Number.isFinite(Number(maxUsersRaw)) ? Number(maxUsersRaw) : MAX_USERS_FALLBACK;
  const tweetsPerUser = Number.isFinite(Number(tweetsPerUserRaw))
    ? Number(tweetsPerUserRaw)
    : TWEETS_PER_USER_FALLBACK;
  // Admin-selected Watching topic; explicit thread wins over alert-type routing.
  const topicId = await getConfig<number | null>(CONFIG_KEYS.watchingSignalTopicId, null);
  const thread = typeof topicId === "number" && Number.isFinite(topicId) ? topicId : undefined;

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
      // No cursor — always ask for the newest page; lastTweetId is the watermark.
      const resp = await fx.getProfileStatuses(username, { count: tweetsPerUser });

      if (!resp || !resp.results || resp.results.length === 0) {
        console.log(`[watching] @${username}: no tweets returned`);
        continue;
      }

      result.timelines++;
      result.checked++;

      const tweets: APITwitterStatus[] = resp.results;
      const newCursor = resp.cursor?.top ?? null;
      const pageNewest = maxSnowflake(tweets.map((t) => t.id));

      // First sight: seed the watermark, alert nothing. Every other poller in
      // this codebase does the same so enrolling an account can't dump its
      // whole timeline into Telegram.
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

      // Advance only past posts that reached Telegram. A send failure stops the
      // batch, so the watermark holds and the post is retried next cycle instead
      // of being silently dropped.
      let advanceTo: string | null = null;
      let failed = false;

      for (const tweet of newTweets) {
        const msg = formatWatchingAlert({
          accountId: account.id,
          username,
          name: tweet.author?.name ?? account.name,
          text: tweet.text,
          tweetId: tweet.id,
          followersCount: account.followersCount ?? 0,
          tweetCount: account.tweetCount ?? 0,
          tags: account.tags,
        });

        try {
          await sendTelegramAlert(msg, "MarkdownV2", thread, "monitor");
        } catch (err) {
          failed = true;
          console.error(
            `[watching] @${username}: send ${tweet.id} failed — ${err instanceof Error ? err.message : String(err)}`,
          );
          break;
        }

        result.alerted++;
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
