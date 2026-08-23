import type { UserData } from "../TwitterClient/types.js";
import { classifyAccount, tagLabel, DEFAULT_SLUG } from "./projectTagger.js";

/** Truncate a tweet body for inclusion in an alert card. */
function excerpt(text: string, maxLen = 220): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= maxLen ? oneLine : oneLine.slice(0, maxLen - 1) + "…";
}

export interface SignalAlertInput {
  accountId: string;
  username: string;
  name: string;
  slug: string;
  signals: string[];
  text: string;
  tweetId: string;
  /** Optional NFT/lifecycle intelligence (score, stages, extracted fields). */
  importance?: {
    tier: "soft" | "standard" | "critical";
    score: number;
    headline: string;
    stages: string[];
    fields: {
      datetimeRaws?: string[] | undefined;
      timezone?: string | undefined;
      relative?: string | undefined;
      relativeAmount?: number | undefined;
      priceRaw?: string | undefined;
      supply?: number | undefined;
      maxPerWallet?: number | undefined;
      mintLinks?: string[] | undefined;
      formLinks?: string[] | undefined;
      claimLinks?: string[] | undefined;
      appLinks?: string[] | undefined;
      docsLinks?: string[] | undefined;
      bridgeLinks?: string[] | undefined;
      tradeLinks?: string[] | undefined;
      chainId?: string | undefined;
      rpcUrl?: string | undefined;
      explorerUrl?: string | undefined;
      contractAddress?: string | undefined;
      ticker?: string | undefined;
      hasTba?: boolean | undefined;
      phases?: { name: string }[] | undefined;
    };
    vertical?: string | undefined;
  } | undefined;
}

function signalEmoji(tier?: string): string {
  if (tier === "critical") return "🔴";
  if (tier === "soft") return "🟡";
  return "🚨";
}

/** Human labels only (strip stage:/tier:/score: meta). */
function cleanSignalLabels(signals: string[]): string[] {
  return signals.filter(
    (s) =>
      !s.startsWith("stage:") &&
      !s.startsWith("tier:") &&
      !s.startsWith("score:"),
  );
}

function formatImportanceBlock(
  imp: NonNullable<SignalAlertInput["importance"]>,
): string {
  const f = imp.fields;
  const lines: string[] = [];
  lines.push(
    `📌 *${escapeMarkdown(imp.headline)}* \\(score ${escapeMarkdown(String(imp.score))}\\)`,
  );
  if (imp.vertical) {
    lines.push(`🏷 vertical: ${mdCode(imp.vertical)}`);
  }
  if (imp.stages.length) {
    lines.push(`🧭 stage: ${mdCode(imp.stages.join(", "))}`);
  }
  if (f.datetimeRaws?.length) {
    const tz = f.timezone ? ` ${f.timezone}` : "";
    lines.push(
      `🗓 ${escapeMarkdown(f.datetimeRaws.slice(0, 3).join(" · ") + tz)}`,
    );
  }
  if (f.relative === "hours" && f.relativeAmount != null) {
    // `~` is strikethrough in MarkdownV2 — must be escaped.
    lines.push(`⏱ in \\~${escapeMarkdown(String(f.relativeAmount))}h`);
  } else if (f.relative === "minutes" && f.relativeAmount != null) {
    lines.push(`⏱ in \\~${escapeMarkdown(String(f.relativeAmount))}m`);
  } else if (f.relative) {
    lines.push(`⏱ ${escapeMarkdown(f.relative)}`);
  }
  const econ: string[] = [];
  if (f.priceRaw) econ.push(f.priceRaw);
  if (f.supply != null) econ.push(`supply ${f.supply}`);
  if (f.maxPerWallet != null) econ.push(`${f.maxPerWallet}/wallet`);
  if (econ.length) lines.push(`💰 ${escapeMarkdown(econ.join(" · "))}`);
  if (f.hasTba) lines.push(`⚠️ TBA fields present`);
  if (f.phases?.length) {
    lines.push(
      `📋 ${escapeMarkdown(f.phases.slice(0, 3).map((p) => p.name).join(" | "))}`,
    );
  }
  if (f.chainId) {
    lines.push(`⛓ chain id: ${mdCode(f.chainId)}`);
  }
  if (f.rpcUrl) {
    lines.push(`📡 ${mdLink("RPC", f.rpcUrl)}`);
  }
  if (f.explorerUrl) {
    lines.push(`🔎 ${mdLink("Explorer", f.explorerUrl)}`);
  }
  if (f.contractAddress) {
    lines.push(`📜 CA: ${mdCode(f.contractAddress)}`);
  }
  if (f.ticker) {
    lines.push(`💱 $${escapeMarkdown(f.ticker)}`);
  }
  for (const link of (f.mintLinks ?? []).slice(0, 2)) {
    lines.push(`🖼 ${mdLink("Mint link", link)}`);
  }
  for (const link of (f.claimLinks ?? []).slice(0, 2)) {
    lines.push(`🎁 ${mdLink("Claim", link)}`);
  }
  for (const link of (f.appLinks ?? []).slice(0, 2)) {
    lines.push(`📱 ${mdLink("App", link)}`);
  }
  for (const link of (f.docsLinks ?? []).slice(0, 2)) {
    lines.push(`📘 ${mdLink("Docs", link)}`);
  }
  for (const link of (f.bridgeLinks ?? []).slice(0, 2)) {
    lines.push(`🌉 ${mdLink("Bridge", link)}`);
  }
  for (const link of (f.tradeLinks ?? []).slice(0, 2)) {
    lines.push(`📈 ${mdLink("Trade", link)}`);
  }
  for (const link of (f.formLinks ?? []).slice(0, 2)) {
    lines.push(`📝 ${mdLink("WL form", link)}`);
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** A signal post alert — mint/WL/TGE-type news with optional structured intel. */
export function formatSignalAlert(
  input: SignalAlertInput,
): { text: string; user: UserData } {
  const postUrl = `https://x.com/${input.username}/status/${input.tweetId}`;
  const labels = cleanSignalLabels(input.signals);
  const signalLine = labels.length
    ? `🏷️ ${escapeMarkdown(labels.slice(0, 8).join(" · "))}\n`
    : "";
  const emoji = signalEmoji(input.importance?.tier);
  const tierTag =
    input.importance?.tier === "critical"
      ? " CRITICAL"
      : input.importance?.tier === "soft"
        ? " soft"
        : "";
  const intel = input.importance ? formatImportanceBlock(input.importance) : "";

  const text =
    `${emoji} *Signal${escapeMarkdown(tierTag)} · ${escapeMarkdown(tagLabel(input.slug))}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *${escapeMarkdown(input.name)}*  ${mdUserLink(input.username)}\n` +
    signalLine +
    intel +
    `\n${escapeMarkdown(excerpt(input.text))}\n\n` +
    `🔗 ${mdLink("View post", postUrl)}\n` +
    `━━━━━━━━━━━━━━━━━━\n`;

  return {
    text,
    user: { id: input.accountId, username: input.username, name: input.name } as UserData,
  };
}

export interface ReclassifyAlertInput {
  accountId: string;
  username: string;
  name: string;
  from: string;
  to: string[];
  signals?: string[];
  tweetId: string;
}

/** A reclassification alert (🔀) — an alpha project revealed its type via a post. */
export function formatReclassifyAlert(
  input: ReclassifyAlertInput,
): { text: string; user: UserData } {
  const postUrl = `https://x.com/${input.username}/status/${input.tweetId}`;
  const toLabels = input.to.map(tagLabel).join(" · ");
  const signalLine = input.signals?.length
    ? `🏷️ ${escapeMarkdown(input.signals.join(" · "))}\n`
    : "";

  const text =
    `🔀 *Reclassified* — ${mdUserLink(input.username)}\n` +
    `${escapeMarkdown(tagLabel(input.from))} → *${escapeMarkdown(toLabels)}*\n` +
    signalLine +
    `🔗 ${mdLink("View post", postUrl)}\n`;

  return {
    text,
    user: { id: input.accountId, username: input.username, name: input.name } as UserData,
  };
}

export async function formatNewFollowAlert(
  watchedUsername: string,
  newFollow: UserData,
  rank?: number,
): Promise<{ text: string; user: UserData }> {
  void rank;
  const verified = newFollow.isBlueVerified ? " ✅" : "";
  const description = newFollow.description
    ? `\n${escapeMarkdown(newFollow.description)}`
    : "";

  const tags = await classifyAccount(newFollow);
  // Show the tag line only when we have a real classification — a lone
  // "unknown" fallback carries no signal, so omit it from the alert.
  const meaningfulTags = tags.filter((t) => t !== DEFAULT_SLUG);
  const tagLine =
    meaningfulTags.length > 0
      ? `🏷️ ${escapeMarkdown(meaningfulTags.map(tagLabel).join(" · "))}\n`
      : "unknown \n";

  const accountAge = newFollow.createdAt
    ? getAccountAge(newFollow.createdAt)
    : "Unknown";
  const followerTier = getFollowerTier(newFollow.followersCount ?? 0);
  const msg = {
    text:
      `🔔 *New Follow Detected*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 *${escapeMarkdown(newFollow.name)}${verified}*\n` +
      `🐦 ${mdUserLink(newFollow.username)} \nBio: \n${description}\n\n` +
      tagLine +
      `📊 *Stats*\n` +
      `├ ${followerTier} Followers: ${mdCode(formatNumber(newFollow.followersCount ?? 0))}\n` +
      `├ 🐦 Tweets: ${mdCode(formatNumber(newFollow.tweetCount ?? 0))}\n` +
      `├ ❤️ Likes: ${mdCode(formatNumber(newFollow.likeCount ?? 0))}\n` +
      `└ 🕐 Account Age: ${mdCode(accountAge)}\n\n` +
      `Watched: @${escapeMarkdown(watchedUsername)}\n` +
      `━━━━━━━━━━━━━━━━━━\n`,
    user: newFollow,
  };

  return msg;
}

export interface SearchAlertInput {
  query: string;
  label?: string | null;
  username: string;
  name: string;
  text: string;
  tweetId: string;
}

/** Live search hit alert — a new post matched a watched Twitter search query. */
export function formatSearchAlert(
  input: SearchAlertInput,
): { text: string; user: UserData } {
  const postUrl = `https://x.com/${input.username}/status/${input.tweetId}`;
  // Prefer a human label in the title; never paste the raw search query string.
  const title = input.label?.trim()
    ? `🔎 *Search hit · ${escapeMarkdown(input.label.trim())}*`
    : `🔎 *Search hit*`;

  const text =
    `${title}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *${escapeMarkdown(input.name)}*  ${mdUserLink(input.username)}\n\n` +
    `${escapeMarkdown(excerpt(input.text))}\n\n` +
    `🔗 ${mdLink("View post", postUrl)}\n` +
    `━━━━━━━━━━━━━━━━━━\n`;

  return {
    text,
    user: {
      id: input.tweetId,
      username: input.username,
      name: input.name,
    } as UserData,
  };
}

export interface ListMonitorAlertInput {
  listId: string;
  label?: string | null;
  username: string;
  name: string;
  text: string;
  tweetId: string;
}

export interface ChainlistAlertInput {
  chainId: string;
  name: string;
  shortName?: string | null;
  nativeSymbol?: string | null;
  rpcUrl?: string | null;
  explorerUrl?: string | null;
  infoUrl?: string | null;
  isTestnet: boolean;
  rpcLive: boolean | null;
  source: string;
  /** Optional GitHub commit that added the chain (DefiLlama/chainlist). */
  commitUrl?: string | null;
}

/** New EVM chain appeared on chainlist / GitHub additionalChainRegistry. */
export function formatChainlistAlert(input: ChainlistAlertInput): {
  text: string;
  user: UserData;
} {
  const kind = input.isTestnet ? "testnet" : "mainnet";
  const live =
    input.rpcLive === true
      ? "RPC live ✅"
      : input.rpcLive === false
        ? "RPC failed ❌"
        : "RPC unchecked";
  const symbol = input.nativeSymbol
    ? ` · ${escapeMarkdown(input.nativeSymbol)}`
    : "";
  const short = input.shortName
    ? ` \\(${escapeMarkdown(input.shortName)}\\)`
    : "";

  const links: string[] = [];
  if (input.explorerUrl) {
    links.push(mdLink("Explorer", input.explorerUrl));
  }
  if (input.infoUrl) {
    links.push(mdLink("Info", input.infoUrl));
  }
  links.push(mdLink("Chainlist", `https://chainlist.org/chain/${input.chainId}`));
  if (input.commitUrl) {
    links.push(mdLink("GitHub", input.commitUrl));
  }

  const rpcLine = input.rpcUrl
    ? `RPC: ${mdCode(
        input.rpcUrl.slice(0, 80) + (input.rpcUrl.length > 80 ? "…" : ""),
      )}\n`
    : "";

  const text =
    `⛓ *New chain · ${escapeMarkdown(kind)}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `*${escapeMarkdown(input.name)}*${short}\n` +
    `🆔 Chain ID: ${mdCode(input.chainId)}${symbol}\n` +
    `📡 ${escapeMarkdown(live)}\n` +
    `📚 source: ${mdCode(input.source)}\n` +
    rpcLine +
    `\n${links.join(" · ")}\n` +
    `━━━━━━━━━━━━━━━━━━\n`;

  return {
    text,
    user: {
      id: input.chainId,
      username: input.shortName || input.name,
      name: input.name,
    } as UserData,
  };
}

export interface GithubCommitAlertInput {
  fullName: string;
  label?: string | null;
  pathFilter?: string | null;
  sha: string;
  message: string;
  authorName?: string | null;
  authorLogin?: string | null;
  htmlUrl: string;
  filesAdded?: string[];
  filesModified?: string[];
  filesRemoved?: string[];
}

/** New commit on a watched GitHub repo. */
export function formatGithubCommitAlert(
  input: GithubCommitAlertInput,
): { text: string; user: UserData } {
  const shortSha = input.sha.slice(0, 7);
  const title = input.label?.trim()
    ? escapeMarkdown(input.label.trim())
    : escapeMarkdown(input.fullName);
  const author =
    input.authorLogin || input.authorName
      ? escapeMarkdown(input.authorLogin || input.authorName || "")
      : "unknown";
  const msg = escapeMarkdown(excerpt(input.message || "(no message)", 160));

  const added = input.filesAdded ?? [];
  const modified = input.filesModified ?? [];
  const removed = input.filesRemoved ?? [];
  const fileLines: string[] = [];
  if (added.length) {
    const sample = added.slice(0, 3).join(", ") + (added.length > 3 ? "…" : "");
    fileLines.push(
      `➕ ${escapeMarkdown(String(added.length))} added` +
        (added[0] ? `: ${mdCode(sample)}` : ""),
    );
  }
  if (modified.length) {
    fileLines.push(`✏️ ${escapeMarkdown(String(modified.length))} modified`);
  }
  if (removed.length) {
    fileLines.push(`🗑 ${escapeMarkdown(String(removed.length))} removed`);
  }

  const repoUrl = `https://github.com/${input.fullName}`;
  const commitUrl = input.htmlUrl;

  const text =
    `📦 *GitHub · ${title}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${mdCode(shortSha)} by ${author}\n` +
    `${msg}\n` +
    (input.pathFilter ? `📁 path: ${mdCode(input.pathFilter)}\n` : "") +
    (fileLines.length ? `${fileLines.join("\n")}\n` : "") +
    `\n${mdLink("Commit", commitUrl)} · ${mdLink("Repo", repoUrl)}\n` +
    `━━━━━━━━━━━━━━━━━━\n`;

  return {
    text,
    user: {
      id: input.sha,
      username: input.fullName,
      name: input.label || input.fullName,
    } as UserData,
  };
}

/** New post on a watched public Twitter list. */
export function formatListMonitorAlert(
  input: ListMonitorAlertInput,
): { text: string; user: UserData } {
  const postUrl = `https://x.com/${input.username}/status/${input.tweetId}`;
  const listUrl = `https://x.com/i/lists/${input.listId}`;
  const title = input.label?.trim()
    ? `📋 *List · ${escapeMarkdown(input.label.trim())}*`
    : `📋 *List post*`;

  const text =
    `${title}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *${escapeMarkdown(input.name)}*  ${mdUserLink(input.username)}\n\n` +
    `${escapeMarkdown(excerpt(input.text))}\n\n` +
    `🔗 ${mdLink("View post", postUrl)} · ${mdLink("List", listUrl)}\n` +
    `━━━━━━━━━━━━━━━━━━\n`;

  return {
    text,
    user: {
      id: input.tweetId,
      username: input.username,
      name: input.name,
    } as UserData,
  };
}

export interface MonitorAlertInput {
  accountId: string;
  username: string;
  name: string;
  slug: string;
  signals: string[];
  text: string;
  tweetId: string;
  alertMode: "all" | "signals";
  importance?: SignalAlertInput["importance"];
}

/** Live per-user timeline alert — watched account posted (not list poll). */
export function formatMonitorAlert(
  input: MonitorAlertInput,
): { text: string; user: UserData } {
  const postUrl = `https://x.com/${input.username}/status/${input.tweetId}`;
  const labels = cleanSignalLabels(input.signals);
  const signalLine =
    labels.length && !(labels.length === 1 && labels[0] === "post")
      ? `🏷️ ${escapeMarkdown(labels.slice(0, 8).join(" · "))}\n`
      : "";
  const modeLabel = input.alertMode === "signals" ? "signal" : "new post";
  const emoji =
    input.importance?.tier === "critical"
      ? "🔴"
      : input.importance?.tier === "soft"
        ? "🟡"
        : "📡";
  const intel = input.importance ? formatImportanceBlock(input.importance) : "";

  const text =
    `${emoji} *User monitor · ${escapeMarkdown(modeLabel)}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *${escapeMarkdown(input.name)}*  ${mdUserLink(input.username)}\n` +
    signalLine +
    intel +
    `\n${escapeMarkdown(excerpt(input.text))}\n\n` +
    `🔗 ${mdLink("View post", postUrl)}\n` +
    `━━━━━━━━━━━━━━━━━━\n`;

  return {
    text,
    user: {
      id: input.accountId,
      username: input.username,
      name: input.name,
    } as UserData,
  };
}

export interface WatchingAlertInput {
  accountId: string;
  username: string;
  name: string;
  text: string;
  tweetId: string;
  followersCount: number;
  tweetCount: number;
  tags?: string[];
  /** Matched signal labels. Non-empty routes the alert to the signal topic. */
  signals?: string[];
}

/**
 * Watching-project post — a project with projectStatus='watching' posted.
 * Renders as a signal alert when `signals` is non-empty, otherwise as a plain
 * post; the poller routes the two to different Telegram topics.
 */
export function formatWatchingAlert(
  input: WatchingAlertInput,
): { text: string; user: UserData } {
  const postUrl = `https://x.com/${input.username}/status/${input.tweetId}`;
  const displayName = input.name.trim() || input.username;
  const labels = (input.tags ?? []).filter((t) => t && t !== DEFAULT_SLUG);
  const tagLine = labels.length
    ? `🏷 ${escapeMarkdown(labels.slice(0, 4).map(tagLabel).join(" · "))}\n`
    : "";
  const signals = (input.signals ?? []).filter(Boolean);
  const signalLine = signals.length
    ? `🏷️ ${escapeMarkdown(signals.join(" · "))}\n`
    : "";
  const header = signals.length ? `🚨 *Watching · signal*` : `👀 *Watching · new post*`;

  const text =
    `${header}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *${escapeMarkdown(displayName)}*  ${mdUserLink(input.username)}\n` +
    `👥 ${escapeMarkdown(formatNumber(input.followersCount))} followers · ` +
    `🐦 ${escapeMarkdown(formatNumber(input.tweetCount))} posts\n` +
    tagLine +
    signalLine +
    `\n${escapeMarkdown(excerpt(input.text))}\n\n` +
    `🔗 ${mdLink("View post", postUrl)}\n` +
    `━━━━━━━━━━━━━━━━━━\n`;

  return {
    text,
    user: {
      id: input.accountId,
      username: input.username,
      name: displayName,
    } as UserData,
  };
}

/** Early monitor raw post (no signal match) — optional TG stream. */
export function formatEarlyRawPostAlert(input: {
  accountId: string;
  username: string;
  name: string;
  text: string;
  tweetId: string;
  tags?: string[];
}): { text: string; user: UserData } {
  const postUrl = `https://x.com/${input.username}/status/${input.tweetId}`;
  const tagLine =
    input.tags && input.tags.length
      ? `🏷 ${escapeMarkdown(input.tags.slice(0, 4).join(" · "))}\n`
      : "";
  const text =
    `📝 *Early · raw post*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *${escapeMarkdown(input.name)}*  ${mdUserLink(input.username)}\n` +
    tagLine +
    `\n${escapeMarkdown(excerpt(input.text))}\n\n` +
    `🔗 ${mdLink("View post", postUrl)}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    escapeMarkdown("No signal keyword matched — raw stream");
  return {
    text,
    user: {
      id: input.accountId,
      username: input.username,
      name: input.name,
    } as UserData,
  };
}

export interface ProfileChangeAlertInput {
  accountId: string;
  username: string;
  name: string;
  previousUsername: string | null;
  bioChanged: boolean;
  oldBio: string | null;
  newBio: string | null;
  followersCount: number | null;
  tags: string[];
}

/** Username rename and/or bio update on an early project. */
export function formatProfileChangeAlert(
  input: ProfileChangeAlertInput,
): { text: string; user: UserData } {
  const lines: string[] = [
    `📝 *Profile change · early project*`,
    `━━━━━━━━━━━━━━━━━━`,
  ];
  if (input.previousUsername) {
    lines.push(
      `🔄 @${escapeMarkdown(input.previousUsername)} → ${mdUserLink(input.username)}`,
    );
  } else {
    lines.push(
      `👤 *${escapeMarkdown(input.name)}* ${mdUserLink(input.username)}`,
    );
  }
  if (input.followersCount != null) {
    lines.push(`👥 followers: ${mdCode(formatNumber(input.followersCount))}`);
  }
  if (input.tags?.length) {
    lines.push(
      `🏷️ ${escapeMarkdown(input.tags.filter((t) => t !== "unknown").join(" · ") || "—")}`,
    );
  }
  if (input.bioChanged) {
    lines.push(``);
    lines.push(`*Bio updated*`);
    if (input.newBio) {
      lines.push(escapeMarkdown(excerpt(input.newBio, 280)));
    } else {
      lines.push(`_\\(bio cleared\\)_`);
    }
  }
  lines.push(`━━━━━━━━━━━━━━━━━━`);

  return {
    text: lines.join("\n") + "\n",
    user: {
      id: input.accountId,
      username: input.username,
      name: input.name,
    } as UserData,
  };
}

export interface GrowthReportRow {
  username: string;
  name: string;
  tags: string[];
  followersNow: number;
  followersBefore: number;
  absGain: number;
  pctGain: number;
  huntStage: string;
}

export function formatGrowthReport(input: {
  days: number;
  rows: GrowthReportRow[];
}): string {
  const days = String(input.days);
  const lines: string[] = [
    `📈 *Top growing early projects \\(${escapeMarkdown(days)}d\\)*`,
    `━━━━━━━━━━━━━━━━━━`,
  ];
  input.rows.forEach((r, i) => {
    const pct = r.pctGain >= 10 ? r.pctGain.toFixed(0) : r.pctGain.toFixed(1);
    const tags = r.tags.filter((t) => t !== "unknown" && t !== "other").slice(0, 3);
    const tagStr = tags.length ? ` · ${tags.join(",")}` : "";
    const stage = r.huntStage !== "noise" ? ` · ${r.huntStage}` : "";
    lines.push(
      `${i + 1}\\. ${mdUserLink(r.username)}` +
        ` \\+${escapeMarkdown(formatNumber(r.absGain))} \\(${escapeMarkdown(pct)}%\\)` +
        `\n    ${escapeMarkdown(formatNumber(r.followersBefore))} → ${escapeMarkdown(formatNumber(r.followersNow))}` +
        escapeMarkdown(tagStr + stage),
    );
  });
  lines.push(`━━━━━━━━━━━━━━━━━━`);
  // MarkdownV2: `~` is strikethrough — must be escaped. Avoid raw `_…_` italic
  // around unescaped `~` (was: `_Baseline: snapshot ~7d…_`) which 400s as
  // "Can't find end of Italic entity".
  lines.push(
    escapeMarkdown(
      `Baseline: snapshot ~${days}d ago or detect-time followers`,
    ),
  );
  return lines.join("\n");
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

  const profileUrl = `https://twitter.com/${data.targetUsername}`;
  const searchUrl = `https://dexscreener.com/search?q=${encodeURIComponent(data.targetUsername)}`;

  return (
    `🚨 *CONVERGENCE ALERT* \\(${escapeMarkdown(String(data.score))} seeds\\)\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *${mdLink(data.targetName, profileUrl)}*\n` +
    `🐦 @${escapeMarkdown(data.targetUsername)}${bioLine}\n\n` +
    `📊 ${getFollowerTier(data.targetFollowerCount)} ${mdCode(formatNumber(data.targetFollowerCount))} followers${ageLine}\n` +
    `🏷️ ${escapeMarkdown(categoryTags)}\n\n` +
    `👥 *Seeds who followed:*\n` +
    `${seedList}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🔗 ${mdLink("View Profile", profileUrl)} \\| ${mdLink("Search CA", searchUrl)}`
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
  const MAX_ENTRIES = 30;

  for (const [category, catEntries] of categorizedEntries) {
    if (shown >= MAX_ENTRIES) break;

    lines.push(
      `*${escapeMarkdown(category)}* \\(${escapeMarkdown(String(catEntries.length))} new follows\\)`,
    );

    for (const entry of catEntries) {
      if (shown >= MAX_ENTRIES) break;

      // Plain @username (no link brackets) — safer for MarkdownV2; still escape
      // underscores and other specials in the handle.
      const seedUser = `@${escapeMarkdown(entry.seedUsername)}`;
      const targetUser = `@${escapeMarkdown(entry.targetUsername)}`;
      const bio = entry.targetBio
        ? escapeMarkdown(`, ${truncate(entry.targetBio, 30)}`)
        : "";
      // formatNumber is raw; escape once for plain text (never double-escape).
      const followerText = `${escapeMarkdown(formatNumber(entry.targetFollowerCount))} followers${bio}`;

      lines.push(`${seedUser} → ${targetUser} ${followerText}`);
      shown++;
    }
    lines.push("");
  }

  if (entries.length > MAX_ENTRIES) {
    lines.push(
      `\\.\\.\\. and ${escapeMarkdown(String(entries.length - MAX_ENTRIES))} more`,
    );
    lines.push("");
  }

  lines.push(
    `*Total:* ${escapeMarkdown(String(entries.length))} new follows`,
  );

  return lines.join("\n");
}

// --- Helpers ---

/**
 * Escape plain-text content for Telegram MarkdownV2.
 * Specials: _ * [ ] ( ) ~ ` > # + - = | { } . ! and \
 *
 * Do NOT use this inside code spans or raw URL bodies — use mdCode / escapeLinkUrl.
 * Do NOT wrap formatNumber output twice (formatNumber is unescaped raw text).
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Inside `code`, only ` and \ must be escaped (Telegram MarkdownV2).
 * Full escapeMarkdown inside code shows literal backslashes.
 */
function escapeCode(text: string): string {
  return text.replace(/([\\`])/g, "\\$1");
}

/**
 * Inside link (...), only ) and \ must be escaped.
 */
function escapeLinkUrl(url: string): string {
  return url.replace(/([)\\])/g, "\\$1");
}

/** Safe `[label](url)` for MarkdownV2. */
function mdLink(label: string, url: string): string {
  return `[${escapeMarkdown(label)}](${escapeLinkUrl(url)})`;
}

/** Safe inline `code` span for MarkdownV2. */
function mdCode(text: string): string {
  return `\`${escapeCode(text)}\``;
}

/** `[@user](https://x.com/user)` with escaped display + URL. */
function mdUserLink(username: string): string {
  return mdLink(`@${username}`, `https://x.com/${username}`);
}

/** Human count like 1.5K — raw text; escape at the call site for plain MD. */
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

export {
  escapeMarkdown,
  formatNumber,
  getAccountAge,
  getFollowerTier,
  mdLink,
  mdCode,
  mdUserLink,
};
