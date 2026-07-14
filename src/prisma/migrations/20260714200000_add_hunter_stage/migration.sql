-- Pro-hunter funnel fields on twitter_accounts

ALTER TABLE "twitter_accounts" ADD COLUMN "hunt_stage" TEXT NOT NULL DEFAULT 'noise';
ALTER TABLE "twitter_accounts" ADD COLUMN "hunt_note" TEXT;
ALTER TABLE "twitter_accounts" ADD COLUMN "hunt_updated_at" TIMESTAMPTZ;

CREATE INDEX "twitter_accounts_hunt_stage_idx" ON "twitter_accounts"("hunt_stage");
CREATE INDEX "twitter_accounts_first_seen_at_idx" ON "twitter_accounts"("first_seen_at" DESC);
