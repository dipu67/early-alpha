// PostAlert helpers — feed storage capped at newest N per tag slug
// (same idea as SearchHit prune: small realtime table for the Signals Feed).

import { prisma } from "../db/prisma.js";

/** Max PostAlert rows kept per `slug` (tag / list / user:@x). */
export const POST_ALERT_KEEP_PER_SLUG = 20;

/**
 * Keep only the newest `keep` PostAlert rows for a slug (by createdAt, then tweetId).
 * Returns number of rows deleted.
 */
export async function prunePostAlertsForSlug(
  slug: string,
  keep = POST_ALERT_KEEP_PER_SLUG,
): Promise<number> {
  const tag = slug.trim();
  if (!tag || keep < 1) return 0;

  const count = await prisma.postAlert.count({ where: { slug: tag } });
  if (count <= keep) return 0;

  const survivors = await prisma.postAlert.findMany({
    where: { slug: tag },
    orderBy: [{ createdAt: "desc" }, { tweetId: "desc" }],
    take: keep,
    select: { tweetId: true },
  });
  if (survivors.length === 0) return 0;

  const result = await prisma.postAlert.deleteMany({
    where: {
      slug: tag,
      tweetId: { notIn: survivors.map((r) => r.tweetId) },
    },
  });
  if (result.count > 0) {
    console.log(
      `[post-alert] pruned ${result.count} old rows for slug=${tag} (keep ${keep})`,
    );
  }
  return result.count;
}

/** One-shot prune for every distinct slug (e.g. after deploy / poll-all). */
export async function pruneAllPostAlerts(
  keep = POST_ALERT_KEEP_PER_SLUG,
): Promise<number> {
  const slugs = await prisma.postAlert.findMany({
    distinct: ["slug"],
    select: { slug: true },
  });
  let deleted = 0;
  for (const { slug } of slugs) {
    deleted += await prunePostAlertsForSlug(slug, keep);
  }
  return deleted;
}
