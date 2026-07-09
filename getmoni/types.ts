// Types for the GetMoni API client (mirrors the endpoints extracted in MONI.md).
//
// The GetMoni extension wraps every call in a `{ status, data? }` envelope keyed
// off the HTTP status code. We keep that convention so callers can branch on
// `status === MoniStatus.Success` exactly like the extension does, while still
// getting typed `data`.

/** HTTP status codes the extension treats as meaningful outcomes. */
export enum MoniStatus {
  Success = 200,
  Created = 201,
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  Conflict = 409,
  DataTooLarge = 413,
  ExpectationFailed = 417,
  UnprocessableEntity = 422,
  /** Any 5xx / network / parse failure collapses to this, matching the extension. */
  NotDocumentedError = 500,
  GatewayTimeout = 504,
}

/** Result envelope returned by every client method. */
export type MoniResult<T = void> =
  | { status: MoniStatus.Success | MoniStatus.Created; data: T }
  | { status: Exclude<MoniStatus, MoniStatus.Success | MoniStatus.Created>; data?: undefined };

/** Sort direction, sent upper-cased on the wire (`ASC` / `DESC`). */
export enum OrderDirection {
  Asc = "ASC",
  Desc = "DESC",
}

/** `orderBy` values for the smart-followers / holders lists (confirmed: `SCORE`). */
export enum SmartFollowerOrderBy {
  Score = "SCORE",
}

/** The kind of entity an `observed*` endpoint is scoped to. Wire values are
 *  lowercase snake_case (confirmed against live traffic in demo/). */
export enum ObservedType {
  TwitterAccount = "twitter_account",
  TwitterCommunity = "twitter_community",
}

/** Chains the trading/printer side supports. */
export enum Chain {
  Solana = "SOL",
  Eth = "ETH",
}

/** Timeframe buckets used by score/stat endpoints. */
export enum Timeframe {
  H1 = "H1",
  H24 = "H24",
  D3 = "D3",
  D7 = "D7",
  D30 = "D30",
  D90 = "D90",
  Y1 = "Y1",
  All = "ALL",
}

/** Scam classification returned by project offer endpoints. */
export enum ScamStatus {
  Scam = "SCAM",
  Approved = "APPROVED",
  Suspicious = "SUSPICIOUS",
}

/** Event kinds returned/filterable on `observed/timeline/` (from contentScript.js). */
export enum TimelineEventType {
  NewMention = "NEW_MENTION",
  NewPost = "NEW_POST",
  NewFollowing = "NEW_FOLLOWING",
  NewFollowingBySmart = "NEW_FOLLOWING_BY_SMART",
  NewUnfollowingBySmart = "NEW_UNFOLLOWING_BY_SMART",
  NewRawProjectFollowing = "NEW_RAW_PROJECT_FOLLOWING",
  NewBio = "NEW_BIO",
  NewLink = "NEW_LINK",
}

/** Discriminator for a timeline `smartData` filter object (from contentScript.js). */
export enum SmartDataType {
  MatchSentiment = "MATCH_SENTIMENT",
  MatchCategory = "MATCH_CATEGORY",
  MatchText = "MATCH_TEXT",
  SmartFollowersCount = "SMART_FOLLOWERS_COUNT",
}

/** Sentiment buckets (also the slugs returned by smart_mentions/filters). */
export enum Sentiment {
  All = "all",
  Positive = "positive",
  Negative = "negative",
  Neutral = "neutral",
}

/** A `smartData` timeline filter, e.g. `{ type: MATCH_SENTIMENT, categories: ["all"] }`.
 *  Serialized as JSON in the query string. */
export interface SmartData {
  type: SmartDataType;
  categories?: string[];
  [key: string]: unknown;
}

// ── Client construction ──

export interface MoniClientOptions {
  /** Bearer access token (the extension's `printerAccessToken`). */
  accessToken?: string;
  /** Refresh token, used by `refreshToken()` and automatic refresh-on-401. */
  refreshToken?: string;
  /** Point at the `api.test.moni.ai` stack instead of production. Default false. */
  test?: boolean;
  /** Override the API host entirely (e.g. a proxy). Takes precedence over `test`. */
  host?: string;
  /** Override the WebSocket events host. */
  eventsHost?: string;
  /**
   * Called when a request 401s and a refresh token is present. Should return a
   * fresh token pair. If omitted, the client attempts `POST auth/refresh/` itself.
   */
  onRefresh?: (refreshToken: string) => Promise<AuthTokens | undefined>;
  fetch?: typeof fetch;

  // ── Telemetry / session headers the extension sends on every call ──
  /** `lang` header. Default "en". */
  lang?: string;
  /** `requestversion` header. Default "2.9.1" (the version captured in demo/). */
  requestVersion?: string;
  /** `user-agent` header. Defaults to the extension's Chrome UA. */
  userAgent?: string;
  /** `telegramuserid` header. Default "1". */
  telegramUserId?: string;
  /** `sessionid` header, if you have one. */
  sessionId?: string;
  /** `sessionkey` header, if you have one. */
  sessionKey?: string;
}

// ── Auth ──

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// ── Shared query params ──

/** Common pagination + sorting params shared by the observing endpoints. */
export interface Pagination {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderByDirection?: OrderDirection;
}

export interface ObservedScope {
  observedId: string;
  observedType: ObservedType;
}

/** Params for `GET observed/` — resolve/fetch an account by any identifier.
 *  Confirmed against demo/req/observed.txt (`twitterUsername`+`timeframe`). */
export interface GetObservedParams {
  observedId?: string;
  twitterUsername?: string;
  twitterCommunityId?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  chainId?: string;
  timeframe?: Timeframe;
  includeChanges?: boolean;
}

// ── Social / observing param shapes ──

export interface GetSmartsParams extends ObservedScope, Pagination {
  tagCategories?: string[];
  /** Filter slug, e.g. "all". Defaults to "all" on the wire. */
  filter?: string;
  /** Sort field. The UI sends `SCORE` (see demo/req/smart_followers.txt). */
  orderBy?: SmartFollowerOrderBy | string;
}

export interface GetSmartsTagsParams {
  /** slug of the observed account */
  slug: string;
  observedType: ObservedType;
}

export interface GetFeedParams extends ObservedScope {
  tokenAddress?: string;
  tokenSymbol?: string;
  limit?: number;
  toDate?: number;
  /** Event kinds to include, e.g. `[TimelineEventType.NewMention]`. */
  types?: TimelineEventType[];
  /** Optional filter object, JSON-serialized on the wire. */
  smartData?: SmartData;
}

export interface GetHoldersParams extends ObservedScope, Pagination {
  tagCategories?: string[];
  filter?: string;
}

export type GetMentionedTokensParams = ObservedScope & Pagination;
export type GetMentionedWalletsParams = ObservedScope & Pagination;
export type GetLinkedWalletsParams = ObservedScope & Pagination;
export type GetMentionedTokenChainsParams = ObservedScope;
export type ObservedFilterParams = ObservedScope;

// ── Suggestions / scam ──

/** Client-side discriminator carried on a suggestion payload. The extension uses
 *  it only to pick the endpoint, then strips it before POSTing — it is never sent
 *  to the server (see background.js SubmitSuggestionRequest handler). */
export enum SuggestionActionType {
  /** → `projects/offer/` */
  Project = "isProject",
  /** → `observed/followers/offer/` */
  Smart = "isSmart",
}

export interface SuggestSmartPayload {
  observedId: string;
  observedType: ObservedType;
  username: string;
  /** Optional discriminator; stripped before the request, never sent. */
  actionType?: SuggestionActionType.Smart | "isSmart";
  [key: string]: unknown;
}

export interface SuggestProjectPayload {
  /** Optional discriminator; stripped before the request, never sent. */
  actionType?: SuggestionActionType.Project | "isProject";
  [key: string]: unknown;
}

export interface ReportScamPayload {
  [key: string]: unknown;
}

export interface CheckScamItem {
  name: string;
  username: string;
  profileImageBytes?: number[];
}

export interface CheckScamPayload {
  items: CheckScamItem[];
}

// ── Tags ──

export interface Tag {
  id: string;
  name: string;
  color?: string;
  [key: string]: unknown;
}

export interface CreateTagPayload {
  name: string;
  color?: string;
  [key: string]: unknown;
}

export interface GetTagsParams {
  [key: string]: unknown;
}

export interface LookupTagsParams {
  [key: string]: unknown;
}

// ── Trading / wallets ──

export interface SwapQuoteParams {
  [key: string]: unknown;
}

export interface TransactionHistoryParams {
  [key: string]: unknown;
}

export interface PostTransactionPayload {
  chainId: Chain | string;
  walletId: string;
  tokenAddress: string;
  tokenSymbol?: string;
  amount?: number;
  preset?: unknown;
  [key: string]: unknown;
}

// ── Tweets ──

export interface GetTweetParams {
  userId: string;
  id: string;
}

// ═══════════════════════════════════════════════════════════════════
// Response shapes (derived from the captured payloads in demo/res/).
//
// These cover the fields Moni actually returns today. They keep an index
// signature so forward-compatible fields don't break callers; pass your own
// type argument to a method to override entirely.
// ═══════════════════════════════════════════════════════════════════

export interface ScamInfo {
  status: "UNRANKED" | "APPROVED" | "SCAM" | "SUSPICIOUS";
  reportsCount: number;
  reportedByAccount: boolean;
  reportedType: string | null;
  originalUrl: string | null;
  originalDiscoverUrl: string | null;
}

export interface SocialLink {
  url: string;
  logoUrl: string;
  type:  "TWITTER" | "DISCORD" | "WEB";
  name: string;
}

export interface SmartLevel {
  tier: number;
  logoUrl: string;
}

export interface SmartTag {
  name: string;
}

/** The `socialData` block returned inside an observed account (demo/res/observed.txt). */
export interface SocialData {
  observedId: number;
  observedType: ObservedType | string;
  username: string;
  twitterUrl: string;
  twitterUserId: string;
  name: string;
  description: string | null;
  isProject: boolean;
  tags: unknown[];
  profileImageUrl: string | null;
  profileBannerUrl: string | null;
  smartFollowersScore: number;
  smartFollowersScoreChange: number;
  smartFollowersCount: number;
  smartFollowersCountChange: number;
  smartFollowersBurstEventsCount: number;
  smartFollowersBurstEventsCountChange: number;
  followersCount: number;
  followersCountChange: number;
  smartMentionsCount: number;
  smartMentionsCountChange: number;
  smartMentionsBurstEventsCount: number;
  smartMentionsBurstEventsCountChange: number;
  mentionsCount: number;
  mentionsCountChange: number;
  usernameChanges: unknown[];
  usernameChangeCount: number;
  descriptionChangeCount: number;
  nameChangeCount: number;
  smartLevel: SmartLevel | null;
  smartTags: SmartTag[];
  smartWalletCount: number;
  smartWalletCountChange: number;
  myWalletCount: number;
  myWalletCountChange: number;
  terminalsInfo: unknown[];
  links: SocialLink[];
  scamInfo: ScamInfo;
  contractAddressesInfo: unknown[];
  caCount: number;
  linkedWalletCount: number;
  mentionedWalletCount: number;
  [key: string]: unknown;
}

/** `GET observed/` / `observed/resolve/{slug}/` response (demo/res/observed.txt). */
export interface ObservedAccount {
  userTags: unknown[];
  adminTags: unknown[];
  onchainData: unknown | null;
  socialData: SocialData;
  [key: string]: unknown;
}

/** A tweet embedded in a timeline event's `data.rawTweet`. */
export interface RawTweet {
  entities: { links: unknown[] };
  attachments: unknown | null;
  referencedTweets: unknown | null;
  referencedTweetAuthorTwitterUserId: string | null;
  likeCount: number;
  replyCount: number;
  retweetCount: number;
  bookmarkCount: number;
  impressionCount: number;
  displayTextRange: number[];
  authorTwitterUserId: string;
  twitterTweetId: string;
  sentiment: Sentiment | string;
  [key: string]: unknown;
}

/** A single `observed/timeline/` item (demo/res/timeline.txt). */
export interface TimelineItem {
  id: number;
  links: unknown[];
  twitterUrl: string;
  username: string;
  name: string;
  profileImageUrl: string | null;
  createdAt: number;
  type: TimelineEventType | string;
  text: string;
  data: {
    rawTweet?: RawTweet;
    mentionBy?: ObservedAccount;
    tweetUrl?: string;
    tweetText?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** `GET observed/timeline/` response envelope (demo/res/timeline.txt). */
export interface TimelineResponse {
  items: TimelineItem[];
  totalCount: number;
  maxAvailableCount: number;
}

/** A `smart_mentions/filters/` entry (demo/res/smart_mentions/filters.txt). */
export interface FilterOption {
  name: string;
  slug: string;
  totalCount: number;
}

/** An item in `observed/smart_followers/` (demo/res/smart_followers.txt).
 *  Same profile shape as SocialData, plus `createdAt`; `scamInfo` may be null
 *  and `observedType` is absent on list items. */
export interface SmartFollower
  extends Omit<SocialData, "observedType" | "scamInfo"> {
  createdAt: number;
  scamInfo: ScamInfo | null;
}

/** `GET observed/smart_followers/` response envelope (demo/res/smart_followers.txt). */
export interface SmartFollowersResponse {
  items: SmartFollower[];
  totalCount: number;
  maxAvailableCount: number;
}

/** One result from `projects/offer/scam/raw_get/` (demo/res/raw_get.txt). */
export interface ScamCheckResult {
  twitterUserId: string;
  username: string;
  name: string;
  status: string;
  reportsCount: number;
  reportedByAccount: boolean;
  reportedType: string | null;
  originalUrl: string | null;
  originalDiscoverUrl: string | null;
  followersScore: number;
  type: string; // e.g. "human"
  level: number | null;
  userTags: unknown[];
  adminTags: unknown[];
  [key: string]: unknown;
}

export interface ScamCheckResponse {
  items: ScamCheckResult[];
}
