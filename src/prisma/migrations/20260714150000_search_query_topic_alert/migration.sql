-- Per-query Telegram topic + alert toggle for live search.
ALTER TABLE "search_queries" ADD COLUMN "topic_id" INTEGER;
ALTER TABLE "search_queries" ADD COLUMN "alert_enabled" BOOLEAN NOT NULL DEFAULT true;
