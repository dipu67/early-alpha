ALTER TABLE "seed_accounts" ADD COLUMN "twitter_account_id" TEXT;
CREATE INDEX "seed_accounts_twitter_account_id_idx" ON "seed_accounts"("twitter_account_id");
