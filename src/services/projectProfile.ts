// Refresh TwitterAccount profile fields (bio, name, counts) via getUsersByIds.
// Used when projects were stored without description (null bio).

import { prisma } from "../db/prisma.js";
import { getTwitterClient, markRateLimited } from "../twitter/getClient.js";
import { classifyAccount } from "./projectTagger.js";
import { enrichFromBio } from "./projectEnricher.js";
import type { UserData } from "../TwitterClient/types.js";

const BATCH = 50;

export type FetchProfileResult = {
  requested: number;
  updated: number;
  missing: number;
  errors: string[];
  items: {
    id: string;
    username: string;
    description: string | null;
    name: string;
    tags?: string[];
  }[];
};

function missingBioWhere() {
  return {
    OR: [{ description: null }, { description: "" }],
  };
}

/**
 * Fetch profiles for Twitter user ids with getUsersByIds and write bio/name/counts.
 * Optionally re-run tag classifier when bio was empty.
 */
export async function fetchAndUpdateProjectProfiles(opts: {
  ids?: string[];
  missingBioOnly?: boolean;
  limit?: number;
  reclassify?: boolean;
}): Promise<FetchProfileResult> {
  const missingBioOnly = opts.missingBioOnly !== false;
  const reclassify = opts.reclassify !== false;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);

  const rows = await prisma.twitterAccount.findMany({
    where: {
      ...(opts.ids && opts.ids.length > 0 ? { id: { in: opts.ids } } : {}),
      ...(missingBioOnly && !(opts.ids && opts.ids.length > 0)
        ? missingBioWhere()
        : opts.ids && opts.ids.length > 0 && missingBioOnly
          ? missingBioWhere()
          : {}),
    },
    select: { id: true, username: true, description: true, tags: true },
    orderBy: { firstSeenAt: "desc" },
    take: limit,
  });

  if (rows.length === 0) {
    return {
      requested: 0,
      updated: 0,
      missing: 0,
      errors: [],
      items: [],
    };
  }

  const { client, accountId } = await getTwitterClient();
  const byId = new Map<string, UserData>();
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => r.id);
    if (chunk.length === 0) continue;
    const res = await client.getUsersByIds(chunk);
    if (res.rateLimit && res.rateLimit.remaining === 0) {
      await markRateLimited(accountId, res.rateLimit.reset);
    }
    if (!res.success) {
      errors.push(res.error ?? "getUsersByIds_failed");
      continue;
    }
    for (const u of res.users ?? []) {
      if (u?.id) byId.set(u.id, u);
    }
  }

  let updated = 0;
  let missing = 0;
  const items: FetchProfileResult["items"] = [];

  for (const row of rows) {
    const u = byId.get(row.id);
    if (!u) {
      missing += 1;
      continue;
    }

    const description =
      u.description != null && u.description.trim() !== ""
        ? u.description.trim()
        : null;
    const name = (u.name ?? row.username).trim() || row.username;
    const username = (u.username ?? row.username).toLowerCase();

    let tags = row.tags;
    if (reclassify) {
      tags = await classifyAccount({
        username,
        name,
        description,
      });
    }

    // Clean up: remove "other" if there are meaningful tags/categories
    const cleanTags = tags.filter((t) => t !== "other");
    const effectiveTags = cleanTags.length > 0 ? cleanTags : tags;

    await prisma.twitterAccount.update({
      where: { id: row.id },
      data: {
        username,
        name,
        description,
        tags: effectiveTags,
        ...(u.followersCount != null ? { followersCount: u.followersCount } : {}),
        ...(u.followingCount != null ? { followingCount: u.followingCount } : {}),
        ...(u.tweetCount != null ? { tweetCount: u.tweetCount } : {}),
        ...(u.likeCount != null ? { likeCount: u.likeCount } : {}),
        ...(u.isBlueVerified != null ? { isBlueVerified: u.isBlueVerified } : {}),
        ...(u.profileImageUrl != null
          ? { profileImageUrl: u.profileImageUrl }
          : {}),
        ...(u.profileBannerUrl != null
          ? { profileBannerUrl: u.profileBannerUrl }
          : {}),
        ...(u.location != null ? { location: u.location } : {}),
        ...(u.createdAt ? { createdAt: new Date(u.createdAt) } : {}),
      },
    });

    // Update Project.chain from bio (category lives on account.tags, not Project)
    if (reclassify) {
      const { enrichFromBio } = await import("./projectEnricher.js");
      const { chain } = enrichFromBio(description, name || row.username);
      const existingProject = await prisma.project.findUnique({
        where: { twitterAccountId: row.id },
        select: { id: true, chain: true },
      });
      if (existingProject) {
        const chainChanged = existingProject.chain !== chain;
        if (chainChanged) {
          await prisma.project.update({
            where: { id: existingProject.id },
            data: { chain },
          });
        }
      }
    }

    updated += 1;
    items.push({
      id: row.id,
      username,
      name,
      description,
      ...(reclassify ? { tags } : {}),
    });
  }

  return {
    requested: rows.length,
    updated,
    missing,
    errors,
    items,
  };
}
