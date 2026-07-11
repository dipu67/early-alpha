// Early-project digest — every 12h, summarize the projects detected in the last
// 12 hours and route each to its tag's Telegram topic (nft, gamefi, …). Projects
// whose tag has no dedicated topic roll into the general "early project" topic.
//
// Grouping is per-project by a single primary topic: the first of the project's
// typed tags that has a mapped topic wins; otherwise the general topic. This
// keeps a project to one digest entry instead of duplicating it across topics.

import { prisma } from "../db/prisma.js";
import { tagLabel, DEFAULT_SLUG } from "./projectTagger.js";
import { ALPHA_SLUG } from "./projectLists.js";
import {
  earlyTopicForSlug,
  earlyProjectTopic,
  sendTelegramTopic,
} from "../tg/sendAlert.js";
import { escapeMarkdown, formatNumber } from "./formatAlert.js";

/** Digest window in hours (default 12). */
const WINDOW_HOURS = Number(process.env.EARLY_DIGEST_WINDOW_HOURS ?? 12);
/** Max projects listed per topic message. */
const MAX_PER_TOPIC = Number(process.env.EARLY_DIGEST_MAX ?? 40);

const EXCLUDED = new Set([DEFAULT_SLUG, "other", ALPHA_SLUG]);

interface DigestAccount {
  username: string;
  name: string;
  tags: string[];
  followersCount: number | null;
}

/** A project's real type tags (excludes unknown/other/alpha). */
function typedTags(tags: string[]): string[] {
  return tags.filter((t) => !EXCLUDED.has(t));
}

/**
 * Resolve which topic a project belongs to, and a label for the bucket header.
 * First typed tag with a mapped topic wins; otherwise the general early-project
 * topic. The bucket key groups projects that share a destination.
 */
function routeProject(tags: string[]): { key: string; topicId: number | undefined; label: string } {
  for (const slug of typedTags(tags)) {
    const topicId = earlyTopicForSlug(slug);
    if (topicId !== undefined) {
      return { key: `t:${topicId}:${slug}`, topicId, label: tagLabel(slug) };
    }
  }
  const general = earlyProjectTopic();
  return { key: `general:${general ?? "default"}`, topicId: general, label: "Early Projects" };
}

/** One line per project in a digest message. */
function projectLine(a: DigestAccount): string {
  const labels = typedTags(a.tags).map(tagLabel);
  const tagStr = labels.length ? ` — ${escapeMarkdown(labels.join(", "))}` : "";
  const followers = a.followersCount
    ? ` \\(${escapeMarkdown(formatNumber(a.followersCount))}\\)`
    : "";
  return `• [@${escapeMarkdown(a.username)}](https://x.com/${a.username})${followers}${tagStr}`;
}

/**
 * Build and send the 12h early-project digest, one message per destination topic.
 * Returns the number of projects included.
 */
export async function sendEarlyProjectDigest(): Promise<number> {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  const accounts = await prisma.twitterAccount.findMany({
    where: { firstSeenAt: { gte: since } },
    orderBy: { followersCount: { sort: "desc", nulls: "last" } },
    select: { username: true, name: true, tags: true, followersCount: true },
  });

  if (accounts.length === 0) {
    console.log("[early-digest] no new projects in the last 12h");
    return 0;
  }

  // Group by destination topic.
  const buckets = new Map<
    string,
    { topicId: number | undefined; label: string; accounts: DigestAccount[] }
  >();
  for (const a of accounts) {
    const { key, topicId, label } = routeProject(a.tags);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { topicId, label, accounts: [] };
      buckets.set(key, bucket);
    }
    bucket.accounts.push(a);
  }

  const window = `${WINDOW_HOURS}h`;
  for (const bucket of buckets.values()) {
    const shown = bucket.accounts.slice(0, MAX_PER_TOPIC);
    const extra = bucket.accounts.length - shown.length;

    const lines = [
      `🆕 *Early Projects · ${escapeMarkdown(bucket.label)}* \\(last ${escapeMarkdown(window)}\\)`,
      `━━━━━━━━━━━━━━━━━━`,
      ...shown.map(projectLine),
    ];
    if (extra > 0) lines.push(`…and ${extra} more`);
    lines.push(`━━━━━━━━━━━━━━━━━━`, `*Total:* ${bucket.accounts.length}`);

    await sendTelegramTopic(lines.join("\n"), bucket.topicId);
  }

  console.log(
    `[early-digest] sent ${accounts.length} projects across ${buckets.size} topic(s)`,
  );
  return accounts.length;
}
