-- Per-tag HomeLatest signal scanners
CREATE TABLE "signal_scans" (
    "id" BIGSERIAL NOT NULL,
    "tag_slug" TEXT NOT NULL,
    "auth_account_id" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_follow" BOOLEAN NOT NULL DEFAULT false,
    "alert_enabled" BOOLEAN NOT NULL DEFAULT true,
    "topic_id" INTEGER,
    "interval_sec" INTEGER NOT NULL DEFAULT 120,
    "last_tweet_id" TEXT,
    "last_polled_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_scans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signal_scans_tag_slug_key" ON "signal_scans"("tag_slug");
CREATE INDEX "signal_scans_enabled_last_polled_at_idx" ON "signal_scans"("enabled", "last_polled_at");

ALTER TABLE "signal_scans" ADD CONSTRAINT "signal_scans_auth_account_id_fkey"
  FOREIGN KEY ("auth_account_id") REFERENCES "twitter_auth_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Editable signal rules
CREATE TABLE "signal_rules" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "label" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "is_regex" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signal_rules_slug_enabled_idx" ON "signal_rules"("slug", "enabled");
CREATE INDEX "signal_rules_enabled_idx" ON "signal_rules"("enabled");

-- Auth follows (manual / auto)
CREATE TABLE "auth_follows" (
    "id" BIGSERIAL NOT NULL,
    "auth_account_id" BIGINT NOT NULL,
    "twitter_user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "tag_slug" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_follows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_follows_auth_account_id_twitter_user_id_key"
  ON "auth_follows"("auth_account_id", "twitter_user_id");
CREATE INDEX "auth_follows_tag_slug_idx" ON "auth_follows"("tag_slug");
CREATE INDEX "auth_follows_username_idx" ON "auth_follows"("username");

ALTER TABLE "auth_follows" ADD CONSTRAINT "auth_follows_auth_account_id_fkey"
  FOREIGN KEY ("auth_account_id") REFERENCES "twitter_auth_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
