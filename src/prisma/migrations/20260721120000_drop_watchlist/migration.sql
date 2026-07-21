-- Remove legacy WatchList stack (replaced by SeedAccount + FollowEdge).

DROP TABLE IF EXISTS "alert_logs";
DROP TABLE IF EXISTS "follow_snapshots";
DROP TABLE IF EXISTS "watch_list";
