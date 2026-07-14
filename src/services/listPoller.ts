// List poller — scans each project list's newest posts for time-sensitive
// signals (mint dates, TGE, launches, …) and alerts on them. Also drives
// post-based reclassification: when an "alpha" (untyped) project's post reveals
// its vertical, it's moved into the matching type list(s).
//
// Dedupe is keyed on tweetId via the PostAlert table, so a project in several
// lists that posts one mint tweet alerts exactly once.

import { prisma } from "../db/prisma.js";
import type { TwitterClient } from "../TwitterClient/index.js";
import type { TweetData } from "../TwitterClient/types.js";
import { markRateLimited } from "../twitter/getClient.js";
import { detectSignals } from "./postSignals.js";
import { detectSignalsWithRules } from "./signalRules.js";
import { classifyText } from "./projectTagger.js";
import { reclassifyAccount, ALPHA_SLUG, type ListSyncCtx } from "./projectLists.js";
import { sendTelegramAlert, topicForSlug, isAlertEnabled } from "../tg/sendAlert.js";
import { formatSignalAlert, formatReclassifyAlert } from "./formatAlert.js";
import { prunePostAlertsForSlug } from "./postAlerts.js";

/** Tweets fetched per list per cycle. */
const TWEETS_PER_LIST = Number(process.env.LIST_POLL_COUNT ?? 40);
/** Small gap between list fetches so we don't burst the timeline endpoint. */
const LIST_FETCH_DELAY_MS = Number(process.env.LIST_FETCH_DELAY_MS ?? 800);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Parse a tweet's created_at into a Date, or undefined if absent/invalid. */
function postedAt(tweet: TweetData): Date | undefined {
  if (!tweet.createdAt) return undefined;
  const d = new Date(tweet.createdAt);
  return isNaN(d.getTime()) ? undefined : d;
}

/** Safe BigInt parse of a snowflake id string; 0n if not numeric. */
function toId(id: string): bigint {
  try {
    return BigInt(id);
  } catch {
    return 0n;
  }
}

/** The lexically/numerically largest snowflake id in a batch, as a string. */
function maxTweetId(tweets: TweetData[]): string | undefined {
  let max: bigint | undefined;
  let maxStr: string | undefined;
  for (const t of tweets) {
    const n = toId(t.id);
    if (max === undefined || n > max) {
      max = n;
      maxStr = t.id;
    }
  }
  return maxStr;
}

/**
 * Poll every project list once. Only tweets newer than the list's stored
 * high-water mark (`lastTweetId`) are processed — so old posts already on the
 * timeline when a list is first created never fire alerts. The first poll of a
 * list just records the newest id as a baseline and alerts on nothing.
 */
export async function pollAllLists(ctx: ListSyncCtx): Promise<void> {
  const lists = await prisma.projectList.findMany({
    orderBy: { lastPolledAt: { sort: "asc", nulls: "first" } },
  });

  for (const list of lists) {
    const res = await ctx.client.getListTweets(list.twitterListId, TWEETS_PER_LIST);
    if (res.rateLimit && res.rateLimit.remaining === 0) {
      await markRateLimited(ctx.authAccountId, res.rateLimit.reset);
    }
    if (!res.success || !res.tweets) {
      console.warn(`[lists] poll ${list.slug} failed: ${res.error ?? "unknown"}`);
      continue;
    }

    const newest = maxTweetId(res.tweets);

    if (list.lastTweetId === null) {
      // First time we see this list: baseline only, don't alert on the backlog.
      await prisma.projectList.update({
        where: { id: list.id },
        data: { lastTweetId: newest ?? null, lastPolledAt: new Date() },
      });
      if (LIST_FETCH_DELAY_MS > 0) await sleep(LIST_FETCH_DELAY_MS);
      continue;
    }

    // Only tweets strictly newer than the high-water mark, oldest→newest so
    // alerts arrive in chronological order.
    const cutoff = toId(list.lastTweetId);
    const fresh = res.tweets
      .filter((t) => toId(t.id) > cutoff)
      .sort((a, b) => (toId(a.id) < toId(b.id) ? -1 : 1));

    for (const tweet of fresh) {
      await handleTweet(ctx, list.slug, tweet);
    }

    await prisma.projectList.update({
      where: { id: list.id },
      data: {
        lastTweetId: newest ?? list.lastTweetId,
        lastPolledAt: new Date(),
      },
    });

    if (LIST_FETCH_DELAY_MS > 0) await sleep(LIST_FETCH_DELAY_MS);
  }
}

/** Process one tweet from a given list slug. */
async function handleTweet(ctx: ListSyncCtx, slug: string, tweet: TweetData): Promise<void> {
  // Skip anything we've already alerted on (dedupe across lists).
  const seen = await prisma.postAlert.findUnique({ where: { tweetId: tweet.id } });
  if (seen) return;

  const accountId = tweet.author.username
    ? await resolveAccountId(tweet)
    : null;

  // Prefer DB rules (mint live, wl application, …); fall back to hardcoded lexicon
  let signals = await detectSignalsWithRules(tweet.text, slug);
  if (signals.length === 0) {
    signals = detectSignals(tweet.text, slug);
  }

  // Alpha projects: a post that reveals a type reclassifies the account, even
  // without a time-sensitive signal.
  let reclassifiedTo: string[] | null = null;
  if (slug === ALPHA_SLUG && accountId) {
    const found = await classifyText(tweet.text);
    if (found.length > 0) {
      const result = await reclassifyAccount(ctx, accountId, found);
      if (result && result.added.length > 0) {
        reclassifiedTo = result.added;
        if (await isAlertEnabled("reclassify")) {
          await sendTelegramAlert(
            formatReclassifyAlert({
              accountId,
              username: tweet.author.username,
              name: tweet.author.name,
              from: ALPHA_SLUG,
              to: result.added,
              signals,
              tweetId: tweet.id,
            }),
            "MarkdownV2",
            await topicForSlug(result.added[0] ?? slug),
            "reclassify",
          );
        }
      }
    }
  }

  // Signal alert (deduped by inserting PostAlert first). Reclassification alerts
  // already fired above and are independent of signal presence.
  if (signals.length === 0) return;

  const alertSlug = reclassifiedTo?.[0] ?? slug;

  try {
    await prisma.postAlert.create({
      data: {
        tweetId: tweet.id,
        accountId: accountId ?? tweet.author.username,
        username: tweet.author.username,
        slug: alertSlug,
        signals,
        text: tweet.text,
        postedAt: postedAt(tweet) ?? null,
      },
    });
  } catch {
    // Unique-violation race: another cycle already alerted this tweet.
    return;
  }
  try {
    await prunePostAlertsForSlug(alertSlug);
  } catch (err) {
    console.warn(`[list-poll] prune slug=${alertSlug}:`, err);
  }
  if (!(await isAlertEnabled("signal"))) return;
  await sendTelegramAlert(
    formatSignalAlert({
      accountId: accountId ?? tweet.author.username,
      username: tweet.author.username,
      name: tweet.author.name,
      slug: alertSlug,
      signals,
      text: tweet.text,
      tweetId: tweet.id,
    }),
    "MarkdownV2",
    await topicForSlug(alertSlug),
    "signal",
  );
}

/**
 * Resolve the TwitterAccount id for a tweet's author. Prefer an existing row by
 * username (our accounts are keyed by Twitter id, but list members were added by
 * id so the row exists); fall back to the username string.
 */
async function resolveAccountId(tweet: TweetData): Promise<string | null> {
  const row = await prisma.twitterAccount.findUnique({
    where: { username: tweet.author.username },
    select: { id: true },
  });
  return row?.id ?? null;
}
