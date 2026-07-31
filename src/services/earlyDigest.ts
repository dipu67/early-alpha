// Early-project digest — scheduled 09:00 & 21:00 (every 12h, clock-aligned).
// Summarizes projects firstSeen in the last 12 hours and routes each to its
// tag's Telegram topic (nft, gamefi, …). Untagged destinations use the general
// "early project" topic.

import { prisma } from "../db/prisma.js";
import { tagLabel, DEFAULT_SLUG } from "./projectTagger.js";
import { ALPHA_SLUG } from "./projectLists.js";
import {
  earlyTopicForSlug,
  earlyProjectTopic,
  sendTelegramRichMarkdown,
  isAlertEnabled,
} from "../tg/sendAlert.js";
import { escapeMarkdown, formatNumber, mdLink, mdUserLink, mdCode } from "./formatAlert.js";

const WINDOW_HOURS = Number(process.env.EARLY_DIGEST_WINDOW_HOURS ?? 12);
const MAX_PER_TOPIC = Number(process.env.EARLY_DIGEST_MAX ?? 40);

const EXCLUDED = new Set([DEFAULT_SLUG, "other", ALPHA_SLUG]);

interface DigestAccount {
  username: string;
  name: string;
  tags: string[];
  followersCount: number | null;
}

function typedTags(tags: string[]): string[] {
  return tags.filter((t) => !EXCLUDED.has(t));
}

async function routeProject(tags: string[]): Promise<{ key: string; topicId: number | undefined; label: string }> {
  for (const slug of typedTags(tags)) {
    const topicId = await earlyTopicForSlug(slug);
    if (topicId !== undefined) {
      return { key: `t:${topicId}:${slug}`, topicId, label: tagLabel(slug) };
    }
  }
  const general = await earlyProjectTopic();
  return { key: `general:${general ?? "default"}`, topicId: general, label: "Early Projects" };
}

function projectLine(a: DigestAccount): string {
  const labels = typedTags(a.tags).map(tagLabel);
  const tagStr = labels.length ? ` — ${escapeMarkdown(labels.join(", "))}` : "";
  const followers = a.followersCount ? ` (${escapeMarkdown(formatNumber(a.followersCount))})` : "";
  return `• ${mdUserLink(a.username)}${followers}${tagStr}\n`;
}

function chunkProjects<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, size);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out.length > 0 ? out : [[]];
}

function buildDigestMessage(opts: {
  label: string;
  window: string;
  page: DigestAccount[];
  part: number;
  parts: number;
  total: number;
}): string {
  const { label, window, page, part, parts, total } = opts;
  const partLabel = parts > 1 ? ` · part ${part}/${parts}` : "";
  const lines = [
    `🆕 *Early Projects · ${escapeMarkdown(label)}* (last ${escapeMarkdown(window)}${partLabel})`,
    `━━━━━━━━━━━━━━━━━━\n`,
    ...page.map(projectLine),
    `━━━━━━━━━━━━━━━━━━\n`,
  ];
  if (parts > 1) {
    const from = (part - 1) * MAX_PER_TOPIC + 1;
    const to = (part - 1) * MAX_PER_TOPIC + page.length;
    lines.push(`*Showing:* ${from}\–${to} of ${total}`);
    if (part < parts) lines.push(`_Continued in next message…_`);
    else lines.push(`*Total:* ${total}`);
  } else {
    lines.push(`*Total:* ${total}`);
  }
  return lines.join("\n");
}

export async function sendEarlyProjectDigest(): Promise<number> {
  if (!(await isAlertEnabled("earlyDigest"))) {
    console.log("[early-digest] disabled via config");
    const { markEarlyDigestSent } = await import("./digestCatchUp.js");
    await markEarlyDigestSent();
    return 0;
  }
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  const accounts = await prisma.twitterAccount.findMany({
    where: { firstSeenAt: { gte: since } },
    orderBy: { followersCount: { sort: "desc", nulls: "last" } },
    select: { username: true, name: true, tags: true, followersCount: true },
  });

  if (accounts.length === 0) {
    console.log("[early-digest] no new projects in the last 12h");
    const { markEarlyDigestSent } = await import("./digestCatchUp.js");
    await markEarlyDigestSent();
    return 0;
  }

  const buckets = new Map<string, { topicId: number | undefined; label: string; accounts: DigestAccount[] }>();
  for (const a of accounts) {
    const { key, topicId, label } = await routeProject(a.tags);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { topicId, label, accounts: [] };
      buckets.set(key, bucket);
    }
    bucket.accounts.push(a);
  }

  const window = `${WINDOW_HOURS}h`;
  let messages = 0;

  for (const bucket of buckets.values()) {
    const pages = chunkProjects(bucket.accounts, MAX_PER_TOPIC);
    const parts = pages.length;
    const total = bucket.accounts.length;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      const text = buildDigestMessage({ label: bucket.label, window, page, part: i + 1, parts, total });
      await sendTelegramRichMarkdown({
        markdown: text,
        topicId: bucket.topicId ?? null,
        alertType: "earlyDigest",
      });
      messages += 1;
    }
    if (parts > 1) console.log(`[early-digest] ${bucket.label}: ${total} projects in ${parts} messages`);
  }

  const { markEarlyDigestSent } = await import("./digestCatchUp.js");
  await markEarlyDigestSent();
  console.log(`[early-digest] sent ${accounts.length} projects · ${buckets.size} topic(s) · ${messages} message(s)`);
  return accounts.length;
}
