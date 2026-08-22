ALTER TABLE "project_tags" ADD COLUMN "is_chain" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "project_tags_is_chain_idx" ON "project_tags"("is_chain");
