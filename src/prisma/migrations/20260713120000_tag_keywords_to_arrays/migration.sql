-- Move keywords from the normalized tag_keywords table onto ProjectTag as
-- two array columns: plain keywords and regex sources.

-- AlterTable
ALTER TABLE "project_tags" ADD COLUMN "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "project_tags" ADD COLUMN "regex_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill from tag_keywords (plain vs regex split on is_regex)
UPDATE "project_tags" p SET
  "keywords" = COALESCE((
    SELECT array_agg(k."keyword" ORDER BY k."keyword")
    FROM "tag_keywords" k
    WHERE k."slug" = p."slug" AND k."is_regex" = false
  ), ARRAY[]::TEXT[]),
  "regex_keywords" = COALESCE((
    SELECT array_agg(k."keyword" ORDER BY k."keyword")
    FROM "tag_keywords" k
    WHERE k."slug" = p."slug" AND k."is_regex" = true
  ), ARRAY[]::TEXT[]);

-- DropTable
DROP TABLE "tag_keywords";
