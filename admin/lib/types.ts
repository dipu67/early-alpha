// Shapes returned by the early-alpha backend (jsonSafe stringifies BigInt ids).

export interface Project {
  id: string;
  username: string;
  name: string;
  /** Twitter bio — null/empty when never fetched */
  description?: string | null;
  /** Profile image URL from Twitter */
  profileImageUrl?: string | null;
  tags: string[];
  followersCount: number | null;
  isBlueVerified: boolean | null;
  listsSyncedAt: string | null;
  firstSeenAt: string;
  updatedAt?: string;
  project?: {
    id: number;
    projectStatus: string;
    chain: string | null;
    website: string | null;
    github: string | null;
    name: string;
    description: string | null;
  } | null;
}

/** Whether the account has a Project row (category/status/chain set). */
export function isEnriched(p: Project): boolean {
  return p.project != null;
}

/** Display tags as category labels. */
export function categoryDisplay(p: Project): string {
  return p.tags[0] ?? "Other";
}

/** Get all tags (used as categories). */
export function categoryList(p: Project): string[] {
  return p.tags.length > 0 ? p.tags : ["other"];
}

/** Project status with a sensible default. */
export function projectStatus(p: Project): string {
  return p.project?.projectStatus ?? "discovered";
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
  isChain: boolean;
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
  activeSeeds: number;
  inactiveSeeds: number;
  edgesActive: number;
  newEdges24h: number;
  convergence24h: number;
  hotProjects: number;
  lists: number;
  listMembers: number;
  signals24h: number;
  authActive: number;
  authRateLimited: number;
  lastSeedRun?: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    seedsProcessed: number;
    newFollowEdges: number;
  } | null;
}

export interface SeedAccount {
  id: string;
  username: string;
  twitterId: string | null;
  category: string;
  label: string | null;
  active: boolean;
  edgeCount: number;
  lastEdgeAt: string | null;
  createdAt: string;
  updatedAt: string;
  profileImageUrl?: string | null;
}

export interface TrackingRun {
  id: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  seedsProcessed: number;
  accountsSeen: number;
  newFollowEdges: number;
  error: string | null;
}

export interface EarlyProjectStats {
  poolSize: number;
  dueNow: number;
  polled24h: number;
  renames7d: number;
  snapshots7d: number;
  hot: number;
  soft: number;
  lastPoll: {
    candidates?: number;
    checked?: number;
    renames?: number;
    bioChanges?: number;
    followerJumps?: number;
    timelines?: number;
    timelinesQueued?: number;
    signalAlerts?: number;
    rawAlerts?: number;
    snapshots?: number;
    missing?: number;
    deleted?: number;
    errors?: number;
    usersByIdsReqs?: number;
    watermarkSeeded?: number;
    freshTweets?: number;
    noAlert?: number;
    finishedAt?: string;
  } | null;
  lastGrowthReport: {
    sent?: boolean;
    count?: number;
    finishedAt?: string;
  } | null;
  config: EarlyPollConfig;
}

/** Live early-monitor poller + detection rules (PATCH /early-projects/config). */
export interface EarlyPollConfig {
  batchSize: number;
  maxBatches: number;
  maxTimelines: number;
  delayMs: number;
  staleMs: number;
  maxAgeMs: number;
  maxAgeDays: number;
  maxFollowers: number;
  maxFollowing: number;
  firstSeenDays: number;
  includeSoftHot: boolean;
  strictEarlyOnly: boolean;
  watchingOnly: boolean;
  snapshotMinMs: number;
  maxAccountsPerCycle: number;
  signalTopicId: number | null;
  rawTopicId: number | null;
  profileChangeTopicId: number | null;
  sendRawPosts: boolean;
  tweetReqBudget: number;
  pollEveryLabel?: string;
}

export interface EarlyProjectRow {
  id: string;
  username: string;
  name: string;
  tags: string[];
  followersCount: number | null;
  followersAtDetect: number | null;
  tweetCount: number | null;
  huntStage: string;
  firstSeenAt: string;
  lastProfilePolledAt: string | null;
  lastTweetId: string | null;
  previousUsername: string | null;
  usernameChangedAt: string | null;
  description: string | null;
  growthFromDetect: number | null;
  dueForPoll: boolean;
}

export interface GrowthBoardRow {
  accountId: string;
  username: string;
  name: string;
  tags: string[];
  followersNow: number;
  followersBefore: number;
  absGain: number;
  pctGain: number;
  firstSeenAt: string;
  huntStage: string;
}

export interface SeedStats {
  total: number;
  active: number;
  inactive: number;
  missingTwitterId: number;
  edgesActive: number;
  newEdges24h: number;
  convergence24h: number;
  lastRun: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    seedsProcessed: number;
    accountsSeen: number;
    newFollowEdges: number;
    error: string | null;
  } | null;
}

export interface TimePoint {
  day: string;
  count: number;
}

export interface ActivityItem {
  type: "signal" | "follow" | "convergence";
  id: string;
  username: string | null;
  slug?: string;
  signals?: string[];
  seed?: string;
  seeds?: string[];
  score?: number;
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

export interface KnownChainItem {
  chainId: string;
  name: string;
  shortName: string | null;
  nativeSymbol: string | null;
  rpcUrl: string | null;
  explorerUrl: string | null;
  infoUrl: string | null;
  isTestnet: boolean;
  source: string;
  rpcLive: boolean | null;
  firstSeenAt: string;
  lastSeenAt?: string;
  alertedAt?: string | null;
  alerted?: boolean;
  commitSha?: string | null;
  commitUrl?: string | null;
  githubFile?: string | null;
  chainlistUrl: string;
}

export interface ChainlistSourcesConfig {
  rpcs: boolean;
  github: boolean;
}

export interface ChainlistGithubStatus {
  snapshotPath: string;
  snapshotExists: boolean;
  snapshotUpdatedAt: string | null;
  snapshotCount: number;
  repo: string;
  registryPath: string;
  lastCommitSha: string | null;
  lastCommitUrl: string | null;
  lastCommitMessage: string | null;
  lastCommitAt: string | null;
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
  "chainlist",
  "githubRepo",
  "profileChange",
  "growthReport",
] as const;
export type AlertTypeName = (typeof ALERT_TYPES)[number];

export interface GithubRepoMonitorItem {
  id: string;
  owner: string;
  repo: string;
  fullName: string;
  label: string | null;
  description: string | null;
  enabled: boolean;
  alertEnabled: boolean;
  topicId: number | null;
  branch: string;
  pathFilter: string | null;
  intervalSec: number;
  lastPolledAt: string | null;
  lastCommitSha: string | null;
  lastError: string | null;
  hitCount: number;
  recentCommitCount?: number;
  repoUrl: string;
  createdAt: string;
}

export interface GithubRepoCommitItem {
  id: string;
  monitorId: string;
  fullName: string;
  label: string | null;
  pathFilter: string | null;
  sha: string;
  shortSha: string;
  message: string;
  authorName: string | null;
  authorLogin: string | null;
  htmlUrl: string;
  committedAt: string | null;
  filesAdded: string[];
  filesModified: string[];
  filesRemoved: string[];
  alerted: boolean;
  createdAt: string;
}

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
  intervalSec: number;
  lastTweetId: string | null;
  lastTweetCount: number | null;
  lastPolledAt: string | null;
  lastError: string | null;
  alertCount: number;
  heatAtEnroll: number | null;
  previousUsername: string | null;
  usernameChangedAt: string | null;
  createdAt: string;
}

/** Tag → enroll all projects rule for user monitor. */
export interface ProjectMonitorTagRule {
  id: string;
  tagSlug: string;
  enabled: boolean;
  intervalSec: number;
  topicId: number | null;
  alertMode: string;
  alertEnabled: boolean;
  maxProjects: number;
  lastEnrollAt: string | null;
  lastRunAt: string | null;
  enrolledCount: number;
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

/**
 * Format an ISO date in the **local** timezone with short zone label
 * (e.g. "Jul 17, 03:42 PM GMT+6"). Prefer `<LocalTime>` in server
 * components so SSR never shows server-UTC times.
 */
export { fmtLocalDate as fmtDate } from "./time";

/** Compact follower counts: 4400 -> 4.4K. */
export function fmtNum(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
