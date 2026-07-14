-- Telegram group + topic catalog for admin management via grammy

CREATE TABLE "telegram_groups" (
    "id" BIGSERIAL NOT NULL,
    "chat_id" TEXT NOT NULL,
    "title" TEXT,
    "type" TEXT NOT NULL DEFAULT 'supergroup',
    "is_forum" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT,
    "bot_db_id" BIGINT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_groups_chat_id_key" ON "telegram_groups"("chat_id");

CREATE TABLE "telegram_topics" (
    "id" BIGSERIAL NOT NULL,
    "group_id" BIGINT NOT NULL,
    "message_thread_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "icon_color" INTEGER,
    "icon_custom_emoji_id" TEXT,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "is_general" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_topics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_topics_group_id_message_thread_id_key" ON "telegram_topics"("group_id", "message_thread_id");
CREATE INDEX "telegram_topics_group_id_idx" ON "telegram_topics"("group_id");

ALTER TABLE "telegram_topics" ADD CONSTRAINT "telegram_topics_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "telegram_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
