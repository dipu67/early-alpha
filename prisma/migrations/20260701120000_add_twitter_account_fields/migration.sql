-- AlterTable
ALTER TABLE "twitter_accounts" ADD COLUMN "tweet_count" INTEGER;
ALTER TABLE "twitter_accounts" ADD COLUMN "like_count" INTEGER;
ALTER TABLE "twitter_accounts" ADD COLUMN "profile_banner_url" TEXT;
ALTER TABLE "twitter_accounts" ADD COLUMN "location" TEXT;
ALTER TABLE "twitter_accounts" ADD COLUMN "detected_at" TIMESTAMPTZ NOT NULL DEFAULT now();
