import "dotenv/config";
import { prisma } from "../../db/prisma.js";
import { classifyAccount } from "../../services/projectTagger.js";

// Backfill project-type tags onto existing TwitterAccount rows.
//
// Idempotent: recomputes tags from each account's name + description and only
// writes when the result differs from what's already stored. Safe to re-run
// (e.g. after extending the lexicon in services/projectTagger.ts).
//
//   npm run tag:backfill

const BATCH_SIZE = 500;

/** Order-insensitive equality for two slug arrays. */
function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}

async function main(): Promise<void> {
  let cursor: string | undefined;
  let scanned = 0;
  let updated = 0;
  const slugCounts = new Map<string, number>();

  for (;;) {
    const rows = await prisma.twitterAccount.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, username: true, name: true, description: true, tags: true },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const tags = classifyAccount(row);
      for (const slug of tags) {
        slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
      }

      if (!sameTags(tags, row.tags)) {
        await prisma.twitterAccount.update({
          where: { id: row.id },
          data: { tags },
        });
        updated++;
      }
    }

    cursor = rows[rows.length - 1]!.id;
    console.log(`[tag:backfill] scanned ${scanned}, updated ${updated}…`);
  }

  const top = [...slugCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([slug, n]) => `${slug}=${n}`)
    .join(", ");

  console.log(`[tag:backfill] done — scanned ${scanned}, updated ${updated}`);
  console.log(`[tag:backfill] top tags: ${top || "(none)"}`);
}

main()
  .catch((err) => {
    console.error("[tag:backfill] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
