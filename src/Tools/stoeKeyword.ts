// Keyword + handle-token lexicon seeder (CLI).
//
//   npm run tag:seed-keywords
//
// Logic lives in services/tagTools.ts so the admin UI can call the same path.

import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { seedKeywordsFromLexicon } from "../services/tagTools.js";

// Re-export lexicon for tagTools / other imports.
export {
  KEYWORDS,
  HANDLE_TOKENS,
  HANDLE_SUFFIX_TOKENS,
} from "./stoeKeyword.lexicon.js";

async function main(): Promise<void> {
  const { tagCount, keywordCount, handleCount } = await seedKeywordsFromLexicon();
  console.log(
    `[tag:seed-keywords] seeded ${tagCount} tags, ${keywordCount} keywords, ${handleCount} handle tokens`,
  );
}

main()
  .catch((err) => {
    console.error("[tag:seed-keywords] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
