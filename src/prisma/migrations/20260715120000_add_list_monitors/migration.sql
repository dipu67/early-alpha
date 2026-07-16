-- Public Twitter list monitors (any list id) + recent hits for admin feed.

CREATE TABLE "list_monitors" (
    "id" BIGSERIAL NOT NULL,
    "twitter_list_id" TEXT NOT NULL,
    "label" TEXT,
    "list_name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auth_account_id" BIGINT,
    "topic_id" INTEGER,
    "alert_enabled" BOOLEAN NOT NULL DEFAULT true,
    "interval_sec" INTEGER NOT NULL DEFAULT 120,
    "last_polled_at" TIMESTAMPTZ,
    "last_tweet_id" TEXT,
    "last_error" TEXT,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "list_monitors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "list_monitors_twitter_list_id_key" ON "list_monitors"("twitter_list_id");
CREATE INDEX "list_monitors_enabled_last_polled_at_idx" ON "list_monitors"("enabled", "last_polled_at");

ALTER TABLE "list_monitors"
  ADD CONSTRAINT "list_monitors_auth_account_id_fkey"
  FOREIGN KEY ("auth_account_id") REFERENCES "twitter_auth_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "list_monitor_hits" (
    "id" BIGSERIAL NOT NULL,
    "monitor_id" BIGINT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "author_id" TEXT,
    "posted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "list_monitor_hits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "list_monitor_hits_monitor_id_tweet_id_key"
  ON "list_monitor_hits"("monitor_id", "tweet_id");
CREATE INDEX "list_monitor_hits_created_at_idx"
  ON "list_monitor_hits"("created_at" DESC);
CREATE INDEX "list_monitor_hits_monitor_id_created_at_idx"
  ON "list_monitor_hits"("monitor_id", "created_at" DESC);

ALTER TABLE "list_monitor_hits"
  ADD CONSTRAINT "list_monitor_hits_monitor_id_fkey"
  FOREIGN KEY ("monitor_id") REFERENCES "list_monitors"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
