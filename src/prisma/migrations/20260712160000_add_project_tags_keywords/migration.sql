-- CreateTable
CREATE TABLE "project_tags" (
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "project_tags_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "tag_keywords" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "is_regex" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tag_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tag_keywords_slug_idx" ON "tag_keywords"("slug");
CREATE UNIQUE INDEX "tag_keywords_slug_keyword_key" ON "tag_keywords"("slug", "keyword");

-- AddForeignKey
ALTER TABLE "tag_keywords" ADD CONSTRAINT "tag_keywords_slug_fkey" FOREIGN KEY ("slug") REFERENCES "project_tags"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
