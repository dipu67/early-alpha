-- CreateTable: project enrichment layer
CREATE TABLE IF NOT EXISTS "projects" (
  "id"            BIGSERIAL NOT NULL,
  "twitter_account_id" TEXT NOT NULL UNIQUE,
  "name"          TEXT NOT NULL DEFAULT '',
  "description"   TEXT,
  "website"       TEXT,
  "github"        TEXT,
  "category"      TEXT NOT NULL DEFAULT 'other',
  "project_status" TEXT NOT NULL DEFAULT 'discovered',
  "chain"         TEXT,
  "token_address" TEXT,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "projects_twitter_account_id_fkey"
    FOREIGN KEY ("twitter_account_id") REFERENCES "twitter_accounts" ("id") ON DELETE CASCADE
);

-- Indexes (matching schema)
CREATE INDEX IF NOT EXISTS "projects_project_status_idx" ON "projects" ("project_status");
CREATE INDEX IF NOT EXISTS "projects_category_idx"       ON "projects" ("category");
CREATE INDEX IF NOT EXISTS "projects_chain_idx"          ON "projects" ("chain");
