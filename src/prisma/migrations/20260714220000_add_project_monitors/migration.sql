-- Live tweet monitors for high-potential project accounts
CREATE TABLE "project_monitors" (
    "id" BIGSERIAL NOT NULL,
    "twitter_user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "primary_tag" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "alert_mode" TEXT NOT NULL DEFAULT 'all',
    "alert_enabled" BOOLEAN NOT NULL DEFAULT true,
    "topic_id" INTEGER,
    "last_tweet_id" TEXT,
    "last_polled_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "alert_count" INTEGER NOT NULL DEFAULT 0,
    "heat_at_enroll" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_monitors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_monitors_username_key" ON "project_monitors"("username");
CREATE INDEX "project_monitors_is_active_last_polled_at_idx" ON "project_monitors"("is_active", "last_polled_at");
CREATE INDEX "project_monitors_twitter_user_id_idx" ON "project_monitors"("twitter_user_id");
