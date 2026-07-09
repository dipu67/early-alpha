# GetMoni Client

A Node/TypeScript port of the tools embedded in the GetMoni browser extension's
`background.js`. It exposes the extension's REST surface (see `MONI.md` for the
full endpoint map) as a single typed `MoniClient` class, plus a helper to build
the events WebSocket URL.

Built with native `fetch` (no axios), matching the `TwitterClient` house style in
this repo.

## Quick start

```ts
import { MoniClient, MoniStatus, ObservedType } from "./getmoni/index.js";

const moni = new MoniClient({
  accessToken: process.env.MONI_ACCESS_TOKEN,
  refreshToken: process.env.MONI_REFRESH_TOKEN, // optional; enables auto-refresh
});

const res = await moni.getSmartFollowers({
  observedId: "5557856978",
  observedType: ObservedType.TwitterAccount,
  limit: 50,
});

if (res.status === MoniStatus.Success) {
  console.log(res.data);
} else {
  console.error("Moni error", res.status); // 401, 404, 500, …
}
```

## Result envelope

Every method returns a `MoniResult<T>` — the same `{ status, data? }` shape the
extension uses, keyed off the HTTP status code (`MoniStatus`):

- `status === MoniStatus.Success` (200) / `Created` (201) → `data` is present.
- Any other status (`Unauthorized`, `NotFound`, `NotDocumentedError`, …) → no data.
- 5xx, network errors, and parse failures collapse to `NotDocumentedError` (500),
  matching the extension's error mapper.

Nothing throws — branch on `status`.

## Auth & token refresh

- Pass `accessToken` to authenticate. Pass `refreshToken` to enable automatic
  refresh: the client refreshes proactively when the JWT is within 10s of expiry
  and retries once on a `401`.
- By default refresh calls `POST auth/refresh/`. Override with `onRefresh` if your
  app mints tokens elsewhere:

  ```ts
  new MoniClient({
    refreshToken,
    onRefresh: async (rt) => myAuthService.refresh(rt), // → { accessToken, refreshToken }
  });
  ```

- `getTokens()` mints a fresh pair (`POST auth/token/`); `setTokens({...})` updates
  stored credentials.

## Environments

```ts
new MoniClient({ test: true });          // api.test.moni.ai + wss://api-events.test.moni.ai
new MoniClient({ host: "my-proxy.dev" }); // custom host (overrides `test`)
```

## Method map

| Group | Methods |
|---|---|
| Auth/Account | `getTokens`, `bindAuth`, `turnkeyAuth`, `refreshToken`, `getAccount`, `updateAccount`, `getSlotLimits`, `updateSettings`, `getGoogleAuthUrl`, `getTwitterAuthUrl`, `disconnectTwitter` |
| Social/Observing | `resolveObserved`, `getObserved`, `getSmartFollowers`, `getSmartFollowerTags`, `getSmartFollowerFilters`, `getTimeline`, `getLinkedWallets`, `getMentionedTokens`, `getMentionedTokenChains`, `getMentionedWallets`, `getHolders`, `getHolderTags`, `getHolderFilters`, `getSmartMentionFilters`, `getSubmittedSuggestions`, `suggestSmartFollower`, `suggestProject`, `getTweet` |
| Scam | `reportScam`, `unreportScam`, `checkScams`, `reportScamRaw` |
| Tags | `getTags`, `createTag`, `deleteTag`, `lookupTags` |
| Trading/Wallets | `getWallets`, `updateWallet`, `postTransaction`, `getTransactionHistory`, `getQuickBuySettings`, `updateQuickBuySettings`, `getTradingPresets`, `updateTradingPreset`, `getSwapQuote`, `getFeeStats` |
| Other | `getBanners`, `bindReferral`, `generatePnlImage` |
| Events | `eventsUrl` (build the `wss://…/api/v1/events/` URL) |

## Events WebSocket

`eventsUrl` builds the subscribe URL; open it with your WS client of choice:

```ts
import WebSocket from "ws";
const ws = new WebSocket(moni.eventsUrl({ clientId, includeProcessingTxs: true }));
```

## Notes

- Array query params are serialized comma-style (`a=1,2,3`), matching the
  extension's `qs` config (`arrayFormat: "comma"`).
- Methods whose response we captured in `demo/res/` return concrete types by
  default: `getObserved`/`resolveObserved` → `ObservedAccount`, `getTimeline` →
  `TimelineResponse`, the `*Filters` methods → `FilterOption[]`, `checkScams` →
  `ScamCheckResponse`. These interfaces carry an index signature so new upstream
  fields won't break callers.
- Every other method returns `unknown` (upstream schema unpublished). Pass a type
  argument to narrow, e.g. `moni.getAccount<MyAccount>()`, or to override a
  default, e.g. `moni.getObserved<MyShape>({ ... })`.

