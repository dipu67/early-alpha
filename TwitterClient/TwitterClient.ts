import queryIds from "./query-ids.json" with { type: "json" };
import type {
  TwitterCookies,
  TwitterClientOptions,
  TweetData,
  UserData,
  ListData,
  TweetResult,
  TweetsResult,
  ActionResult,
  GetTweetResult,
  UserResult,
  UsersResult,
  CurrentUserResult,
  ListResult,
  ListsResult,
  GrokConversationItemsResult,
  GrokConversationResult,
  GrokModel,
  GrokModelMode,
  GrokHistoryItem,
  GrokMessageData,
  GrokHistoryResult,
  GrokMessageResult,
  GrokSendMessageOptions,
  GrokSendMessageRequest,
  RateLimit,
  DeleteGrokConversationResult,
} from "./types/index.js";
const GRAPHQL_BASE = "https://x.com/i/api/graphql";
const REST_BASE = "https://x.com/i/api/1.1";
const BEARER_TOKEN =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const FALLBACK_QUERY_IDS = {
  CreateTweet: "R5EPiGHgSqbTYFyozd-gFw",
  FavoriteTweet: "lI07N6Otwv1PhnEgXILM7A",
  UnfavoriteTweet: "ZYKSe-w7KEslx3JhSIk5LA",
  CreateRetweet: "mbRO74GrOvSfRcJnlMapnQ",
  DeleteRetweet: "ZyZigVsNiFO6v1dEks1eWg",
  TweetDetail: "nBS-WpgA6ZG0CyNHD517JQ",
  SearchTimeline: "Tp1sewRU1AsZpBWhqCZicQ",
  UserByScreenName: "2qvSHpkWTMS9i0zJAwDNiA",
  UserTweets: "hr4gzZONlq23okjU8fIe_A",
  Followers: "4yeuNabfz3qFlfncCAy8Yw",
  Following: "eNoXdfXv5rU75RBzlmfuPA",
  BlueVerifiedFollowers: "zhpogrf30JrKmTss81AY8w",
  HomeTimeline: "gKia-nBM9kwuDEfSDeWMfQ",
  UsersByRestIds: "4s-T1XYy3__OdhkRmSlJBA",
  CreateList: "JCpbk4JNzi51p7hxHQNz4g",
  ListAddMember: "yhAkn9q5qaSCxPg_fpykDw",
  ListByRestId: "I1h1FzuuiD__nNvG466mKQ",
  ListLatestTweetsTimeline: "Iql5aRVyFxNZ-ORcDV_TwQ",
  ListRemoveMember: "c2IzeyWiwaQBkFs2VV_vSA",
  ListsManagementPageTimeline: "wgVgVkLURZzQ6flLmOyprA",
  ListMemberships: "qeV9WF3eN5V9SNj8iP7Kkg",
  CombinedLists: "APOFXqgNSVui9MQoRdubZQ",
  CreateGrokConversation: "vvC5uy7pWWHXS2aDi1FZeA",
  GrokHistory: "9Hyh5D4-WXLnExZkONSkZg",
  GrokConversationItemsByRestId: "DGPZeGl8lC0Nvps4afRHHQ",
} as const;

type OperationName = keyof typeof FALLBACK_QUERY_IDS;

const QUERY_IDS: Record<OperationName, string> = {
  ...FALLBACK_QUERY_IDS,
  ...(queryIds as Partial<Record<OperationName, string>>),
};

// ── Feature sets ──

const TIMELINE_FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
} as const;

const TWEET_CREATE_FEATURES = {
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  articles_preview_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
} as const;

const TWEET_DETAIL_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
} as const;

const USER_PROFILE_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
} as const;

const BASIC_FEATURES = {
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
} as const;

// ── Types ──

export class TwitterClient {
  private authToken: string;
  private ct0: string;
  private userAgent: string;
  private cachedUserId: string | undefined;
  rateLimit: RateLimit | undefined;

  constructor(options: TwitterClientOptions) {
    if (!options.cookies.authToken || !options.cookies.ct0) {
      throw new Error("Both authToken and ct0 cookies are required");
    }
    this.authToken = options.cookies.authToken;
    this.ct0 = options.cookies.ct0;
    this.userAgent =
      options.userAgent ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
  }

  // ── Headers ──

  private jsonHeaders(): Record<string, string> {
    return {
      authorization: BEARER_TOKEN,
      "content-type": "application/json",
      "x-csrf-token": this.ct0,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      cookie: `auth_token=${this.authToken}; ct0=${this.ct0}`,
      "user-agent": this.userAgent,
      origin: "https://x.com",
      referer: "https://x.com/",
    };
  }

  private formHeaders(): Record<string, string> {
    return {
      ...this.jsonHeaders(),
      "content-type": "application/x-www-form-urlencoded",
    };
  }

  // ── GraphQL helpers ──

  private updateRateLimit(res: Response): void {
    const limit = res.headers.get("x-rate-limit-limit");
    const remaining = res.headers.get("x-rate-limit-remaining");
    const reset = res.headers.get("x-rate-limit-reset");
    if (limit && remaining && reset) {
      this.rateLimit = {
        limit: Number(limit),
        remaining: Number(remaining),
        reset: Number(reset),
      };
    }
  }

  private withRateLimit<T extends object>(
    result: T,
  ): T & { rateLimit?: RateLimit } {
    if (this.rateLimit) return { ...result, rateLimit: this.rateLimit };
    return result;
  }

  private async graphqlPost<T = unknown>(
    op: OperationName,
    variables: Record<string, unknown>,
    features?: Record<string, boolean>,
  ): Promise<{ data?: T; errors?: Array<{ message: string; code?: number }> }> {
    const url = `${GRAPHQL_BASE}/${QUERY_IDS[op]}/${op}`;
    const body: Record<string, unknown> = { variables, queryId: QUERY_IDS[op] };
    if (features) body.features = features;

    const res = await fetch(url, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
    this.updateRateLimit(res);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<{
      data?: T;
      errors?: Array<{ message: string; code?: number }>;
    }>;
  }

  private async graphqlGet<T = unknown>(
    op: OperationName,
    variables: Record<string, unknown>,
    features?: Record<string, boolean>,
    fieldToggles?: Record<string, boolean>,
  ): Promise<{ data?: T; errors?: Array<{ message: string; code?: number }> }> {
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
    });
    if (features && Object.keys(features).length > 0)
      params.set("features", JSON.stringify(features));
    if (fieldToggles) params.set("fieldToggles", JSON.stringify(fieldToggles));

    const url = `${GRAPHQL_BASE}/${QUERY_IDS[op]}/${op}?${params}`;

    const res = await fetch(url, {
      method: "GET",
      headers: this.jsonHeaders(),
    });
    this.updateRateLimit(res);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<{
      data?: T;
      errors?: Array<{ message: string; code?: number }>;
    }>;
  }

  private extractErrors(
    errors?: Array<{ message: string }>,
  ): string | undefined {
    if (errors?.length) return errors.map((e) => e.message).join(", ");
    return undefined;
  }

  // ── Mappers ──

  // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response shapes vary
  private mapTweetFromGraphql(result: any): TweetData | undefined {
    if (!result) return undefined;
    const legacy = result.legacy;
    if (!legacy?.full_text) return undefined;

    const userLegacy = result.core?.user_results?.result?.legacy;
    const userCore = result.core?.user_results?.result?.core;
    const screenName = userLegacy?.screen_name ?? userCore?.screen_name;
    const displayName = userLegacy?.name ?? userCore?.name;
    if (!screenName) return undefined;

    return {
      id: result.rest_id || "",
      text: legacy.full_text,
      author: { username: screenName, name: displayName || screenName },
      createdAt: legacy.created_at,
      replyCount: legacy.reply_count,
      retweetCount: legacy.retweet_count,
      likeCount: legacy.favorite_count,
      conversationId: legacy.conversation_id_str,
      inReplyToStatusId: legacy.in_reply_to_status_id_str ?? undefined,
    };
  }

  // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response shapes vary
  private mapUserFromGraphql(result: any): UserData | undefined {
    if (!result) return undefined;
    const screenName = result.core?.screen_name ?? result.legacy?.screen_name;
    if (!screenName) return undefined;

    return {
      id: result.rest_id || "",
      username: screenName,
      name: result.core?.name ?? result.legacy?.name ?? screenName,
      description:
        result.legacy?.description ?? result.profile_bio?.description,
      followersCount: result.legacy?.followers_count,
      followingCount: result.legacy?.friends_count,
      tweetCount: result.legacy?.statuses_count,
      likeCount: result.legacy?.favourites_count,
      isBlueVerified: result.is_blue_verified,
      profileImageUrl:
        result.avatar?.image_url ?? result.legacy?.profile_image_url_https,
      profileBannerUrl: result.legacy?.profile_banner_url,
      createdAt: result.core?.created_at ?? result.legacy?.created_at,
      location: result.location?.location ?? result.legacy?.location,
    };
  }

  // biome-ignore lint/suspicious/noExplicitAny: deeply nested timeline instructions
  private parseTweetsFromInstructions(
    instructions: any[] | undefined,
  ): TweetData[] {
    const tweets: TweetData[] = [];
    for (const instruction of instructions ?? []) {
      for (const entry of instruction.entries ?? []) {
        const content = entry.content;
        // Single tweet entry
        const singleResult = content?.itemContent?.tweet_results?.result;
        if (singleResult) {
          const mapped = this.mapTweetFromGraphql(singleResult);
          if (mapped) tweets.push(mapped);
        }
        // Conversation module with nested items
        for (const item of content?.items ?? []) {
          const nestedResult = item?.item?.itemContent?.tweet_results?.result;
          if (nestedResult) {
            const mapped = this.mapTweetFromGraphql(nestedResult);
            if (mapped) tweets.push(mapped);
          }
        }
      }
    }
    return tweets;
  }

  // biome-ignore lint/suspicious/noExplicitAny: deeply nested timeline instructions
  private parseUsersFromInstructions(
    instructions: any[] | undefined,
  ): UserData[] {
    const users: UserData[] = [];
    for (const instruction of instructions ?? []) {
      for (const entry of instruction.entries ?? []) {
        const result = entry.content?.itemContent?.user_results?.result;
        if (result) {
          const mapped = this.mapUserFromGraphql(result);
          if (mapped) users.push(mapped);
        }
      }
    }
    return users;
  }

  // biome-ignore lint/suspicious/noExplicitAny: deeply nested timeline instructions
  private mapListFromGraphql(list: any): ListData | undefined {
    if (!list) return undefined;
    const ownerResult = list.user_results?.result;
    return {
      id: list.id_str || "",
      name: list.name || "",
      description: list.description,
      memberCount: list.member_count,
      subscriberCount: list.subscriber_count,
      isPrivate: list.mode === "Private",
      createdAt: list.created_at,
      owner: ownerResult
        ? {
            id: ownerResult.rest_id || "",
            username:
              ownerResult.core?.screen_name ??
              ownerResult.legacy?.screen_name ??
              "",
            name: ownerResult.core?.name ?? ownerResult.legacy?.name ?? "",
          }
        : undefined,
    };
  }

  // biome-ignore lint/suspicious/noExplicitAny: deeply nested timeline instructions
  private parseListsFromInstructions(instructions: any): ListData[] {
    const lists: ListData[] = [];
    if (!Array.isArray(instructions)) return lists;
    for (const instruction of instructions) {
      if (instruction.type !== "TimelineAddEntries") continue;
      for (const entry of instruction.entries ?? []) {
        if (!entry.entryId?.startsWith("owned-")) continue; // Skip list entries that are not actual lists
        const content = entry.content;
        if (
          content?.__typename === "TimelineTimelineModule" &&
          Array.isArray(content.items)
        ) {
          for (const item of content.items) {
            const listData = item?.item?.itemContent?.list;
            if (listData) {
              const mapped = this.mapListFromGraphql(listData);
              if (mapped) lists.push(mapped);
            }
          }
        } else if (content?.itemContent?.__typename === "TimelineTwitterList") {
          const mapped = this.mapListFromGraphql(content.itemContent.list);
          if (mapped) lists.push(mapped);
        }
      }
    }
    return lists;
  }

  // ── Write operations ──

  async tweet(text: string): Promise<TweetResult> {
    const variables = {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    };
    return this.createTweetRequest(variables);
  }

  async reply(text: string, replyToTweetId: string): Promise<TweetResult> {
    const variables = {
      tweet_text: text,
      reply: {
        in_reply_to_tweet_id: replyToTweetId,
        exclude_reply_user_ids: [],
      },
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    };
    return this.createTweetRequest(variables);
  }

  private async createTweetRequest(
    variables: Record<string, unknown>,
  ): Promise<TweetResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlPost<any>(
        "CreateTweet",
        variables,
        TWEET_CREATE_FEATURES,
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const tweetId = json.data?.create_tweet?.tweet_results?.result?.rest_id;
      if (tweetId) return this.withRateLimit({ success: true, tweetId });
      return this.withRateLimit({
        success: false,
        error: "Tweet created but no ID returned",
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async like(tweetId: string): Promise<ActionResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlPost<any>("FavoriteTweet", {
        tweet_id: tweetId,
      });
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });
      return this.withRateLimit({
        success: json.data?.favorite_tweet === "Done",
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async unlike(tweetId: string): Promise<ActionResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlPost<any>("UnfavoriteTweet", {
        tweet_id: tweetId,
      });
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });
      return this.withRateLimit({
        success: json.data?.unfavorite_tweet === "Done",
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async retweet(tweetId: string): Promise<ActionResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlPost<any>("CreateRetweet", {
        tweet_id: tweetId,
      });
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });
      return this.withRateLimit({
        success: !!json.data?.create_retweet?.retweet_results?.result?.rest_id,
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async unretweet(tweetId: string): Promise<ActionResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlPost<any>("DeleteRetweet", {
        source_tweet_id: tweetId,
      });
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });
      return this.withRateLimit({
        success: !!json.data?.unretweet?.source_tweet_results?.result?.rest_id,
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async follow(userId: string): Promise<ActionResult> {
    return this.friendshipAction("create", userId);
  }

  async unfollow(userId: string): Promise<ActionResult> {
    return this.friendshipAction("destroy", userId);
  }

  private async friendshipAction(
    action: "create" | "destroy",
    userId: string,
  ): Promise<ActionResult> {
    const url = `${REST_BASE}/friendships/${action}.json`;
    const body = new URLSearchParams({
      include_profile_interstitial_type: "1",
      include_blocking: "1",
      include_blocked_by: "1",
      include_followed_by: "1",
      include_want_retweets: "1",
      include_mute_edge: "1",
      include_can_dm: "1",
      include_can_media_tag: "1",
      include_ext_is_blue_verified: "1",
      include_ext_verified_type: "1",
      include_ext_profile_image_shape: "1",
      skip_status: "1",
      user_id: userId,
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.formHeaders(),
        body: body.toString(),
      });
      this.updateRateLimit(res);

      if (!res.ok) {
        const text = await res.text();
        return this.withRateLimit({
          success: false,
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        });
      }

      // biome-ignore lint/suspicious/noExplicitAny: REST v1.1 response
      const data: any = await res.json();
      if (data?.id_str) return this.withRateLimit({ success: true });
      return this.withRateLimit({
        success: false,
        error: "Unexpected response from friendship endpoint",
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── Read operations ──

  async getTweet(tweetId: string): Promise<GetTweetResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "TweetDetail",
        {
          focalTweetId: tweetId,
          with_rux_injections: false,
          rankingMode: "Relevance",
          includePromotedContent: true,
          withCommunity: true,
          withQuickPromoteEligibilityTweetFields: true,
          withBirdwatchNotes: true,
          withVoice: true,
        },
        TWEET_DETAIL_FEATURES,
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const tweetResult =
        json.data?.tweetResult?.result ??
        this.findTweetInDetailInstructions(
          json.data?.threaded_conversation_with_injections_v2?.instructions,
          tweetId,
        );

      const mapped = this.mapTweetFromGraphql(tweetResult);
      if (mapped) return this.withRateLimit({ success: true, tweet: mapped });
      return this.withRateLimit({
        success: false,
        error: "Tweet not found in response",
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
  private findTweetInDetailInstructions(
    instructions: any[] | undefined,
    tweetId: string,
  ): any {
    for (const instruction of instructions ?? []) {
      for (const entry of instruction.entries ?? []) {
        const result = entry.content?.itemContent?.tweet_results?.result;
        if (result?.rest_id === tweetId) return result;
      }
    }
    return undefined;
  }

  async getReplies(tweetId: string): Promise<TweetsResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "TweetDetail",
        {
          focalTweetId: tweetId,
          with_rux_injections: false,
          rankingMode: "Relevance",
          includePromotedContent: true,
          withCommunity: true,
          withQuickPromoteEligibilityTweetFields: true,
          withBirdwatchNotes: true,
          withVoice: true,
        },
        TWEET_DETAIL_FEATURES,
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const instructions =
        json.data?.threaded_conversation_with_injections_v2?.instructions;
      const tweets = this.parseTweetsFromInstructions(instructions);
      return this.withRateLimit({
        success: true,
        tweets: tweets.filter((t) => t.inReplyToStatusId === tweetId),
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getThread(tweetId: string): Promise<TweetsResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "TweetDetail",
        {
          focalTweetId: tweetId,
          with_rux_injections: false,
          rankingMode: "Relevance",
          includePromotedContent: true,
          withCommunity: true,
          withQuickPromoteEligibilityTweetFields: true,
          withBirdwatchNotes: true,
          withVoice: true,
        },
        TWEET_DETAIL_FEATURES,
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const instructions =
        json.data?.threaded_conversation_with_injections_v2?.instructions;
      const tweets = this.parseTweetsFromInstructions(instructions);
      const target = tweets.find((t) => t.id === tweetId);
      const rootId = target?.conversationId || tweetId;
      const thread = tweets.filter((t) => t.conversationId === rootId);
      thread.sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return aTime - bTime;
      });
      return this.withRateLimit({ success: true, tweets: thread });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async search(query: string, count = 20): Promise<TweetsResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "SearchTimeline",
        {
          rawQuery: query,
          count,
          querySource: "typed_query",
          product: "Latest",
        },
        TIMELINE_FEATURES,
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const instructions =
        json.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
      return this.withRateLimit({
        success: true,
        tweets: this.parseTweetsFromInstructions(instructions),
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getUserByScreenName(screenName: string): Promise<UserResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "UserByScreenName",
        { screen_name: screenName, withGrokTranslatedBio: true },
        USER_PROFILE_FEATURES,
        { withPayments: false, withAuxiliaryUserLabels: true },
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const mapped = this.mapUserFromGraphql(json.data?.user?.result);
      if (mapped) return this.withRateLimit({ success: true, user: mapped });
      return this.withRateLimit({ success: false, error: "User not found" });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getUserTweets(userId: string, count = 20): Promise<TweetsResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "UserTweets",
        {
          userId,
          count,
          includePromotedContent: true,
          withQuickPromoteEligibilityTweetFields: true,
          withVoice: true,
        },
        TIMELINE_FEATURES,
        { withArticlePlainText: false },
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const instructions =
        json.data?.user?.result?.timeline_v2?.timeline?.instructions ??
        json.data?.user?.result?.timeline?.timeline?.instructions;
      return this.withRateLimit({
        success: true,
        tweets: this.parseTweetsFromInstructions(instructions),
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getFollowers(userId: string, count = 20): Promise<UsersResult> {
    return this.fetchUserTimeline("Followers", userId, count);
  }

  async getFollowing(userId: string, count = 20): Promise<UsersResult> {
    return this.fetchUserTimeline("Following", userId, count);
  }

  async getBlueVerifiedFollowers(
    userId: string,
    count = 20,
  ): Promise<UsersResult> {
    return this.fetchUserTimeline("BlueVerifiedFollowers", userId, count);
  }

  private async fetchUserTimeline(
    op: "Followers" | "Following" | "BlueVerifiedFollowers",
    userId: string,
    count: number,
  ): Promise<UsersResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        op,
        {
          userId,
          count,
          includePromotedContent: false,
          withGrokTranslatedBio: true,
        },
        TIMELINE_FEATURES,
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const instructions =
        json.data?.user?.result?.timeline?.timeline?.instructions;
      return this.withRateLimit({
        success: true,
        users: this.parseUsersFromInstructions(instructions),
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getHomeTimeline(count = 20): Promise<TweetsResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "HomeTimeline",
        {
          count,
          includePromotedContent: true,
          requestContext: "launch",
          withCommunity: true,
        },
        TIMELINE_FEATURES,
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const instructions = json.data?.home?.home_timeline_urt?.instructions;
      return this.withRateLimit({
        success: true,
        tweets: this.parseTweetsFromInstructions(instructions),
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getUsersByIds(userIds: string[]): Promise<UsersResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "UsersByRestIds",
        { userIds },
        BASIC_FEATURES,
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const users: UserData[] = [];
      for (const entry of json.data?.users ?? []) {
        const mapped = this.mapUserFromGraphql(entry?.result);
        if (mapped) users.push(mapped);
      }
      return this.withRateLimit({ success: true, users });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getCurrentUser(): Promise<CurrentUserResult> {
    const urls = [
      "https://x.com/i/api/account/settings.json",
      "https://api.twitter.com/1.1/account/settings.json",
      "https://x.com/i/api/account/verify_credentials.json?skip_status=true&include_entities=false",
      "https://api.twitter.com/1.1/account/verify_credentials.json?skip_status=true&include_entities=false",
    ];

    let lastError: string | undefined;

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: this.jsonHeaders(),
        });
        if (!res.ok) {
          lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
          continue;
        }

        // biome-ignore lint/suspicious/noExplicitAny: REST response shape varies
        let data: any;
        try {
          data = await res.json();
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          continue;
        }

        const username =
          typeof data?.screen_name === "string"
            ? data.screen_name
            : typeof data?.user?.screen_name === "string"
              ? data.user.screen_name
              : null;

        const name =
          typeof data?.name === "string"
            ? data.name
            : typeof data?.user?.name === "string"
              ? data.user.name
              : (username ?? "");

        const userId =
          typeof data?.user_id === "string"
            ? data.user_id
            : typeof data?.user_id_str === "string"
              ? data.user_id_str
              : typeof data?.user?.id_str === "string"
                ? data.user.id_str
                : typeof data?.user?.id === "string"
                  ? data.user.id
                  : null;

        if (username && userId) {
          return this.withRateLimit({
            success: true,
            user: { id: userId, username, name: name || username },
          });
        }
        lastError = "Could not determine current user from response";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    const pages = [
      "https://x.com/settings/account",
      "https://twitter.com/settings/account",
    ];
    for (const page of pages) {
      try {
        const res = await fetch(page, {
          headers: {
            cookie: `auth_token=${this.authToken}; ct0=${this.ct0}`,
            "user-agent": this.userAgent,
          },
        });
        if (!res.ok) {
          lastError = `HTTP ${res.status} (settings page)`;
          continue;
        }

        const html = await res.text();
        const usernameMatch = html.match(/"screen_name":"([^"]+)"/);
        const idMatch = html.match(/"user_id"\s*:\s*"(\d+)"/);
        const nameMatch = html.match(/"name":"([^"\\]*(?:\\.[^"\\]*)*)"/);

        const username = usernameMatch?.[1];
        const userId = idMatch?.[1];
        const name = nameMatch?.[1]?.replace(/\\"/g, '"');

        if (username && userId) {
          return this.withRateLimit({
            success: true,
            user: { id: userId, username, name: name || username },
          });
        }
        lastError = "Could not parse settings page for user info";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return this.withRateLimit({
      success: false,
      error: lastError ?? "Unknown error fetching current user",
    });
  }

  // ── List operations ──

  async createList(
    name: string,
    description = "",
    isPrivate = false,
  ): Promise<ListResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlPost<any>(
        "CreateList",
        { name, description, isPrivate },
        BASIC_FEATURES,
      );
      const mapped = this.mapListFromGraphql(json.data?.list);
      if (mapped) return this.withRateLimit({ success: true, list: mapped });
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      return this.withRateLimit({
        success: false,
        error: "List created but could not parse response",
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async addListMember(listId: string, userId: string): Promise<ListResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlPost<any>(
        "ListAddMember",
        { listId, userId },
        BASIC_FEATURES,
      );
      const mapped = this.mapListFromGraphql(json.data?.list);
      if (mapped) return this.withRateLimit({ success: true, list: mapped });
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      return this.withRateLimit({
        success: false,
        error: "Member added but could not parse response",
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async removeListMember(listId: string, userId: string): Promise<ListResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlPost<any>(
        "ListRemoveMember",
        { listId, userId },
        BASIC_FEATURES,
      );

      const mapped = this.mapListFromGraphql(json.data?.list);
      if (mapped) return this.withRateLimit({ success: true, list: mapped });

      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });
      return this.withRateLimit({
        success: false,
        error: "Member removed but could not parse response",
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getList(listId: string): Promise<ListResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "ListByRestId",
        { listId },
        BASIC_FEATURES,
      );

      const mapped = this.mapListFromGraphql(json.data?.list);
      if (mapped) return this.withRateLimit({ success: true, list: mapped });

      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });
      return this.withRateLimit({ success: false, error: "List not found" });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getListTweets(listId: string, count = 20): Promise<TweetsResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "ListLatestTweetsTimeline",
        { listId, count },
        TIMELINE_FEATURES,
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const instructions =
        json.data?.list?.tweets_timeline?.timeline?.instructions;
      return this.withRateLimit({
        success: true,
        tweets: this.parseTweetsFromInstructions(instructions),
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getMyLists(count = 100): Promise<ListsResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "ListsManagementPageTimeline",
        { count },
        TIMELINE_FEATURES,
      );

      const instructions =
        json.data?.viewer?.list_management_timeline?.timeline?.instructions;
      if (instructions) {
        return this.withRateLimit({
          success: true,
          lists: this.parseListsFromInstructions(instructions),
        });
      }

      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });
      return this.withRateLimit({ success: true, lists: [] });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getListMemberships(userId: string, count = 20): Promise<ListsResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "ListMemberships",
        { userId, count },
        TIMELINE_FEATURES,
      );

      const instructions =
        json.data?.user?.result?.timeline?.timeline?.instructions;
      if (instructions) {
        return this.withRateLimit({
          success: true,
          lists: this.parseListsFromInstructions(instructions),
        });
      }

      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });
      return this.withRateLimit({ success: true, lists: [] });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getCombinedLists(userId: string, count = 100): Promise<ListsResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "CombinedLists",
        { userId, count },
        TIMELINE_FEATURES,
      );

      const instructions =
        json.data?.user?.result?.timeline?.timeline?.instructions;
      if (instructions) {
        return this.withRateLimit({
          success: true,
          lists: this.parseListsFromInstructions(instructions),
        });
      }

      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });
      return this.withRateLimit({ success: true, lists: [] });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── Grok operations ──

  private grokHeaders(): Record<string, string> {
    return {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      authorization:
        "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
      "content-type": "text/plain;charset=UTF-8",
      priority: "u=1, i",
      "sec-ch-ua": '"Brave";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      "x-client-transaction-id":
        "pQTHXvF33RlQ7QVFoOF2XB4dmu1gw3lvPjQuJWHEll65pt2MqC16193W9SjhX1MA4ikEUKBN5/uc44rJifFurcDquq3Epg",
      "x-csrf-token":
        "e8f8d522f632053f15f1308805dcac071662c7d38dfcf64c19087725ad186da48a728249bcc7205a96922b86c6de6c3b6784b3c2bbcb55b3c0f7a77e7c09bbb2b60335d40274c16c8a290ad6b3d7dd9b",
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
      "x-xai-request-id": "6121978b-5cea-441a-b176-46e240515137",
      cookie: `auth_token=${this.authToken}; ct0=${this.ct0};`,
      "user-agent": this.userAgent,
      Referer: "https://x.com/",
    };
  }

  private async resolveUserId(): Promise<string> {
    if (this.cachedUserId) return this.cachedUserId;
    const result = await this.getCurrentUser();
    if (!result.success || !result.user?.id) {
      throw new Error(result.error ?? "Failed to resolve current user ID");
    }
    this.cachedUserId = result.user.id;
    return this.cachedUserId;
  }

  async createGrokConversation(): Promise<GrokConversationResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlPost<any>("CreateGrokConversation", {});
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const conversationId =
        json.data?.create_grok_conversation?.conversation_id;
      if (conversationId)
        return this.withRateLimit({ success: true, conversationId });
      return this.withRateLimit({
        success: false,
        error: "No conversation ID returned",
      });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // deleteGrokConversation is not implemented because it is not supported by the API
  async deleteGrokConversation(
    conversationId: string,
  ): Promise<DeleteGrokConversationResult> {
    const body = {
      variables: {
        conversationId,
      },
      queryId: "TlKHSWVMVeaa-i7dqQqFQA",
    };
    const res = await fetch(
      "https://x.com/i/api/graphql/TlKHSWVMVeaa-i7dqQqFQA/ConversationItem_DeleteConversationMutation",
      {
        headers: this.grokHeaders(),
        body: JSON.stringify(body),
        method: "POST",
      },
    );
    const json = await res.json();

    if (!json?.data?.delete_grok_conversation) {
      return {
        success: false,
        error: "Failed to delete conversation",
      };
    }
    return {
      success: true,
    };
  }

  async sendGrokMessage(
    request: GrokSendMessageRequest,
  ): Promise<GrokMessageResult> {
    const {
      model = "grok-3-latest",
      modelMode = "MODEL_MODE_FAST",
      imageGeneration = false,
      imageGenerationCount = 4,
      isTemporaryChat = false,
    } = request.options || {};

    let { message, conversationId } = request;

    if (!conversationId) {
      const conv = await this.createGrokConversation();
      if (!conv.success || !conv.conversationId) {
        return {
          success: false,
          error: conv.error ?? "Failed to create conversation",
        };
      }
      conversationId = conv.conversationId;
    }

    const responses: Array<Record<string, unknown>> = [];

    const history = await this.getGrokConversation(conversationId);
    if (history.success && history.messages?.length) {
      for (const msg of history.messages) {
        responses.push({
          message: msg.message,
          sender: msg.senderType === "User" ? 1 : 2,
          responseId: msg.chatItemId,
          fileAttachments: [],
        });
      }
    }

    responses.push({
      message,
      sender: 1,
      promptSource: "",
      fileAttachments: [],
    });

    const headers = this.grokHeaders();

    const body = {
      responses,
      systemPromptName: "",
      grokModelOptionId: model,
      modelMode,
      conversationId,
      returnSearchResults: true,
      returnCitations: true,
      promptMetadata: { promptSource: "NATURAL", action: "INPUT" },
      imageGenerationCount,
      requestFeatures: { eagerTweets: true, serverHistory: true },
      enableSideBySide: true,
      toolOverrides: imageGeneration ? { imageGen: true } : {},
      modelConfigOverride: {},
      isTemporaryChat,
    };

    try {
      const res = await fetch("https://grok.x.com/2/grok/add_response.json", {
        headers: headers,
        body: JSON.stringify(body),
        method: "POST",
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          conversationId,
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }

      const text = await res.text();
      const lines = text.split("\n").filter((l) => l.trim());

      let finalMessage = "";
      let responseId: string | undefined;

      for (const line of lines) {
        try {
          // biome-ignore lint/suspicious/noExplicitAny: Grok streaming response shape varies
          const parsed: any = JSON.parse(line);

          if (parsed?.agentChatItemId) {
            responseId = parsed.agentChatItemId;
          }

          const result = parsed?.result;
          if (result?.responseType === "limiter"){
            return {
              success: false,
              conversationId,
              error: "Rate limit exceeded. You've reached your limit of 20 Grok questions per 24 hours for now",
            };
          }
          if (result?.message && result?.messageTag === "final") {
            finalMessage += result.message;
          }
          if (result?.responseChatItemId) {
            responseId = result.responseChatItemId;
          }
        } catch {
          // skip non-JSON lines
        }
      }

      
      if (finalMessage)
        return {
          success: true,
          conversationId,
          message: finalMessage,
          responseId,
        };
      return {
        success: false,
        conversationId,
        error: "No response message received",
      };
    } catch (error) {
      return {
        success: false,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getGrokHistory(): Promise<GrokHistoryResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>("GrokHistory", {});
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      // biome-ignore lint/suspicious/noExplicitAny: Grok history response shape
      const items: any[] = json.data?.grok_conversation_history?.items ?? [];
      const conversations: GrokHistoryItem[] = items.map((item) => ({
        conversationId: item.grokConversation?.rest_id ?? "",
        title: item.title ?? "",
        createdAtMs: item.created_at_ms ?? 0,
        isPinned: item.is_pinned ?? false,
      }));

      return this.withRateLimit({ success: true, conversations });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getGrokConversation(
    conversationId: string,
  ): Promise<GrokConversationItemsResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Twitter GraphQL response
      const json = await this.graphqlGet<any>(
        "GrokConversationItemsByRestId",
        { restId: conversationId },
        TIMELINE_FEATURES,
      );
      const err = this.extractErrors(json.errors);
      if (err) return this.withRateLimit({ success: false, error: err });

      const isPinned =
        json.data?.grok_conversation_by_rest_id?.is_pinned ?? false;
      const itemsData = json.data?.grok_conversation_items_by_rest_id;
      const cursor: string | undefined = itemsData?.cursor;
      // biome-ignore lint/suspicious/noExplicitAny: Grok conversation items shape
      const rawItems: any[] = itemsData?.items ?? [];

      const messages: GrokMessageData[] = rawItems.map((item) => ({
        chatItemId: item.chat_item_id ?? "",
        message: item.message ?? "",
        senderType:
          item.sender_type === "Agent" ? ("Agent" as const) : ("User" as const),
        createdAtMs: item.created_at_ms ?? 0,
        grokMode: item.grok_mode,
        thinkingTrace: item.thinking_trace,
        isPartial: item.is_partial,
      }));

      messages.sort((a, b) => a.createdAtMs - b.createdAtMs);

      return this.withRateLimit({ success: true, messages, cursor, isPinned });
    } catch (error) {
      return this.withRateLimit({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
