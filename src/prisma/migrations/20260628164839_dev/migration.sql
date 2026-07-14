-- CreateTable
CREATE TABLE "twitter_accounts" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "followers_count" INTEGER,
    "following_count" INTEGER,
    "is_blue_verified" BOOLEAN,
    "profile_image_url" TEXT,
    "created_at" TIMESTAMPTZ,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "twitter_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seed_accounts" (
    "id" BIGSERIAL NOT NULL,
    "twitter_id" TEXT,
    "username" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seed_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_runs" (
    "id" BIGSERIAL NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "seeds_processed" INTEGER NOT NULL DEFAULT 0,
    "accounts_seen" INTEGER NOT NULL DEFAULT 0,
    "new_follow_edges" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tracking_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_edges" (
    "seed_id" BIGINT NOT NULL,
    "following_id" TEXT NOT NULL,
    "first_seen_run_id" BIGINT,
    "last_seen_run_id" BIGINT,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "follow_edges_pkey" PRIMARY KEY ("seed_id","following_id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" BIGSERIAL NOT NULL,
    "following_id" TEXT NOT NULL,
    "run_id" BIGINT,
    "alert_type" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "seed_count" INTEGER NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seed_usernames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twitter_auth_accounts" (
    "id" BIGINT NOT NULL,
    "username" TEXT NOT NULL,
    "auth_token" TEXT NOT NULL,
    "ct0" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "rate_limited_until" TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "twitter_auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_list" (
    "id" BIGSERIAL NOT NULL,
    "twitter_user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "added_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "watch_list_id" BIGINT NOT NULL,
    "user_ids" TEXT[],
    "taken_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_logs" (
    "id" BIGSERIAL NOT NULL,
    "watch_list_id" BIGINT NOT NULL,
    "new_follow_id" TEXT NOT NULL,
    "new_follow_username" TEXT,
    "analysis" TEXT,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "twitter_accounts_username_key" ON "twitter_accounts"("username");

-- CreateIndex
CREATE UNIQUE INDEX "seed_accounts_twitter_id_key" ON "seed_accounts"("twitter_id");

-- CreateIndex
CREATE UNIQUE INDEX "seed_accounts_username_key" ON "seed_accounts"("username");

-- CreateIndex
CREATE INDEX "follow_edges_following_id_first_seen_at_idx" ON "follow_edges"("following_id", "first_seen_at" DESC);

-- CreateIndex
CREATE INDEX "follow_edges_following_id_idx" ON "follow_edges"("following_id");

-- CreateIndex
CREATE INDEX "follow_edges_active_idx" ON "follow_edges"("active");

-- CreateIndex
CREATE INDEX "alerts_following_id_alert_type_created_at_idx" ON "alerts"("following_id", "alert_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_score_idx" ON "alerts"("score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "twitter_auth_accounts_username_key" ON "twitter_auth_accounts"("username");

-- CreateIndex
CREATE UNIQUE INDEX "twitter_auth_accounts_auth_token_key" ON "twitter_auth_accounts"("auth_token");

-- CreateIndex
CREATE INDEX "twitter_auth_accounts_is_active_rate_limited_until_idx" ON "twitter_auth_accounts"("is_active", "rate_limited_until");

-- CreateIndex
CREATE UNIQUE INDEX "watch_list_username_key" ON "watch_list"("username");

-- CreateIndex
CREATE INDEX "follow_snapshots_watch_list_id_taken_at_idx" ON "follow_snapshots"("watch_list_id", "taken_at" DESC);

-- CreateIndex
CREATE INDEX "alert_logs_watch_list_id_sent_at_idx" ON "alert_logs"("watch_list_id", "sent_at" DESC);

-- AddForeignKey
ALTER TABLE "follow_edges" ADD CONSTRAINT "follow_edges_seed_id_fkey" FOREIGN KEY ("seed_id") REFERENCES "seed_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_edges" ADD CONSTRAINT "follow_edges_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "twitter_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_edges" ADD CONSTRAINT "follow_edges_first_seen_run_id_fkey" FOREIGN KEY ("first_seen_run_id") REFERENCES "tracking_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_edges" ADD CONSTRAINT "follow_edges_last_seen_run_id_fkey" FOREIGN KEY ("last_seen_run_id") REFERENCES "tracking_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "twitter_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "tracking_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_snapshots" ADD CONSTRAINT "follow_snapshots_watch_list_id_fkey" FOREIGN KEY ("watch_list_id") REFERENCES "watch_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_logs" ADD CONSTRAINT "alert_logs_watch_list_id_fkey" FOREIGN KEY ("watch_list_id") REFERENCES "watch_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;
