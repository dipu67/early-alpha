// First-time (and re-run) seeder for Grok research special prompts.
//
//   npm run grok:store-prompts
//
// Writes all built-in special prompts into grok_research_prompts.
// Safe to re-run: builtins are upserted/refreshed; custom prompts are never deleted.

import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { ensureBuiltinPrompts, BUILTIN_PROMPTS } from "../services/grokResearch.js";

async function main(): Promise<void> {
  console.log(
    `[grok:store-prompts] seeding ${BUILTIN_PROMPTS.length} built-in special prompts…`,
  );

  const { upserted, slugs } = await ensureBuiltinPrompts();

  const rows = await prisma.grokResearchPrompt.findMany({
    orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      defaultTag: true,
      isBuiltin: true,
      updatedAt: true,
    },
  });

  console.log(`[grok:store-prompts] upserted ${upserted} builtin(s):`);
  for (const s of slugs) {
    const row = rows.find((r) => r.slug === s);
    console.log(
      `  ✓ ${s}${row ? `  (#${row.id} · ${row.name}${row.defaultTag ? ` · tag=${row.defaultTag}` : ""})` : ""}`,
    );
  }

  const custom = rows.filter((r) => !r.isBuiltin);
  console.log(
    `[grok:store-prompts] DB now has ${rows.length} prompt(s) ` +
      `(${rows.length - custom.length} builtin, ${custom.length} custom)`,
  );
  if (custom.length > 0) {
    console.log("[grok:store-prompts] custom prompts kept:");
    for (const c of custom) {
      console.log(`  · ${c.slug}  (#${c.id} · ${c.name})`);
    }
  }
  console.log("[grok:store-prompts] done");
}

main()
  .catch((err) => {
    console.error(
      "[grok:store-prompts] failed:",
      err instanceof Error ? err.message : err,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
