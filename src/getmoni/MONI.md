---
GetMoni Extension — Extracted Tools

Base URLs

- API v1: https://api.moni.ai/api/v1/
- API v2: https://api.moni.ai/api/v2/ (unused in this file but configured)
- WebSocket: wss://api-events.moni.ai/api/v1/events/
- Test variants: api.test.moni.ai / wss://api-events.test.moni.ai

---
API Endpoints (REST)

Auth & Account

┌────────┬────────────────────────────────┬─────────────────────────┐
│ Method │            Endpoint            │         Purpose         │
├────────┼────────────────────────────────┼─────────────────────────┤
│ POST   │ auth/token/                    │ Get auth token          │
├────────┼────────────────────────────────┼─────────────────────────┤
│ POST   │ auth/bind/                     │ Bind auth               │
├────────┼────────────────────────────────┼─────────────────────────┤
│ POST   │ auth/turnkey/                  │ Turnkey auth            │
├────────┼────────────────────────────────┼─────────────────────────┤
│ POST   │ auth/refresh/                  │ Refresh token           │
├────────┼────────────────────────────────┼─────────────────────────┤
│ GET    │ account/                       │ Get account info        │
├────────┼────────────────────────────────┼─────────────────────────┤
│ PATCH  │ account/                       │ Update account          │
├────────┼────────────────────────────────┼─────────────────────────┤
│ GET    │ account/limits/slots/          │ Get account slot limits │
├────────┼────────────────────────────────┼─────────────────────────┤
│ GET    │ account/auth/google/           │ Google auth URL         │
├────────┼────────────────────────────────┼─────────────────────────┤
│ GET    │ account/auth/google/callback/  │ Google auth callback    │
├────────┼────────────────────────────────┼─────────────────────────┤
│ GET    │ account/auth/twitter/          │ Twitter auth URL        │
├────────┼────────────────────────────────┼─────────────────────────┤
│ GET    │ account/auth/twitter/callback/ │ Twitter auth callback   │
├────────┼────────────────────────────────┼─────────────────────────┤
│ DELETE │ account/auth/twitter/          │ Disconnect Twitter      │
├────────┼────────────────────────────────┼─────────────────────────┤
│ PATCH  │ account/settings/              │ Update user settings    │
└────────┴────────────────────────────────┴─────────────────────────┘

Trading / Printer

┌────────┬────────────────────────────────────────────────┬───────────────────────────┐
│ Method │                    Endpoint                    │          Purpose          │
├────────┼────────────────────────────────────────────────┼───────────────────────────┤
│ GET    │ chain/_/wallet/                                │ Get user wallets          │
├────────┼────────────────────────────────────────────────┼───────────────────────────┤
│ PATCH  │ chain/_/wallet/{walletId}/                     │ Update wallet             │
├────────┼────────────────────────────────────────────────┼───────────────────────────┤
│ POST   │ chain/{chainId}/wallet/{walletId}/transaction/ │ Submit transaction        │
├────────┼────────────────────────────────────────────────┼───────────────────────────┤
│ GET    │ account/transaction/history/                   │ Transaction history       │
├────────┼────────────────────────────────────────────────┼───────────────────────────┤
│ GET    │ account/settings/trade/quick_buy/              │ Get quick buy settings    │
├────────┼────────────────────────────────────────────────┼───────────────────────────┤
│ PUT    │ account/settings/trade/quick_buy/              │ Update quick buy settings │
├────────┼────────────────────────────────────────────────┼───────────────────────────┤
│ GET    │ account/settings/trade/presets/                │ Get trading presets       │
├────────┼────────────────────────────────────────────────┼───────────────────────────┤
│ PATCH  │ account/settings/trade/presets/{id}/           │ Update trading preset     │
├────────┼────────────────────────────────────────────────┼───────────────────────────┤
│ GET    │ token/swap/quote/                              │ Get swap quote            │
├────────┼────────────────────────────────────────────────┼───────────────────────────┤
│ GET    │ fee/stats/                                     │ Get fee stats             │
└────────┴────────────────────────────────────────────────┴───────────────────────────┘

Social / Observing

┌────────┬──────────────────────────────────────────┬────────────────────────────┐
│ Method │                 Endpoint                 │          Purpose           │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/                                │ Get observed accounts      │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/resolve/{slug}/                 │ Resolve observed account   │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/{slugId}/offer/type/            │ Get suggestion types       │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/smart_followers/                │ Get smart followers        │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/smart_followers/tag_categories/ │ Smart follower tags        │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/smart_followers/filters/        │ Smart follower filters     │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/timeline/                       │ Get timeline               │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/linked_wallet/                  │ Get linked wallets         │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/mentioned_tokens/               │ Get mentioned tokens       │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/mentioned_tokens/chains/        │ Mentioned token chains     │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/mentioned_wallets/              │ Get mentioned wallets      │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/holders/                        │ Get holders                │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/holders/tag_categories/         │ Holder tag categories      │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/holders/filters/                │ Holder filters             │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ observed/smart_mentions/filters/         │ Smart mention filters      │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ POST   │ observed/followers/offer/                │ Submit follower suggestion │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ POST   │ projects/offer/                          │ Submit project suggestion  │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ POST   │ projects/offer/scam/                     │ Report scam                │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ DELETE │ projects/offer/scam/                     │ Remove scam report         │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ POST   │ projects/offer/scam/raw_get/             │ Batch check scams          │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ POST   │ projects/offer/scam/raw/                 │ Report scam (raw)          │
├────────┼──────────────────────────────────────────┼────────────────────────────┤
│ GET    │ {userId}/tweets/{id}/                    │ Get tweet data             │
└────────┴──────────────────────────────────────────┴────────────────────────────┘

Other

┌────────┬─────────────────────────┬─────────────────────────────┐
│ Method │        Endpoint         │           Purpose           │
├────────┼─────────────────────────┼─────────────────────────────┤
│ GET    │ banners/                │ Get banners                 │
├────────┼─────────────────────────┼─────────────────────────────┤
│ POST   │ referral/bind-referral/ │ Bind referral code          │
├────────┼─────────────────────────┼─────────────────────────────┤
│ POST   │ image/pnl/position/     │ Generate PnL position image │
└────────┴─────────────────────────┴─────────────────────────────┘

Tags

┌────────┬──────────────────────┬───────────────┐
│ Method │       Endpoint       │    Purpose    │
├────────┼──────────────────────┼───────────────┤
│ GET    │ account/tags/        │ Get user tags │
├────────┼──────────────────────┼───────────────┤
│ POST   │ account/tags/        │ Create tag    │
├────────┼──────────────────────┼───────────────┤
│ DELETE │ account/tags/{id}/   │ Delete tag    │
├────────┼──────────────────────┼───────────────┤
│ GET    │ account/tags/lookup/ │ Lookup tags   │
└────────┴──────────────────────┴───────────────┘

---
Message Actions (chrome.runtime.onMessage)

These are the internal message types the extension handles between popup/sidepanel/content script/background:

Auth Flow: PrinterAuthSuccess, PrinterLogout, PrinterUserSkipped, PrinterPrivateAccessGranted, PrinterPrivateAccessDenied, RefreshToken, RefreshTokenSuccess

Twitter Integration: TwitterAccountConnected, TwitterAccountConnectFailed

Trading Panel: OpenTradingPanelRequest/Response, ToggleTradingPanelRequest/Response, CloseTradingPanelRequest/Response, TradingPanelSell, QuickBuy, QuickBuyUpdated, SelectWalletRequest

Trading Presets: GetTradingPresetsRequest/Response, ApplyTradePresetRequest/Response, UpdateTradePresetRequest/Response

Auto Fee: SubscribeToBuyAutoFee, UpdateBuyAutoFee, UnsubscribeFromBuyAutoFee, SubscribeToSellAutoFee, UpdateSellAutoFee, UnsubscribeFromSellAutoFee, AutoFeeStreamFromBackground

Quick Buy Integrations: ToggleAxiomQuickBuyRequest/Response, TogglePadreQuickBuyRequest/Response, ToggleGmgnQuickBuyRequest/Response

Social Data: GetSocialData, GetSmartsRequest, GetSmartsTagsRequest, GetSmartHandlersRequest, GetSmartHandlersTagsRequest, GetBioChange, GetLinkedWallets, GetMentionedTokens, GetMentionedTokenChains, GetMentionedWallets, GetSmartsFilters, GetSmartHoldersFilters, GetSmartMentionsFilters, GetTweet

Scam Detection: CheckScamRequest/Response, ReportScam/Response, CheckProjectRequest/Response

Suggestions: SubmitSuggestionRequest/Response, GetSuggestionsRequest/Response

Wallet: GetUserWalletsRequest/Response

Tags: CreateUserTag, SearchUserTags, GetUserTags, GetUserTagsBy

Swap: GetSwapQuote, GetTransactionRoutePreview

Transaction: StartPrinterTxStatusP

---
Chrome APIs Used

- chrome.storage.local / chrome.storage.session — persistent & session state
- chrome.runtime.onMessage — inter-component messaging
- chrome.tabs — tab queries and messaging
- chrome.sidePanel — side panel management
- chrome.action — popup/icon control
- chrome.identity.launchWebAuthFlow — OAuth flows
- chrome.webNavigation.onHistoryStateUpdated — SPA route tracking
- chrome.windows.create — window management

That's the complete set of 80+ message actions, 40+ API endpoints, and the WebSocket event system from the GetMoni background.js.