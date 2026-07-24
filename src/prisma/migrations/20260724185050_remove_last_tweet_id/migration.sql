/*
  Warnings:

  - You are about to drop the column `last_tweet_id` on the `twitter_accounts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "twitter_accounts" DROP COLUMN "last_tweet_id";
