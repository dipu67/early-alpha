// Re-classify existing Twitter accounts with the current DB keyword lexicon.
//
//   npm run tag:backfill
//   npm run tag:backfill -- --only-unknown
//   npm run tag:backfill -- --dry-run
//   npm run tag:backfill -- --limit 500
//
// Logic shared with admin UI via services/tagTools.backfillAccountTags.

import "dotenv/config";
import { prisma } from "../../db/prisma.js";
import { backfillAccountTags } from "../../services/tagTools.js";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const ONLY_UNKNOWN = args.has("--only-unknown");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

const LIMIT = Number(argValue("--limit") ?? 0) || undefined;

async function main(): Promise<void> {
  console.log(
    `[tag:backfill] start` +
      (ONLY_UNKNOWN ? " (only unknown/empty)" : "") +
      (DRY_RUN ? " [dry-run]" : "") +
      (LIMIT ? ` limit=${LIMIT}` : ""),
  );

  const result = await backfillAccountTags({
    onlyUnknown: ONLY_UNKNOWN,
    dryRun: DRY_RUN,
    limit: LIMIT,
    onProgress: ({ scanned, updated, unchanged }) => {
      console.log(
        `[tag:backfill] progress scanned=${scanned} updated=${updated} unchanged=${unchanged}`,
      );
    },
  });

  console.log(
    `[tag:backfill] done — scanned=${result.scanned} updated=${result.updated} unchanged=${result.unchanged}` +
      (DRY_RUN ? " (dry-run, no writes)" : ""),
  );
  if (!DRY_RUN && result.updated > 0) {
    console.log(
      `[tag:backfill] tip: run npm run list:sync to push memberships into existing lists`,
    );
  }
}

main()
  .catch((err) => {
    console.error("[tag:backfill] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
