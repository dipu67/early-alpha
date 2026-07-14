-- Twitter live search queries + hits (per-query auth provider).
CREATE TABLE "search_queries" (
    "id" BIGSERIAL NOT NULL,
    "query" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auth_account_id" BIGINT,
    "interval_sec" INTEGER NOT NULL DEFAULT 120,
    "last_polled_at" TIMESTAMPTZ,
    "last_tweet_id" TEXT,
    "last_error" TEXT,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_queries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "search_hits" (
    "id" BIGSERIAL NOT NULL,
    "query_id" BIGINT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "author_id" TEXT,
    "posted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_hits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "search_queries_enabled_last_polled_at_idx" ON "search_queries"("enabled", "last_polled_at");
CREATE INDEX "search_hits_created_at_idx" ON "search_hits"("created_at" DESC);
CREATE INDEX "search_hits_query_id_created_at_idx" ON "search_hits"("query_id", "created_at" DESC);
CREATE UNIQUE INDEX "search_hits_query_id_tweet_id_key" ON "search_hits"("query_id", "tweet_id");

ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_auth_account_id_fkey" FOREIGN KEY ("auth_account_id") REFERENCES "twitter_auth_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "search_hits" ADD CONSTRAINT "search_hits_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "search_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
