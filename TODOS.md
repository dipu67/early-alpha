# TODOS

## Done (Wave 1)

### Daily Digest Catch-Up — DONE
- Markers `digest.daily.lastSentAt` / `digest.early.lastSentAt` on successful send.
- `catchUpMissedDigests()` on API boot (baseline on first run; resend only if a slot was missed after a prior send).
- Seeds API + admin UI; Overview metrics on Seed/FollowEdge/Alert; Watchlist marked legacy.

### Data Retention Policy — DONE
- Added `prune_follow_edges()` SQL function (migration `20260818120000`).
- CLI: `npm run db:prune-edges [days]` — deletes inactive `follow_edges` older than N days.
- Default: 90 days. Overridable via `PRUNE_FOLLOW_EDGE_STALE_DAYS` env var or CLI arg.

### Hunter Auto-Promote — DONE
- Setting `huntStage = "taken"` now auto-invalidates tag lexicon and enqueues `reconcile-lists`.
- Optional `TAKEN_AUTH_ACCOUNT_ID` env var records an `AuthFollow` row so the take is tracked in signal scans.

### WatchList Deprecation — DONE
- Removed WatchList / FollowSnapshot / AlertLog models, follow-tracker worker, admin UI.
- Bot `/watch` → `/seed` (aliases kept).
