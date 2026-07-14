// GetMoni API client — a Node/TypeScript port of the tools embedded in the
// GetMoni browser extension's background.js (see MONI.md for the full endpoint
// map). It covers the REST surface plus a helper to open the events WebSocket.
//
// House style follows TwitterClient: a single class, native `fetch`, and typed
// result envelopes. Unlike the extension (which wraps axios) we hit `fetch`
// directly and serialize array query params comma-style to match the
// extension's `qs` config (`arrayFormat: "comma"`).

import { randomUUID } from "node:crypto";
import {
  MoniStatus,
  OrderDirection,
  type AuthTokens,
  type CheckScamPayload,
  type CreateTagPayload,
  type FilterOption,
  type GetFeedParams,
  type GetHoldersParams,
  type GetLinkedWalletsParams,
  type GetMentionedTokenChainsParams,
  type GetMentionedTokensParams,
  type GetMentionedWalletsParams,
  type GetObservedParams,
  type GetSmartsParams,
  type GetSmartsTagsParams,
  type GetTagsParams,
  type GetTweetParams,
  type LookupTagsParams,
  type MoniClientOptions,
  type MoniResult,
  type ObservedAccount,
  type ObservedFilterParams,
  type PostTransactionPayload,
  type ReportScamPayload,
  type ScamCheckResponse,
  type SmartFollowersResponse,
  type SuggestProjectPayload,
  type SuggestSmartPayload,
  SuggestionActionType,
  type SwapQuoteParams,
  type Tag,
  type TimelineResponse,
  type TransactionHistoryParams,
} from "./types.js";

const PROD_HOST = "api.moni.ai";
const TEST_HOST = "api.test.moni.ai";
const PROD_EVENTS_HOST = "api-events.moni.ai";
const TEST_EVENTS_HOST = "api-events.test.moni.ai";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const DEFAULT_REQUEST_VERSION = "2.9.1";

/** Query value types we know how to serialize. */
type QueryPrimitive = string | number | boolean;
type QueryValue = QueryPrimitive | QueryPrimitive[] | undefined | null;
type Query = Record<string, QueryValue>;

interface RequestOptions {
  /** Override the API version segment. Defaults to `v1`. `null` = no version (`/api/`). */
  version?: "v1" | "v2" | null | undefined;
  query?: Query | undefined;
  body?: unknown;
  headers?: Record<string, string> | undefined;
  /** Skip attaching the Authorization header (used for the token endpoints). */
  noAuth?: boolean | undefined;
}

export class MoniClient {
  private accessToken: string | undefined;
  private refreshTokenValue: string | undefined;
  private host: string;
  private eventsHost: string;
  private onRefresh: MoniClientOptions["onRefresh"];
  private fetchImpl: typeof fetch;
  /** Standard telemetry/session headers the extension sends on every call. */
  private lang: string;
  private requestVersion: string;
  private userAgent: string;
  private telegramUserId: string;
  private sessionId: string | undefined;
  private sessionKey: string | undefined;
  /** Guards against parallel refresh storms — matches the extension's single-flight refresh. */
  private refreshInFlight: Promise<AuthTokens | undefined> | null = null;

  constructor(options: MoniClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.refreshTokenValue = options.refreshToken;
    this.host = options.host ?? (options.test ? TEST_HOST : PROD_HOST);
    this.eventsHost =
      options.eventsHost ?? (options.test ? TEST_EVENTS_HOST : PROD_EVENTS_HOST);
    this.onRefresh = options.onRefresh;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.lang = options.lang ?? "en";
    this.requestVersion = options.requestVersion ?? DEFAULT_REQUEST_VERSION;
    this.userAgent = options.userAgent ?? DEFAULT_UA;
    this.telegramUserId = options.telegramUserId ?? "1";
    this.sessionId = options.sessionId;
    this.sessionKey = options.sessionKey;
    if (!this.fetchImpl) {
      throw new Error("No fetch implementation available; pass options.fetch");
    }
  }

  /** Current bearer token, if any. */
  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  /** Replace the stored credentials (e.g. after an external login). */
  setTokens(tokens: Partial<AuthTokens>): void {
    if (tokens.accessToken !== undefined) this.accessToken = tokens.accessToken;
    if (tokens.refreshToken !== undefined)
      this.refreshTokenValue = tokens.refreshToken;
  }

  // ── Request plumbing ──

  private baseUrl(version: RequestOptions["version"]): string {
    const seg = version === null ? "" : `${version ?? "v1"}/`;
    return `https://${this.host}/api/${seg}`;
  }

  /** Serialize query params with `arrayFormat: "comma"` (matches the extension's qs config). */
  private buildQuery(query?: Query): string {
    if (!query) return "";
    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        const encoded = value.map((v) => encodeURIComponent(String(v))).join(",");
        parts.push(`${encodeURIComponent(key)}=${encoded}`);
      } else {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
    }
    return parts.length ? `?${parts.join("&")}` : "";
  }

  private headers(opts: RequestOptions, hasBody: boolean): Record<string, string> {
    // Base set mirrors what the extension sends on every call (see demo/req/*).
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      lang: this.lang,
      requestid: randomUUID(),
      requestversion: this.requestVersion,
      telegramuserid: this.telegramUserId,
      "user-agent": this.userAgent,
    };
    if (this.sessionId) headers.sessionid = this.sessionId;
    if (this.sessionKey) headers.sessionkey = this.sessionKey;
    // Caller overrides win (e.g. the `refreshToken` header on auth/refresh/).
    Object.assign(headers, opts.headers);
    if (hasBody) headers["Content-Type"] = "application/json";
    if (!opts.noAuth && this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  /** Decode a JWT's `exp` claim (seconds). Returns null if not a JWT. */
  private tokenExp(token: string): number | null {
    try {
      const payload = token.split(".")[1];
      if (!payload) return null;
      const json = Buffer.from(payload, "base64").toString("utf8");
      const exp = JSON.parse(json).exp;
      return typeof exp === "number" ? exp : null;
    } catch {
      return null;
    }
  }

  /**
   * Refresh the access token, single-flighted. Uses `onRefresh` if provided,
   * otherwise calls `POST auth/refresh/` with the stored refresh token.
   */
  private async refresh(): Promise<AuthTokens | undefined> {
    if (!this.refreshTokenValue) return undefined;
    if (this.refreshInFlight) return this.refreshInFlight;

    const run = async (): Promise<AuthTokens | undefined> => {
      const refreshToken = this.refreshTokenValue as string;
      if (this.onRefresh) return this.onRefresh(refreshToken);
      const res = await this.rawFetch("POST", "auth/refresh/", {
        version: "v1",
        noAuth: true,
        body: {},
        headers: { refreshToken },
      });
      if (res.ok) return (await res.json()) as AuthTokens;
      return undefined;
    };

    this.refreshInFlight = run();
    try {
      const tokens = await this.refreshInFlight;
      if (tokens) this.setTokens(tokens);
      return tokens;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async rawFetch(
    method: string,
    path: string,
    opts: RequestOptions,
  ): Promise<Response> {
    const url =
      this.baseUrl(opts.version) + path + this.buildQuery(opts.query);
    const hasBody = opts.body !== undefined && method !== "GET";
    const init: RequestInit = {
      method,
      headers: this.headers(opts, hasBody),
    };
    if (hasBody) init.body = JSON.stringify(opts.body);
    return this.fetchImpl(url, init);
  }

  /**
   * Perform a request and wrap it in a MoniResult. Proactively refreshes an
   * expiring token before the call, and retries once on a 401, mirroring the
   * extension's request interceptor.
   */
  private async request<T>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<MoniResult<T>> {
    // Proactive refresh when the token is about to expire (10s skew).
    if (!opts.noAuth && this.accessToken && this.refreshTokenValue) {
      const exp = this.tokenExp(this.accessToken);
      if (exp !== null && exp < Date.now() / 1000 + 10) {
        await this.refresh();
      }
    }

    try {
      let res = await this.rawFetch(method, path, opts);

      if (res.status === MoniStatus.Unauthorized && !opts.noAuth && this.refreshTokenValue) {
        const tokens = await this.refresh();
        if (tokens) res = await this.rawFetch(method, path, opts);
      }

      return this.toResult<T>(res);
    } catch {
      // Network / DNS / abort → collapse to NotDocumentedError like the extension.
      return { status: MoniStatus.NotDocumentedError };
    }
  }

  private async toResult<T>(res: Response): Promise<MoniResult<T>> {
    if (res.ok) {
      const data = await this.parseBody<T>(res);
      const status =
        res.status === MoniStatus.Created ? MoniStatus.Created : MoniStatus.Success;
      return { status, data: data as T };
    }
    // Non-2xx: map 5xx to NotDocumentedError, otherwise pass the code through.
    const status =
      res.status >= 500
        ? MoniStatus.NotDocumentedError
        : (res.status as MoniStatus);
    return { status } as MoniResult<T>;
  }

  private async parseBody<T>(res: Response): Promise<T | undefined> {
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  // Convenience verb wrappers.
  private get<T>(path: string, query?: Query, version?: RequestOptions["version"]) {
    return this.request<T>("GET", path, { query, version });
  }
  private post<T>(path: string, body?: unknown, opts: Partial<RequestOptions> = {}) {
    return this.request<T>("POST", path, { body, ...opts });
  }
  private patch<T>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, { body });
  }
  private put<T>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body });
  }
  private del<T>(path: string, body?: unknown) {
    return this.request<T>("DELETE", path, { body });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Auth & Account
  // ═══════════════════════════════════════════════════════════════════

  /** `POST auth/token/` — mint an access/refresh token pair. */
  getTokens() {
    return this.post<AuthTokens>("auth/token/", undefined, { noAuth: true });
  }

  /** `POST auth/bind/` — bind an auth identity. */
  bindAuth(payload: Record<string, unknown>) {
    return this.post<unknown>("auth/bind/", payload);
  }

  /** `POST auth/turnkey/` — Turnkey auth. */
  turnkeyAuth(payload: Record<string, unknown>) {
    return this.post<unknown>("auth/turnkey/", payload);
  }

  /** `POST auth/refresh/` — exchange a refresh token for a fresh pair. */
  refreshToken(refreshToken: string) {
    return this.request<AuthTokens>("POST", "auth/refresh/", {
      noAuth: true,
      body: {},
      headers: { refreshToken },
    });
  }

  /** `GET account/` — current account info. */
  getAccount<T = unknown>() {
    return this.get<T>("account/");
  }

  /** `PATCH account/` — update account fields. */
  updateAccount<T = unknown>(payload: Record<string, unknown>) {
    return this.patch<T>("account/", payload);
  }

  /** `GET account/limits/slots/` — slot limits. */
  getSlotLimits<T = unknown>() {
    return this.get<T>("account/limits/slots/");
  }

  /** `PATCH account/settings/` — update user settings. */
  updateSettings<T = unknown>(payload: Record<string, unknown>) {
    return this.patch<T>("account/settings/", payload);
  }

  /** `GET account/auth/google/` — Google OAuth start URL. */
  getGoogleAuthUrl<T = unknown>() {
    return this.get<T>("account/auth/google/");
  }

  /** `GET account/auth/twitter/` — Twitter OAuth start URL. */
  getTwitterAuthUrl<T = unknown>() {
    return this.get<T>("account/auth/twitter/");
  }

  /** `DELETE account/auth/twitter/` — disconnect the linked Twitter account. */
  disconnectTwitter() {
    return this.del<void>("account/auth/twitter/");
  }

  // ═══════════════════════════════════════════════════════════════════
  // Social / Observing  (the crypto-alpha surface)
  // ═══════════════════════════════════════════════════════════════════

  /** `GET observed/resolve/{slug}/` — resolve a slug to an observed account. */
  resolveObserved<T = ObservedAccount>(slug: string) {
    return this.get<T>(`observed/resolve/${encodeURIComponent(slug)}/`);
  }

  /** `GET observed/` — fetch an observed account by any identifier
   *  (twitterUsername, tokenAddress, …). Mirrors the extension's getAccountById. */
  getObserved<T = ObservedAccount>(params: GetObservedParams) {
    return this.get<T>("observed/", {
      observedId: params.observedId,
      twitterUsername: params.twitterUsername,
      twitterCommunityId: params.twitterCommunityId,
      tokenSymbol: params.tokenSymbol,
      tokenAddress: params.tokenAddress,
      chainId: params.chainId,
      timeframe: params.timeframe,
      includeChanges: params.includeChanges,
    });
  }

  /** `GET observed/smart_followers/` — smart followers of an observed entity.
   *  Defaults mirror the extension's UI call: `orderBy=SCORE`, `orderByDirection=DESC`,
   *  `filter=all`, `limit=20`, `offset=0` (see demo/req/smart_followers.txt). */
  getSmartFollowers<T = SmartFollowersResponse>(params: GetSmartsParams) {
    return this.get<T>("observed/smart_followers/", {
      observedId: params.observedId,
      observedType: params.observedType,
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
      orderBy: params.orderBy ?? "SCORE",
      orderByDirection: (params.orderByDirection ?? "DESC").toUpperCase(),
      tagCategories: params.tagCategories,
      filter: params.filter ?? "all",
    });
  }

  /** `GET observed/smart_followers/tag_categories/` — smart-follower tag categories. */
  getSmartFollowerTags<T = unknown>(params: GetSmartsTagsParams) {
    return this.get<T>("observed/smart_followers/tag_categories/", {
      observedId: params.slug,
      observedType: params.observedType,
    });
  }

  /** `GET observed/smart_followers/filters/` — available smart-follower filters. */
  getSmartFollowerFilters<T = FilterOption[]>(params: ObservedFilterParams) {
    return this.get<T>("observed/smart_followers/filters/", { ...params });
  }

  /** `GET observed/timeline/` — activity feed for an observed entity. */
  getTimeline<T = TimelineResponse>(params: GetFeedParams) {
    return this.get<T>("observed/timeline/", {
      observedId: params.observedId,
      observedType: params.observedType,
      tokenAddress: params.tokenAddress,
      tokenSymbol: params.tokenSymbol,
      limit: params.limit,
      toDate: params.toDate,
      types: params.types,
      smartData: params.smartData ? JSON.stringify(params.smartData) : undefined,
    });
  }

  /** `GET observed/linked_wallet/` — wallets linked to an observed account. */
  getLinkedWallets<T = unknown>(params: GetLinkedWalletsParams) {
    return this.get<T>("observed/linked_wallet/", { ...params });
  }

  /** `GET observed/mentioned_tokens/` — tokens mentioned by/around an observed entity. */
  getMentionedTokens<T = unknown>(params: GetMentionedTokensParams) {
    return this.get<T>("observed/mentioned_tokens/", { ...params });
  }

  /** `GET observed/mentioned_tokens/chains/` — chains for mentioned tokens. */
  getMentionedTokenChains<T = unknown>(params: GetMentionedTokenChainsParams) {
    return this.get<T>("observed/mentioned_tokens/chains/", { ...params });
  }

  /** `GET observed/mentioned_wallets/` — wallets mentioned around an observed entity. */
  getMentionedWallets<T = unknown>(params: GetMentionedWalletsParams) {
    return this.get<T>("observed/mentioned_wallets/", { ...params });
  }

  /** `GET observed/holders/` — smart holders of a token/project. */
  getHolders<T = unknown>(params: GetHoldersParams) {
    return this.get<T>("observed/holders/", {
      observedId: params.observedId,
      observedType: params.observedType,
      limit: params.limit,
      offset: params.offset,
      orderBy: params.orderBy,
      orderByDirection: params.orderByDirection?.toUpperCase(),
      tagCategories: params.tagCategories,
      filter: params.filter,
    });
  }

  /** `GET observed/holders/tag_categories/` — holder tag categories. */
  getHolderTags<T = unknown>(params: ObservedFilterParams) {
    return this.get<T>("observed/holders/tag_categories/", { ...params });
  }

  /** `GET observed/holders/filters/` — available holder filters. */
  getHolderFilters<T = FilterOption[]>(params: ObservedFilterParams) {
    return this.get<T>("observed/holders/filters/", { ...params });
  }

  /** `GET observed/smart_mentions/filters/` — available smart-mention filters. */
  getSmartMentionFilters<T = FilterOption[]>(params: ObservedFilterParams) {
    return this.get<T>("observed/smart_mentions/filters/", { ...params });
  }

  /** `GET observed/{slugId}/offer/type/` — suggestion types already submitted. */
  getSubmittedSuggestions<T = unknown>(slugId: string) {
    return this.get<T>(`observed/${encodeURIComponent(slugId)}/offer/type/`);
  }

  /** `POST observed/followers/offer/` — suggest a smart follower.
   *  Any `actionType` discriminator is stripped and never sent (matches the extension). */
  suggestSmartFollower(payload: SuggestSmartPayload) {
    const { actionType: _drop, ...body } = payload;
    return this.post<void>("observed/followers/offer/", body);
  }

  /** `POST projects/offer/` — suggest a project.
   *  Any `actionType` discriminator is stripped and never sent (matches the extension). */
  suggestProject(payload: SuggestProjectPayload= {}) {
    const { actionType: _drop, ...body } = payload;
    return this.post<void>("projects/offer/", body);
  }

  /**
   * Submit a suggestion, routing by `actionType` exactly like the extension's
   * SubmitSuggestionRequest handler: `isProject` → `projects/offer/`, otherwise
   * `observed/followers/offer/`. The `actionType` field is stripped from the body.
   */
  submitSuggestion(payload: SuggestProjectPayload | SuggestSmartPayload) {
    const { actionType, ...body } = payload;
    const path =
      actionType === SuggestionActionType.Project
        ? "projects/offer/"
        : "observed/followers/offer/";
    return this.post<void>(path, body);
  }

  /** `POST projects/offer/scam/` — report a project/account as a scam. */
  reportScam(payload: ReportScamPayload) {
    return this.post<void>("projects/offer/scam/", payload);
  }

  /** `DELETE projects/offer/scam/` — withdraw a scam report. */
  unreportScam(payload: ReportScamPayload) {
    return this.del<void>("projects/offer/scam/", payload);
  }

  /**
   * `POST projects/offer/scam/raw_get/` — batch-check accounts for scam status.
   * Hits `/api/` (no version segment), matching the extension's direct fetch.
   */
  checkScams<T = ScamCheckResponse>(payload: CheckScamPayload) {
    return this.request<T>("POST", "projects/offer/scam/raw_get/", {
      version: null,
      body: payload,
    });
  }

  /** `POST projects/offer/scam/raw/` — report scam (raw form, `/api/`). */
  reportScamRaw(payload: ReportScamPayload) {
    return this.request<void>("POST", "projects/offer/scam/raw/", {
      version: null,
      body: payload,
    });
  }

  /** `GET {userId}/tweets/{id}/` — tweet data via Moni's proxy. */
  getTweet<T = unknown>({ userId, id }: GetTweetParams) {
    return this.get<T>(
      `${encodeURIComponent(userId)}/tweets/${encodeURIComponent(id)}/`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // Tags
  // ═══════════════════════════════════════════════════════════════════

  /** `GET account/tags/` — list the user's tags. */
  getTags(params?: GetTagsParams) {
    return this.get<Tag[]>("account/tags/", params as Query);
  }

  /** `POST account/tags/` — create a tag. */
  createTag(payload: CreateTagPayload) {
    return this.post<Tag>("account/tags/", payload);
  }

  /** `DELETE account/tags/{id}/` — delete a tag. */
  deleteTag(id: string) {
    return this.del<void>(`account/tags/${encodeURIComponent(id)}/`);
  }

  /** `GET account/tags/lookup/` — look up tags. */
  lookupTags<T = Tag[]>(params: LookupTagsParams) {
    return this.get<T>("account/tags/lookup/", params as Query);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Trading / Printer / Wallets
  // ═══════════════════════════════════════════════════════════════════

  /** `GET chain/_/wallet/` — the user's wallets across chains. */
  getWallets<T = unknown>() {
    return this.get<T>("chain/_/wallet/");
  }

  /** `PATCH chain/_/wallet/{walletId}/` — update a wallet. */
  updateWallet<T = unknown>(walletId: string, payload: Record<string, unknown>) {
    return this.patch<T>(`chain/_/wallet/${encodeURIComponent(walletId)}/`, payload);
  }

  /** `POST chain/{chainId}/wallet/{walletId}/transaction/` — submit a trade. */
  postTransaction<T = unknown>(payload: PostTransactionPayload) {
    const { chainId, walletId } = payload;
    return this.post<T>(
      `chain/${encodeURIComponent(String(chainId))}/wallet/${encodeURIComponent(walletId)}/transaction/`,
      payload,
    );
  }

  /** `GET account/transaction/history/` — transaction history. */
  getTransactionHistory<T = unknown>(params?: TransactionHistoryParams) {
    return this.get<T>("account/transaction/history/", params as Query);
  }

  /** `GET account/settings/trade/quick_buy/` — quick-buy settings. */
  getQuickBuySettings<T = unknown>() {
    return this.get<T>("account/settings/trade/quick_buy/");
  }

  /** `PUT account/settings/trade/quick_buy/` — update quick-buy settings. */
  updateQuickBuySettings<T = unknown>(payload: Record<string, unknown>) {
    return this.put<T>("account/settings/trade/quick_buy/", payload);
  }

  /** `GET account/settings/trade/presets/` — trading presets. */
  getTradingPresets<T = unknown>() {
    return this.get<T>("account/settings/trade/presets/");
  }

  /** `PATCH account/settings/trade/presets/{id}/` — update a trading preset. */
  updateTradingPreset<T = unknown>(id: string, payload: Record<string, unknown>) {
    return this.patch<T>(
      `account/settings/trade/presets/${encodeURIComponent(id)}/`,
      payload,
    );
  }

  /** `GET token/swap/quote/` — swap quote. */
  getSwapQuote<T = unknown>(params: SwapQuoteParams) {
    return this.get<T>("token/swap/quote/", params as Query);
  }

  /** `GET fee/stats/` — network fee stats. */
  getFeeStats<T = unknown>() {
    return this.get<T>("fee/stats/");
  }

  // ═══════════════════════════════════════════════════════════════════
  // Other
  // ═══════════════════════════════════════════════════════════════════

  /** `GET banners/` — promotional banners. */
  getBanners<T = unknown>() {
    return this.get<T>("banners/");
  }

  /** `POST referral/bind-referral/` — apply a referral/invite code. */
  bindReferral(payload: Record<string, unknown>) {
    return this.post<unknown>("referral/bind-referral/", payload);
  }

  /** `POST image/pnl/position/` — generate a PnL position image. */
  generatePnlImage<T = unknown>(payload: Record<string, unknown>) {
    return this.post<T>("image/pnl/position/", payload);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Events WebSocket
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Build the events WebSocket URL. The extension connects to
   * `wss://api-events.moni.ai/api/v1/events/` with the bearer token and a
   * client id passed as query params.
   */
  eventsUrl(params: { clientId: string; includeProcessingTxs?: boolean }): string {
    const q = this.buildQuery({
      authorizationHeader: `Bearer ${this.accessToken ?? null}`,
      clientId: params.clientId,
      includeProcessingTxs: String(params.includeProcessingTxs ?? true),
    });
    return `wss://${this.eventsHost}/api/v1/events/${q}`;
  }
}

export { MoniStatus, OrderDirection };
