// Watching poller — monitors projects with projectStatus = 'watching'.
//
// Flow per cycle:
//   1. Fetch all TwitterAccount rows with projectStatus = 'watching'
//   2. Use FxTwitter getProfileStatuses to fetch each user's latest tweets
//   3. Filter to tweets newer than lastTweetId watermark
//   4. Send Telegram alerts for new posts
//   5. Update lastTweetId watermark

import { prisma } from "../db/prisma.js";
import { FxTwitterClient } from "../fxTwitter/fxTwitterClient.js";
import type { APITwitterStatus } from "../fxTwitter/types.js";
import { getConfig } from "./appConfig.js";
import { sendTelegramAlert } from "../tg/sendAlert.js";
import { toSnowflake } from "./pollerCore.js";

const TWEETS_PER_USER = Number(process.env.WATCHING_POLL_COUNT ?? 20);
const MAX_USERS_PER_POLL = Number(process.env.WATCHING_MAX_USERS ?? 10);

export interface WatchingPollResult {
  watched: number;
  checked: number;
  timelines: number;
  alerted: number;
  skippedUnchanged: number;
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
    rateLimited: false,
    error: null,
  };

  // Get all accounts with watching status
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
    orderBy: { firstSeenAt: "desc" },
    take: MAX_USERS_PER_POLL,
  });

  result.watched = watchingAccounts.length;
  console.log(`[watching] Found ${watchingAccounts.length} accounts to poll`);

  if (watchingAccounts.length === 0) {
    return result;
  }

  // Check if alerts are enabled
  const signalEnabled = await getConfig<boolean>("watching.signalEnabled", true);
  const rowEnabled = await getConfig<boolean>("watching.rowEnabled", true);

  if (!signalEnabled && !rowEnabled) {
    return result;
  }

  const fx = new FxTwitterClient();
  let timelinesRemaining = MAX_USERS_PER_POLL;

  for (const account of watchingAccounts) {
    if (timelinesRemaining <= 0) break;

    const username = account.username.toLowerCase().replace(/^@+/, "");

    try {
      // Fetch user timeline via FxTwitter (no cursor — always get latest tweets)
      const resp = await fx.getProfileStatuses(username, { count: TWEETS_PER_USER });

      if (!resp || !resp.results || resp.results.length === 0) {
        console.log(`[watching] @${username}: no tweets returned`);
        continue;
      }

      result.timelines++;
      result.checked++;

      const tweets: APITwitterStatus[] = resp.results;

      // Update fxCursor for pagination reference
      const newCursor = resp.cursor?.top ?? null;
      if (newCursor !== account.fxCursor) {
        await prisma.twitterAccount.update({
          where: { id: account.id },
          data: { fxCursor: newCursor },
        });
      }

      // Filter to only new tweets (snowflake id > last known)
      const newTweets = account.lastTweetId
        ? tweets.filter((t) => (toSnowflake(t.id) ?? 0n) > (toSnowflake(account.lastTweetId) ?? 0n))
        : tweets;

      console.log(`[watching] @${username}: got ${tweets.length} tweets, ${newTweets.length} new`);

      if (newTweets.length > 0 && signalEnabled) {
        for (const tweet of newTweets) {
          const alertMsg = formatWatchingAlert({
            username,
            name: tweet.author?.name ?? account.name,
            text: tweet.text,
            tweetId: tweet.id,
            followersCount: account.followersCount ?? 0,
            tweetCount: account.tweetCount ?? 0,
          });

          if (alertMsg) {
            await sendTelegramAlert({
              text: alertMsg,
              user: { id: tweet.author?.id ?? account.id, username, name: tweet.author?.name ?? account.name },
            }, "MarkdownV2", undefined, "monitor");
            result.alerted++;
          }
        }
      } else if (newTweets.length === 0) {
        result.skippedUnchanged++;
      }

      // Advance watermark to the newest tweet we've seen
      if (tweets.length > 0) {
        const newest = tweets.reduce((max, t) => (toSnowflake(t.id) ?? 0n) > (toSnowflake(max) ?? 0n) ? t.id : max, account.lastTweetId ?? "");
        if (newest && newest !== account.lastTweetId) {
          await prisma.twitterAccount.update({
            where: { id: account.id },
            data: { lastTweetId: newest },
          });
        }
      }
    } catch (err) {
      console.error(`[watching] @${username}: error ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

interface FormatWatchingAlertOpts {
  username: string;
  name: string;
  text: string;
  tweetId: string;
  followersCount: number;
  tweetCount: number;
}

function formatWatchingAlert(opts: FormatWatchingAlertOpts): string | null {
  const { username, name, text, tweetId, followersCount, tweetCount } = opts;

  const displayName = name ? `${name} (@${username})` : `@${username}`;

  // Truncate long tweets
  const truncatedText =
    text.length > 280 ? text.slice(0, 280) + "…" : text;

  return `👀 *Watching: ${displayName}*

${truncatedText}

👥 Followers: ${followersCount.toLocaleString()}
🐦 Tweets: ${tweetCount.toLocaleString()}

<a href="https://x.com/${username}/status/${tweetId}">View Tweet</a>`;
}

/** Get current config for the watching scheduler. */
export async function getWatchingConfig() {
  const intervalMs = await getConfig<number>("watching.intervalMs", 3600000);
  return { intervalMs };
}
