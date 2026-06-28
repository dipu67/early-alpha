# TODOS

## Post-Validation (after 2-week run)

### Daily Digest Catch-Up
- **What:** On process start, check if yesterday's digest was sent. If not, send it immediately.
- **Why:** Prevents silent digest loss during outages. Currently if the process is down at 09:00 UTC, that day's digest is silently skipped.
- **Depends on:** Daily digest (Step 5) built and working.
- **Context:** Query AlertLog or a new digest-sent marker for the last 24h. If missing, collect events from the missed window and send.

### Bio Category Re-Evaluation
- **What:** Periodically re-fetch Twitter bios for tracked targets and re-evaluate category tags.
- **Why:** Bios change over time. A target tagged "DeFi" on first encounter could pivot to NFTs. One-shot tagging creates stale categories.
- **Depends on:** Category tagging (Step 4) built and working.
- **Context:** Weekly re-fetch is sufficient. Only re-evaluate targets that appeared in convergence alerts or the daily digest (not all 25K+ edges). Rate limit cost: ~50-100 extra API calls/week.

### Data Retention Policy
- **What:** Archive or soft-delete FollowEdges with `active: false` and `lastSeenAt` older than 90 days.
- **Why:** Unbounded FollowEdge growth. ~250 new rows/day = ~90K rows/year. Most are stale.
- **Context:** Acceptable for 2-week validation. Implement before scaling beyond 50 seeds.

### WatchList Deprecation
- **What:** Migrate remaining WatchList users to SeedAccount system, then remove WatchList/FollowSnapshot/AlertLog models.
- **Why:** Two parallel data models is technical debt. SeedAccount/FollowEdge is the canonical system now.
- **Depends on:** 2-week validation confirms SeedAccount system works.
- **Context:** The /watch, /unwatch, /list bot commands currently operate on WatchList. They'd need to be updated or removed.
