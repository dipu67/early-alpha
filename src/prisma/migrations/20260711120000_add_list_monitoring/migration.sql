-- AlterTable
ALTER TABLE "twitter_accounts" ADD COLUMN "lists_synced_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "project_lists" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "twitter_list_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last_polled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "project_lists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_lists_slug_key" ON "project_lists"("slug");
CREATE UNIQUE INDEX "project_lists_twitter_list_id_key" ON "project_lists"("twitter_list_id");

-- CreateTable
CREATE TABLE "list_members" (
    "list_slug" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "list_members_pkey" PRIMARY KEY ("list_slug","account_id")
);

-- CreateIndex
CREATE INDEX "list_members_account_id_idx" ON "list_members"("account_id");

-- CreateTable
CREATE TABLE "post_alerts" (
    "tweet_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT NOT NULL,
    "posted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "post_alerts_pkey" PRIMARY KEY ("tweet_id")
);

-- CreateIndex
CREATE INDEX "post_alerts_account_id_created_at_idx" ON "post_alerts"("account_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_list_slug_fkey" FOREIGN KEY ("list_slug") REFERENCES "project_lists"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "twitter_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
