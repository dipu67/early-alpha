/** Primary GraphQL host (most ops). Some ops (e.g. UsersByRestIds) are CF-blocked here. */
const GRAPHQL_BASE = "https://x.com/i/api/graphql";
/**
 * Alternate GraphQL host used by the web client for several queries.
 * Transaction path is `/graphql/{queryId}/{op}` (see x-client-transaction-id docs).
 */
const GRAPHQL_API_X = "https://api.x.com/graphql";
const REST_BASE = "https://x.com/i/api/1.1";
const BEARER_TOKEN =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export class TwitterProxyClient {
  constructor() {}
}
