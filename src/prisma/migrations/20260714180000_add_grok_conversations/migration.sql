-- Grok bot conversations + message transcript (replaces conversationId.json)

CREATE TABLE "grok_conversations" (
    "id" BIGSERIAL NOT NULL,
    "grok_conversation_id" TEXT NOT NULL,
    "telegram_chat_id" TEXT NOT NULL,
    "chat_type" TEXT NOT NULL,
    "title" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ,

    CONSTRAINT "grok_conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "grok_conversations_grok_conversation_id_key" ON "grok_conversations"("grok_conversation_id");
CREATE INDEX "grok_conversations_telegram_chat_id_is_active_idx" ON "grok_conversations"("telegram_chat_id", "is_active");
CREATE INDEX "grok_conversations_telegram_chat_id_created_at_idx" ON "grok_conversations"("telegram_chat_id", "created_at" DESC);

CREATE TABLE "grok_messages" (
    "id" BIGSERIAL NOT NULL,
    "conversation_db_id" BIGINT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "telegram_user_id" TEXT,
    "telegram_message_id" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grok_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "grok_messages_conversation_db_id_created_at_idx" ON "grok_messages"("conversation_db_id", "created_at");

ALTER TABLE "grok_messages" ADD CONSTRAINT "grok_messages_conversation_db_id_fkey" FOREIGN KEY ("conversation_db_id") REFERENCES "grok_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
