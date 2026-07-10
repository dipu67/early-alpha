-- AlterTable
ALTER TABLE "twitter_accounts" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
