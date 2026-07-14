-- CreateTable
CREATE TABLE "telegram_bots" (
    "id" BIGSERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "telegram_bots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_bots_token_key" ON "telegram_bots"("token");
