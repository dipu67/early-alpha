-- Grok research prompts (templates) + research runs

CREATE TABLE "grok_research_prompts" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "template" TEXT NOT NULL,
    "default_tag" TEXT,
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grok_research_prompts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "grok_research_prompts_slug_key" ON "grok_research_prompts"("slug");

CREATE TABLE "grok_research_runs" (
    "id" BIGSERIAL NOT NULL,
    "prompt_id" BIGINT,
    "title" TEXT,
    "tag" TEXT,
    "project_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "project_handles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rendered_prompt" TEXT NOT NULL,
    "response" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "grok_conversation_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "grok_research_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "grok_research_runs_created_at_idx" ON "grok_research_runs"("created_at" DESC);
CREATE INDEX "grok_research_runs_tag_idx" ON "grok_research_runs"("tag");

ALTER TABLE "grok_research_runs" ADD CONSTRAINT "grok_research_runs_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "grok_research_prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
