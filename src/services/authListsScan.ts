// Scan every Twitter auth-pool account with client.getMyLists() and return
// what each account owns on X (for admin inventory / orphan detection).

import { prisma } from "../db/prisma.js";
import { TwitterClient } from "../TwitterClient/index.js";
import { markRateLimited } from "../twitter/getClient.js";
import type { ListData } from "../TwitterClient/types.js";

export interface AuthOwnedList {
  id: string;
  name: string;
  description?: string;
  memberCount?: number;
  subscriberCount?: number;
  isPrivate?: boolean;
  /** Matched ProjectList.slug if this list id is registered in DB. */
  projectSlug: string | null;
  projectName: string | null;
}

export interface AuthListsScanEntry {
  authAccountId: string;
  username: string;
  isActive: boolean;
  rateLimited: boolean;
  ok: boolean;
  error?: string;
  listCount: number;
  lists: AuthOwnedList[];
}

export interface AuthListsScanResult {
  scannedAt: string;
  authCount: number;
  listCount: number;
  /** Twitter list ids that appear under more than one auth (shouldn't happen often). */
  duplicateListIds: string[];
  items: AuthListsScanEntry[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call getMyLists() for every auth account (active + inactive).
 * Does not mutate DB — inventory only.
 */
export async function scanAllAuthLists(opts?: {
  /** Only active auths (default true). */
  activeOnly?: boolean;
  /** Max lists per account (getMyLists count). */
  count?: number;
  /** Delay between accounts to avoid hammering. */
  delayMs?: number;
}): Promise<AuthListsScanResult> {
  const activeOnly = opts?.activeOnly ?? true;
  const count = opts?.count ?? 100;
  const delayMs = opts?.delayMs ?? 400;

  const auths = await prisma.twitterAuthAccount.findMany({
    ...(activeOnly ? { where: { isActive: true } } : {}),
    orderBy: { id: "asc" },
    select: {
      id: true,
      username: true,
      authToken: true,
      ct0: true,
      isActive: true,
      rateLimitedUntil: true,
    },
  });

  const projectLists = await prisma.projectList.findMany({
    select: {
      slug: true,
      name: true,
      twitterListId: true,
    },
  });
  const byTwitterId = new Map(
    projectLists.map((p) => [p.twitterListId, p] as const),
  );

  const items: AuthListsScanEntry[] = [];
  const idOwners = new Map<string, string[]>();

  for (let i = 0; i < auths.length; i++) {
    const auth = auths[i]!;
    const rateLimited =
      auth.rateLimitedUntil != null &&
      auth.rateLimitedUntil.getTime() > Date.now();

    const client = new TwitterClient({
      cookies: { authToken: auth.authToken, ct0: auth.ct0 },
    });

    let ok = false;
    let error: string | undefined;
    let lists: ListData[] = [];

    try {
      const res = await client.getMyLists(count);
      if (res.rateLimit && res.rateLimit.remaining === 0) {
        await markRateLimited(auth.id, res.rateLimit.reset);
      }
      if (!res.success) {
        error = res.error ?? "getMyLists_failed";
      } else {
        ok = true;
        lists = res.lists ?? [];
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    // Touch lastUsed so pool rotation stays honest
    await prisma.twitterAuthAccount
      .update({
        where: { id: auth.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined);

    const mapped: AuthOwnedList[] = lists.map((l) => {
      const proj = byTwitterId.get(l.id);
      const owners = idOwners.get(l.id) ?? [];
      owners.push(auth.username);
      idOwners.set(l.id, owners);
      const row: AuthOwnedList = {
        id: l.id,
        name: l.name,
        projectSlug: proj?.slug ?? null,
        projectName: proj?.name ?? null,
      };
      if (l.description !== undefined) row.description = l.description;
      if (l.memberCount !== undefined) row.memberCount = l.memberCount;
      if (l.subscriberCount !== undefined) row.subscriberCount = l.subscriberCount;
      if (l.isPrivate !== undefined) row.isPrivate = l.isPrivate;
      return row;
    });

    items.push({
      authAccountId: auth.id.toString(),
      username: auth.username,
      isActive: auth.isActive,
      rateLimited,
      ok,
      ...(error ? { error } : {}),
      listCount: mapped.length,
      lists: mapped,
    });

    if (delayMs > 0 && i < auths.length - 1) await sleep(delayMs);
  }

  const duplicateListIds = [...idOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([id]) => id);

  const listCount = items.reduce((n, e) => n + e.listCount, 0);

  console.log(
    `[auth-lists] scanned ${items.length} auth accounts, ${listCount} lists total` +
      (duplicateListIds.length
        ? `, ${duplicateListIds.length} duplicate list ids`
        : ""),
  );

  return {
    scannedAt: new Date().toISOString(),
    authCount: items.length,
    listCount,
    duplicateListIds,
    items,
  };
}
