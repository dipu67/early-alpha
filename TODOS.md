# TODOS

## Done (Wave 1)

### Daily Digest Catch-Up — DONE
- Markers `digest.daily.lastSentAt` / `digest.early.lastSentAt` on successful send.
- `catchUpMissedDigests()` on API boot (baseline on first run; resend only if a slot was missed after a prior send).
- Seeds API + admin UI; Overview metrics on Seed/FollowEdge/Alert; Watchlist marked legacy.

## Post-Validation (after 2-week run)

### Bio Category Re-Evaluation
- **What:** Periodically re-fetch Twitter bios for tracked targets and re-evaluate category tags.
- **Why:** Bios change over time. A target tagged "DeFi" on first encounter could pivot to NFTs. One-shot tagging creates stale categories.
- **Depends on:** Category tagging (Step 4) built and working.
- **Context:** Weekly re-fetch is sufficient. Only re-evaluate targets that appeared in convergence alerts or the daily digest (not all 25K+ edges). Rate limit cost: ~50-100 extra API calls/week.

### Data Retention Policy
- **What:** Archive or soft-delete FollowEdges with `active: false` and `lastSeenAt` older than 90 days.
- **Why:** Unbounded FollowEdge growth. ~250 new rows/day = ~90K rows/year. Most are stale.
- **Context:** Acceptable for 2-week validation. Implement before scaling beyond 50 seeds.

### WatchList Deprecation — DONE
- Removed WatchList / FollowSnapshot / AlertLog models, follow-tracker worker, admin UI.
- Bot `/watch` → `/seed` (aliases kept).
