-- Project monitor: tweetCount prefilter, username-change tracking, tag rules.
-- twitter_user_id becomes the stable unique key (usernames change on X).

-- Drop username unique if present
DROP INDEX IF EXISTS "project_monitors_username_key";
ALTER TABLE "project_monitors" DROP CONSTRAINT IF EXISTS "project_monitors_username_key";

-- New columns
ALTER TABLE "project_monitors" ADD COLUMN IF NOT EXISTS "interval_sec" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "project_monitors" ADD COLUMN IF NOT EXISTS "last_tweet_count" INTEGER;
ALTER TABLE "project_monitors" ADD COLUMN IF NOT EXISTS "previous_username" TEXT;
ALTER TABLE "project_monitors" ADD COLUMN IF NOT EXISTS "username_changed_at" TIMESTAMPTZ;

-- Unique on stable rest id (dedupe first if needed)
CREATE UNIQUE INDEX IF NOT EXISTS "project_monitors_twitter_user_id_key"
  ON "project_monitors" ("twitter_user_id");

CREATE INDEX IF NOT EXISTS "project_monitors_username_idx"
  ON "project_monitors" ("username");

CREATE INDEX IF NOT EXISTS "project_monitors_primary_tag_is_active_idx"
  ON "project_monitors" ("primary_tag", "is_active");

-- Tag enrollment rules
CREATE TABLE IF NOT EXISTS "project_monitor_tag_rules" (
  "id" BIGSERIAL NOT NULL,
  "tag_slug" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "interval_sec" INTEGER NOT NULL DEFAULT 3600,
  "topic_id" INTEGER,
  "alert_mode" TEXT NOT NULL DEFAULT 'all',
  "alert_enabled" BOOLEAN NOT NULL DEFAULT true,
  "max_projects" INTEGER NOT NULL DEFAULT 1000,
  "last_enroll_at" TIMESTAMPTZ,
  "last_run_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_monitor_tag_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_monitor_tag_rules_tag_slug_key"
  ON "project_monitor_tag_rules" ("tag_slug");
