-- Which Twitter auth account owns each project list (for create / member ops).
ALTER TABLE "project_lists" ADD COLUMN "auth_account_id" BIGINT;

ALTER TABLE "project_lists" ADD CONSTRAINT "project_lists_auth_account_id_fkey"
  FOREIGN KEY ("auth_account_id") REFERENCES "twitter_auth_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
