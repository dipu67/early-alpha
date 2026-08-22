// Shared tag tools used by CLI scripts and the admin API/worker.
//
//   seedKeywordsFromLexicon()  — push KEYWORDS + handle tokens into project_tags
//   backfillAccountTags()      — re-classify twitter_accounts with the DB lexicon

import { prisma } from "../db/prisma.js";
import {
  KEYWORDS,
  HANDLE_TOKENS,
  HANDLE_SUFFIX_TOKENS,
} from "../Tools/stoeKeyword.lexicon.js";
import {
  classifyAccount,
  warmLexicon,
  invalidateLexiconCache,
  DEFAULT_SLUG,
  tagLabel,
  CHAIN_SLUGS,
  tagSlugToCategory,
} from "./projectTagger.js";

function labelFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(" ");
}

export async function seedKeywordsFromLexicon(): Promise<{
  tagCount: number;
  keywordCount: number;
  handleCount: number;
}> {
  let tagCount = 0;
  let keywordCount = 0;
  let handleCount = 0;

  const slugs = new Set([
    ...Object.keys(KEYWORDS),
    ...Object.keys(HANDLE_TOKENS),
    ...Object.keys(HANDLE_SUFFIX_TOKENS),
  ]);

  for (const slug of slugs) {
    const entries = KEYWORDS[slug] ?? [];
    const keywords: string[] = [];
    const regexKeywords: string[] = [];
    for (const e of entries) {
      if (e instanceof RegExp) regexKeywords.push(e.source);
      else keywords.push(e);
    }

    const handleTokens = HANDLE_TOKENS[slug] ?? [];
    const handleSuffixTokens = HANDLE_SUFFIX_TOKENS[slug] ?? [];

    await prisma.projectTag.upsert({
      where: { slug },
      create: {
        slug,
        label: labelFromSlug(slug),
        isBuiltin: true,
        keywords,
        regexKeywords,
        handleTokens,
        handleSuffixTokens,
      },
      update: {
        isBuiltin: true,
        keywords,
        regexKeywords,
        handleTokens,
        handleSuffixTokens,
      },
    });

    tagCount += 1;
    keywordCount += keywords.length + regexKeywords.length;
    handleCount += handleTokens.length + handleSuffixTokens.length;
  }

  invalidateLexiconCache();
  await warmLexicon();

  return { tagCount, keywordCount, handleCount };
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((t, i) => t === sb[i]);
}

export async function backfillAccountTags(opts: {
  onlyUnknown?: boolean;
  dryRun?: boolean;
  limit?: number;
  batchSize?: number;
  onProgress?: (p: {
    scanned: number;
    updated: number;
    unchanged: number;
  }) => void;
}): Promise<{ scanned: number; updated: number; unchanged: number }> {
  const onlyUnknown = opts.onlyUnknown ?? false;
  const dryRun = opts.dryRun ?? false;
  const limit = opts.limit && opts.limit > 0 ? opts.limit : Infinity;
  const batchSize = opts.batchSize ?? Number(process.env.TAG_BACKFILL_BATCH ?? 200);

  await warmLexicon();

  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  let cursor: string | undefined;

  while (scanned < limit) {
    const take = Math.min(batchSize, limit - scanned);
    const rows = await prisma.twitterAccount.findMany({
      ...(onlyUnknown
        ? {
            where: {
              OR: [
                { tags: { equals: [] } },
                { tags: { equals: [DEFAULT_SLUG] } },
                { tags: { has: DEFAULT_SLUG } },
              ],
            },
          }
        : {}),
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        username: true,
        name: true,
        description: true,
        tags: true,
      },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const next = await classifyAccount({
        username: row.username,
        name: row.name,
        description: row.description,
      });

      if (!dryRun) {
        // Always normalize: sort tags alphabetically to eliminate ordering
        // duplicates like {nft,robinhood} vs {robinhood,nft}
        const normalized = [...next].sort();
        await prisma.twitterAccount.update({
          where: { id: row.id },
          data: { tags: normalized, listsSyncedAt: null },
        });
        updated += 1;

        // Always sync Project.category from classified tag slugs → labels
        // (catches accounts tagged before this sync was added)
        try {
          const project = await prisma.project.findUnique({
            where: { twitterAccountId: row.id },
            select: { id: true, category: true, chain: true },
          });
          if (project) {
            const categories = next
              .filter((t) => t !== DEFAULT_SLUG && !CHAIN_SLUGS.has(t))
              .map((t) => tagSlugToCategory(t));
            const cleanCategories = [...new Set(categories)];
            const chain = next.find((t) => CHAIN_SLUGS.has(t)) ?? null;
            const catChanged = JSON.stringify(project.category) !== JSON.stringify(cleanCategories);
            const chainChanged = project.chain !== chain;
            if (catChanged || chainChanged) {
              await prisma.project.update({
                where: { id: project.id },
                data: {
                  ...(catChanged ? { category: cleanCategories.length > 0 ? cleanCategories : ["other"] } : {}),
                  ...(chainChanged ? { chain } : {}),
                },
              });
              updated += 1;
            }
          }
        } catch (err) {
          console.warn("[tagTools] backfill: project category update failed:", err instanceof Error ? err.message : err);
        }
      } else {
        unchanged += 1;
      }
    }

    cursor = rows[rows.length - 1]!.id;
    opts.onProgress?.({ scanned, updated, unchanged });
  }

  return { scanned, updated, unchanged };
}
