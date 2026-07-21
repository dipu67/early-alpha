-- Early-project profile poller: watermarks + follower growth history

ALTER TABLE "twitter_accounts" ADD COLUMN IF NOT EXISTS "last_profile_polled_at" TIMESTAMPTZ;
ALTER TABLE "twitter_accounts" ADD COLUMN IF NOT EXISTS "last_tweet_id" TEXT;
ALTER TABLE "twitter_accounts" ADD COLUMN IF NOT EXISTS "previous_username" TEXT;
ALTER TABLE "twitter_accounts" ADD COLUMN IF NOT EXISTS "username_changed_at" TIMESTAMPTZ;
ALTER TABLE "twitter_accounts" ADD COLUMN IF NOT EXISTS "followers_at_detect" INTEGER;

CREATE INDEX IF NOT EXISTS "twitter_accounts_last_profile_polled_at_idx"
  ON "twitter_accounts"("last_profile_polled_at");

-- Backfill baseline followers for growth reports
UPDATE "twitter_accounts"
SET "followers_at_detect" = "followers_count"
WHERE "followers_at_detect" IS NULL AND "followers_count" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "account_metric_snapshots" (
  "id" BIGSERIAL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "followers_count" INTEGER,
  "following_count" INTEGER,
  "tweet_count" INTEGER,
  "source" TEXT NOT NULL DEFAULT 'poll',
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_metric_snapshots_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "twitter_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "account_metric_snapshots_account_id_recorded_at_idx"
  ON "account_metric_snapshots"("account_id", "recorded_at" DESC);

CREATE INDEX IF NOT EXISTS "account_metric_snapshots_recorded_at_idx"
  ON "account_metric_snapshots"("recorded_at" DESC);
