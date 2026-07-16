-- CreateTable
CREATE TABLE "github_repo_monitors" (
    "id" BIGSERIAL NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "alert_enabled" BOOLEAN NOT NULL DEFAULT true,
    "topic_id" INTEGER,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "path_filter" TEXT,
    "interval_sec" INTEGER NOT NULL DEFAULT 300,
    "last_polled_at" TIMESTAMPTZ,
    "last_commit_sha" TEXT,
    "last_error" TEXT,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_repo_monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_repo_commits" (
    "id" BIGSERIAL NOT NULL,
    "monitor_id" BIGINT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "author_name" TEXT,
    "author_login" TEXT,
    "html_url" TEXT NOT NULL,
    "committed_at" TIMESTAMPTZ,
    "files_added" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "files_modified" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "files_removed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alerted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_repo_commits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_repo_monitors_full_name_key" ON "github_repo_monitors"("full_name");

-- CreateIndex
CREATE INDEX "github_repo_monitors_enabled_last_polled_at_idx" ON "github_repo_monitors"("enabled", "last_polled_at");

-- CreateIndex
CREATE INDEX "github_repo_commits_created_at_idx" ON "github_repo_commits"("created_at" DESC);

-- CreateIndex
CREATE INDEX "github_repo_commits_monitor_id_created_at_idx" ON "github_repo_commits"("monitor_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "github_repo_commits_monitor_id_sha_key" ON "github_repo_commits"("monitor_id", "sha");

-- AddForeignKey
ALTER TABLE "github_repo_commits" ADD CONSTRAINT "github_repo_commits_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "github_repo_monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
