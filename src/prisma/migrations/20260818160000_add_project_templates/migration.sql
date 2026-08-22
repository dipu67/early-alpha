-- CreateTable: reusable project templates
CREATE TABLE IF NOT EXISTS "project_templates" (
  "id"              BIGSERIAL NOT NULL,
  "slug"            TEXT NOT NULL UNIQUE,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "category"        TEXT NOT NULL,
  "chain"           TEXT,
  "default_tags"    JSONB NOT NULL DEFAULT '[]',
  "template_fields" JSONB NOT NULL DEFAULT '{}',
  "is_builtin"      BOOLEAN NOT NULL DEFAULT false,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "project_templates_category_idx" ON "project_templates" ("category");
