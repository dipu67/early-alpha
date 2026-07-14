-- PostAlert feed: efficient prune/list of latest N per tag slug
CREATE INDEX IF NOT EXISTS "post_alerts_slug_created_at_idx" ON "post_alerts" ("slug", "created_at" DESC);
