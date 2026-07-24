-- DropIndex
DROP INDEX "project_monitors_twitter_user_id_idx";

-- AlterTable
ALTER TABLE "twitter_accounts" ADD COLUMN     "fxtwitter_cursor" TEXT;
