import type { UserData } from "../TwitterClient/types.js";

export function formatNewFollowAlert(
  watchedUsername: string,
  newFollow: UserData,
  rank?: number,
): {text: string, user: UserData} {
  const verified = newFollow.isBlueVerified ? " ✅" : "";
  const description = newFollow.description
    ? `\n${escapeMarkdown(newFollow.description)}`
    : "";

  const accountAge = newFollow.createdAt
    ? getAccountAge(newFollow.createdAt)
    : "Unknown";
  const followerTier = getFollowerTier(newFollow.followersCount ?? 0);
  const msg = {
    text:
      `🔔 *New Follow Detected*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 *${escapeMarkdown(newFollow.name)}${verified}*\n` +
      `🐦 [@${escapeMarkdown(newFollow.username)}](https://x.com/${newFollow.username}) \nBio: \n${description}\n\n` +
      `📊 *Stats*\n` +
      `├ ${followerTier} Followers: \`${formatNumber(newFollow.followersCount ?? 0)}\`\n` +
      `├ 🐦 Tweets: \`${formatNumber(newFollow.tweetCount ?? 0)}\`\n` +
      `├ ❤️ Likes: \`${formatNumber(newFollow.likeCount ?? 0)}\`\n` +
      `└ 🕐 Account Age: \`${accountAge}\`\n\n` +
      `Watched: @${escapeMarkdown(watchedUsername)}\n` +
      `━━━━━━━━━━━━━━━━━━\n` ,
      user: newFollow,
  }

  return msg;
}

export interface ConvergenceAlertData {
  targetUsername: string;
  targetName: string;
  targetBio: string | null;
  targetFollowerCount: number;
  targetAccountAge: string | null;
  seedUsernames: string[];
  categories: string[];
  score: number;
}

export function formatConvergenceAlert(data: ConvergenceAlertData): string {
  const categoryTags =
    data.categories.length > 0
      ? data.categories.map((c) => `#${c}`).join(" ")
      : "#uncategorized";

  const bioLine = data.targetBio
    ? `\n💬 ${escapeMarkdown(data.targetBio)}`
    : "";

  const ageLine = data.targetAccountAge
    ? ` \\| 🕐 ${escapeMarkdown(data.targetAccountAge)}`
    : "";

  const seedList = data.seedUsernames
    .map((u) => `  • @${escapeMarkdown(u)}`)
    .join("\n");

  return (
    `🚨 *CONVERGENCE ALERT* \\(${data.score} seeds\\)\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *[${escapeMarkdown(data.targetName)}](https://twitter.com/${data.targetUsername})*\n` +
    `🐦 @${escapeMarkdown(data.targetUsername)}${bioLine}\n\n` +
    `📊 ${getFollowerTier(data.targetFollowerCount)} \`${formatNumber(data.targetFollowerCount)}\` followers${ageLine}\n` +
    `🏷️ ${escapeMarkdown(categoryTags)}\n\n` +
    `👥 *Seeds who followed:*\n` +
    `${seedList}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🔗 [View Profile](https://twitter.com/${data.targetUsername}) \\| [Search CA](https://dexscreener.com/search?q=${data.targetUsername})`
  );
}

export interface DigestEntry {
  seedUsername: string;
  targetUsername: string;
  targetFollowerCount: number;
  targetBio: string | null;
}

export function formatDailyDigest(
  entries: DigestEntry[],
  categorizedEntries: Map<string, DigestEntry[]>,
  date: string,
): string {
  if (entries.length === 0) return "";

  const lines: string[] = [
    `📋 *Daily Follow Digest \\(${escapeMarkdown(date)}\\)*`,
    "",
  ];

  let shown = 0;
  const MAX_ENTRIES = 50;

  for (const [category, catEntries] of categorizedEntries) {
    if (shown >= MAX_ENTRIES) break;

    lines.push(
      `*${escapeMarkdown(category)}* \\(${catEntries.length} new follows\\)`,
    );

    for (const entry of catEntries) {
      if (shown >= MAX_ENTRIES) break;
      const bio = entry.targetBio
        ? `, "${escapeMarkdown(truncate(entry.targetBio, 60))}"`
        : "";
      lines.push(
        `@${escapeMarkdown(entry.seedUsername)} → @${escapeMarkdown(entry.targetUsername)} \\(${formatNumber(entry.targetFollowerCount)} followers${bio}\\)`,
      );
      shown++;
    }
    lines.push("");
  }

  if (entries.length > MAX_ENTRIES) {
    lines.push(`\\.\\.\\.and ${entries.length - MAX_ENTRIES} more`);
    lines.push("");
  }

  lines.push(`*Total:* ${entries.length} new follows`);

  return lines.join("\n");
}

// --- Helpers ---

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function getAccountAge(createdAt: string): string {
  const created = new Date(createdAt);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 30) return `${diffDays}d 🆕`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${(diffDays / 365).toFixed(1)}yr`;
}

function getFollowerTier(count: number): string {
  if (count >= 100_000) return "🔥";
  if (count >= 10_000) return "⭐";
  if (count >= 1_000) return "📈";
  return "🌱";
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

export { escapeMarkdown, formatNumber, getAccountAge, getFollowerTier };
