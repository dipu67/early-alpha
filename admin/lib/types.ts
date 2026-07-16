// Shapes returned by the early-alpha backend (jsonSafe stringifies BigInt ids).

export interface SignalPost {
  tweetId: string;
  accountId: string;
  username: string;
  slug: string;
  signals: string[];
  text: string;
  postedAt: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  username: string;
  name: string;
  /** Twitter bio — null/empty when never fetched */
  description?: string | null;
  tags: string[];
  followersCount: number | null;
  isBlueVerified: boolean | null;
  listsSyncedAt: string | null;
  firstSeenAt: string;
  updatedAt?: string;
}

/** Sort keys for GET /api/projects?sort= */
export type ProjectSort =
  | "latest"
  | "oldest"
  | "followers"
  | "followers_asc"
  | "username"
  | "updated";

/** Row from project_tags — keyword + handle-token lexicon for the classifier. */
export interface ProjectTag {
  slug: string;
  label: string;
  enabled: boolean;
  isBuiltin: boolean;
  keywords: string[];
  regexKeywords: string[];
  handleTokens: string[];
  handleSuffixTokens: string[];
  keywordCount: number;
  handleTokenCount: number;
  createdAt: string;
}

export interface ProjectList {
  slug: string;
  name: string;
  twitterListId: string;
  memberCount: number;
  lastPolledAt: string | null;
  lastTweetId: string | null;
  authAccountId?: string | null;
  authUsername?: string | null;
}

/** One list from live client.getMyLists() for an auth account. */
export interface AuthOwnedList {
  id: string;
  name: string;
  description?: string;
  memberCount?: number;
  subscriberCount?: number;
  isPrivate?: boolean;
  projectSlug: string | null;
  projectName: string | null;
}

/** GET /api/lists/owned — inventory per auth via getMyLists(). */
export interface AuthListsScanResult {
  scannedAt: string;
  authCount: number;
  listCount: number;
  duplicateListIds: string[];
  items: {
    authAccountId: string;
    username: string;
    isActive: boolean;
    rateLimited: boolean;
    ok: boolean;
    error?: string;
    listCount: number;
    lists: AuthOwnedList[];
  }[];
}

export interface WatchEntry {
  id: string;
  username: string;
  twitterUserId: string;
  isActive: boolean;
  lastSnapshotAt: string | null;
  alertCount: number;
  createdAt: string;
}

export interface AuthAccount {
  id: string;
  username: string;
  authToken: string;
  ct0: string;
  isActive: boolean;
  rateLimited: boolean;
  rateLimitedUntil: string | null;
  lastUsedAt: string | null;
}

export interface Paged<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface Overview {
  projects: number;
  taggedProjects: number;
  activeWatch: number;
  lists: number;
  listMembers: number;
  signals24h: number;
  authActive: number;
  authRateLimited: number;
}

export interface TimePoint {
  day: string;
  count: number;
}

export interface ActivityItem {
  type: "signal" | "follow";
  id: string;
  username: string | null;
  slug?: string;
  signals?: string[];
  at: string;
}

export interface Scheduler {
  key: string;
  label: string;
  queue: string;
  jobName: string;
  paused: boolean;
  cron: string | null;
  every: number | null;
  nextRun: number | null;
  counts: Record<string, number>;
}

export interface TgConfig {
  alertChatId: string | null;
  defaultTopicId: number | null;
  signalTopicId: number | null;
  signalTopicMap: Record<string, number>;
  earlyProjectTopicId: number | null;
  earlyTopicMap: Record<string, number>;
  minIntervalMs: number | null;
  maxRetries: number | null;
  /** Telegram user ids allowed for admin bot commands */
  adminIds?: string[] | null;
}

export interface TelegramBot {
  id: string;
  name: string;
  username: string | null;
  token: string; // masked
  isDefault: boolean;
  isActive: boolean;
}

/** Live Twitter search query (polled with optional pinned auth account). */
export interface SearchQueryItem {
  id: string;
  query: string;
  label: string | null;
  enabled: boolean;
  authAccountId: string | null;
  authUsername: string | null;
  /** Telegram forum topic for alerts from this query. */
  topicId: number | null;
  alertEnabled: boolean;
  intervalSec: number;
  lastPolledAt: string | null;
  lastTweetId: string | null;
  lastError: string | null;
  hitCount: number;
  recentHitCount?: number;
  createdAt: string;
}

export interface SearchHitItem {
  id: string;
  queryId: string;
  query: string;
  queryLabel: string | null;
  tweetId: string;
  username: string;
  name: string;
  text: string;
  postedAt: string | null;
  createdAt: string;
}

export interface ListMonitorItem {
  id: string;
  twitterListId: string;
  label: string | null;
  listName: string | null;
  enabled: boolean;
  authAccountId: string | null;
  authUsername: string | null;
  topicId: number | null;
  alertEnabled: boolean;
  intervalSec: number;
  lastPolledAt: string | null;
  lastTweetId: string | null;
  lastError: string | null;
  hitCount: number;
  recentHitCount?: number;
  listUrl: string;
  createdAt: string;
}

export interface ListMonitorHitItem {
  id: string;
  monitorId: string;
  listId: string;
  listLabel: string | null;
  tweetId: string;
  username: string;
  name: string;
  text: string;
  postedAt: string | null;
  createdAt: string;
}

export const ALERT_TYPES = [
  "newFollow",
  "signal",
  "reclassify",
  "earlyDigest",
  "convergence",
  "search",
  "monitor",
  "listMonitor",
] as const;
export type AlertTypeName = (typeof ALERT_TYPES)[number];

/** Live project tweet monitor. */
export interface ProjectMonitorItem {
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
  lastTweetId: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  alertCount: number;
  heatAtEnroll: number | null;
  createdAt: string;
}

/** Grok bot conversation (DB). */
export interface GrokConversationItem {
  id: string;
  grokConversationId: string;
  telegramChatId: string;
  chatType: string;
  title: string | null;
  isActive: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  preview: {
    role: string;
    content: string;
    createdAt: string;
  } | null;
}

export interface GrokMessageItem {
  id: string;
  role: string;
  content: string;
  telegramUserId: string | null;
  telegramMessageId: string | null;
  createdAt: string;
}

export interface GrokConversationDetail extends Omit<GrokConversationItem, "preview"> {
  messages: GrokMessageItem[];
}

/** Saved research prompt template (placeholders {{tag}} {{count}} {{handles}} {{projects}}). */
export interface GrokResearchPrompt {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  template: string;
  defaultTag: string | null;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GrokResearchRunSummary {
  id: string;
  promptId: string | null;
  title: string | null;
  tag: string | null;
  projectIds: string[];
  projectHandles: string[];
  projectCount: number;
  status: string;
  error: string | null;
  grokConversationId: string | null;
  createdAt: string;
  completedAt: string | null;
  promptName: string | null;
  promptSlug: string | null;
}

export type HuntStage = "noise" | "soft" | "hot" | "skip" | "taken";

export interface HotBoardItem {
  accountId: string;
  username: string;
  name: string;
  tags: string[];
  followersCount: number | null;
  isBlueVerified: boolean | null;
  accountCreatedAt: string | null;
  accountAgeDays: number | null;
  firstSeenAt: string;
  huntStage: string;
  huntNote: string | null;
  heat: number;
  seedCount: number;
  seedUsernames: string[];
  watcherCount: number;
  watcherUsernames: string[];
  searchHits: number;
  lastSignalAt: string | null;
  sources: string[];
}

/** Format a ms interval as "5m", "1h", "12h", "1d". */
export function fmtEvery(ms: number | null): string {
  if (ms == null) return "—";
  const m = ms / 60000;
  if (m < 60) return `${m}m`;
  const h = m / 60;
  if (h < 24) return `${h}h`;
  return `${h / 24}d`;
}

/** Format an ISO date as a short relative-ish label. */
export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact follower counts: 4400 -> 4.4K. */
export function fmtNum(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
