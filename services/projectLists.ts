// Project list management — maps tag slugs to real Twitter Lists and keeps each
// tagged account's list memberships in sync.
//
// - One Twitter List per tag slug (created lazily the first time an account
//   needs it), plus an "alpha" list for still-unknown projects.
// - Membership is mirrored locally in the ListMember table so we can diff
//   desired-vs-actual without re-reading Twitter every cycle.
// - When an alpha project's type is later discovered (from its posts), reclassify
//   moves it out of alpha into the matching type list(s) and updates its tags.

import { prisma } from "../db/prisma.js";
import type { TwitterClient } from "../TwitterClient/index.js";
import { markRateLimited } from "../twitter/getClient.js";
import { tagLabel, DEFAULT_SLUG } from "./projectTagger.js";

/** Slug of the catch-all list for projects with no detected type. */
export const ALPHA_SLUG = "alpha";

/** Registry slugs that never get their own list (not real verticals). */
const EXCLUDED_SLUGS = new Set([DEFAULT_SLUG, "other"]);

/** Auth context threaded through so we can flag the auth account when rate-limited. */
export interface ListSyncCtx {
  client: TwitterClient;
  authAccountId: bigint;
  /** Twitter user id of the operating (owner) account; "" if unresolved. */
  ownerUserId: string;
}

/** Minimal account shape the sync logic needs. */
export interface SyncableAccount {
  id: string;
  tags: string[];
}

// slug → Twitter list id, hydrated from ProjectList on first use.
const listIdCache = new Map<string, string>();
// Slugs whose stored list we've confirmed the owner controls this process.
const ownershipVerified = new Set<string>();

// Snapshot of the owner's existing Twitter lists (name → list ids), loaded once
// per process. Used to reuse an already-owned list of the same name instead of
// creating a duplicate, and to find duplicates to delete.
let ownedListsByName: Map<string, string[]> | null = null;

/** Load (once) the owner's current Twitter lists, grouped by name. */
async function loadOwnedLists(ctx: ListSyncCtx): Promise<Map<string, string[]>> {
  if (ownedListsByName) return ownedListsByName;
  const map = new Map<string, string[]>();
  const res = await ctx.client.getMyLists(1000);
  await noteRateLimit(ctx, res.rateLimit);
  if (res.success && res.lists) {
    for (const l of res.lists) {
      const arr = map.get(l.name) ?? [];
      arr.push(l.id);
      map.set(l.name, arr);
    }
  } else {
    console.warn(`[lists] getMyLists failed: ${res.error ?? "unknown"}`);
  }
  ownedListsByName = map;
  return map;
}

/** Human-facing Twitter List name for a slug. */
function listName(slug: string): string {
  return slug === ALPHA_SLUG ? "Alpha / Unknown" : tagLabel(slug);
}

/** Note a rate-limit hit on the current auth account, mirroring track.ts. */
async function noteRateLimit(
  ctx: ListSyncCtx,
  rl?: { remaining: number; reset: number },
): Promise<void> {
  if (rl && rl.remaining === 0)
    await markRateLimited(ctx.authAccountId, rl.reset);
}

/**
 * The list slugs an account *should* belong to: its real type tags, or `alpha`
 * when it has no detected type.
 */
export function desiredSlugsForAccount(account: SyncableAccount): string[] {
  const typed = account.tags.filter(
    (t) => !EXCLUDED_SLUGS.has(t) && t !== ALPHA_SLUG,
  );
  return typed.length > 0 ? typed : [ALPHA_SLUG];
}

/** Persist/refresh the ProjectList row for a slug and cache it as verified. */
async function storeList(slug: string, twitterListId: string): Promise<string> {
  const row = await prisma.projectList.upsert({
    where: { slug },
    create: { slug, twitterListId, name: listName(slug) },
    update: { twitterListId },
  });
  listIdCache.set(slug, row.twitterListId);
  ownershipVerified.add(slug);
  return row.twitterListId;
}

/**
 * Ensure exactly ONE owner-owned Twitter list exists for a slug, and return its
 * id. Idempotent by list name:
 *   - If the owner already has list(s) with this slug's name, keep the first as
 *     canonical and DELETE the duplicates, then store the canonical id.
 *   - Otherwise create a fresh list.
 * This both prevents duplicate creation and cleans up duplicates already made.
 * If the stored id changes, the stale membership mirror is dropped so members
 * are re-added to the surviving list.
 */
async function createAndStore(
  ctx: ListSyncCtx,
  slug: string,
): Promise<string | null> {
  const name = listName(slug);
  const owned = await loadOwnedLists(ctx);
  const existingIds = owned.get(name) ?? [];

  let canonical: string | null = null;

  if (existingIds.length > 0) {
    canonical = existingIds[0]!;
    // Delete any duplicates of the same name (best-effort).
    for (const dupId of existingIds.slice(1)) {
      const del = await ctx.client.deleteList(dupId);
      await noteRateLimit(ctx, del.rateLimit);
      if (del.success) {
        console.log(`[lists] deleted duplicate ${slug} list ${dupId}`);
      } else {
        console.warn(`[lists] deleteList ${dupId} failed: ${del.error ?? "unknown"}`);
      }
    }
    owned.set(name, [canonical]);
  } else {
    const res = await ctx.client.createList(name, `early-alpha ${name} projects`, false);
    await noteRateLimit(ctx, res.rateLimit);
    if (!res.success || !res.list) {
      console.warn(`[lists] createList failed for ${slug}: ${res.error ?? "unknown"}`);
      return null;
    }
    canonical = res.list.id;
    owned.set(name, [canonical]);
  }

  // If the DB pointed at a different id, its membership mirror is stale.
  const prior = await prisma.projectList.findUnique({ where: { slug }, select: { twitterListId: true } });
  if (prior && prior.twitterListId !== canonical) {
    await prisma.listMember.deleteMany({ where: { listSlug: slug } });
  }

  return storeList(slug, canonical);
}

/**
 * Find-or-create the single owner-owned Twitter List for a slug.
 *
 * Steady state: the DB's stored id is one of the owner's lists → return it.
 * Otherwise (id missing, or owned by a different/rotating account) delegate to
 * `createAndStore`, which reuses an existing same-named owned list or creates a
 * fresh one and prunes duplicates. Verified once per process per slug. Returns
 * null only if creation failed (e.g. rate limited) so the caller retries later.
 */
export async function ensureList(
  ctx: ListSyncCtx,
  slug: string,
): Promise<string | null> {
  const cached = listIdCache.get(slug);
  if (cached && ownershipVerified.has(slug)) return cached;

  const existing = cached
    ? { twitterListId: cached }
    : await prisma.projectList.findUnique({ where: { slug } });

  if (!existing) {
    return createAndStore(ctx, slug);
  }

  // Verify the stored list is actually one the owner controls, by checking it
  // against the owner's own list set (authoritative — getMyLists only returns
  // lists we own). If it's there, keep it; if not, heal via createAndStore.
  if (!ownershipVerified.has(slug)) {
    const owned = await loadOwnedLists(ctx);
    const ownedIds = new Set([...owned.values()].flat());
    if (ownedIds.has(existing.twitterListId)) {
      listIdCache.set(slug, existing.twitterListId);
      ownershipVerified.add(slug);
      return existing.twitterListId;
    }
    // Not owned by us (or unknown) — recreate/reuse under the owner.
    return createAndStore(ctx, slug);
  }

  listIdCache.set(slug, existing.twitterListId);
  return existing.twitterListId;
}

/** Does an error indicate the operating account doesn't own the list? */
function isOwnershipError(error?: string): boolean {
  return (
    !!error &&
    /allowed to add members|not authorized|Authorization/i.test(error)
  );
}

/** Force-recreate a slug's list under the current owner and repoint everything. */
async function recreateList(
  ctx: ListSyncCtx,
  slug: string,
): Promise<string | null> {
  listIdCache.delete(slug);
  ownershipVerified.delete(slug);
  ownedListsByName = null; // force a fresh view of the owner's lists
  await prisma.listMember.deleteMany({ where: { listSlug: slug } });
  return createAndStore(ctx, slug);
}

/** Add an account to a list on Twitter and mirror it locally. */
async function addToList(
  ctx: ListSyncCtx,
  slug: string,
  accountId: string,
): Promise<boolean> {
  let listId = await ensureList(ctx, slug);
  if (!listId) return false;
  console.log(`[lists] adding ${accountId} to ${slug} (${listId})`);
  let res = await ctx.client.addListMember(listId, accountId);
  await noteRateLimit(ctx, res.rateLimit);

  // Reactive self-heal: if Twitter says we don't own this list (a leftover from
  // when a rotating account created it), recreate it under the owner and retry
  // once. Guards the case where the proactive getList ownership check couldn't
  // read the owner id.
  if (!res.success && isOwnershipError(res.error)) {
    console.warn(
      `[lists] ${slug} not owned by operator — recreating and retrying`,
    );
    const fresh = await recreateList(ctx, slug);
    if (!fresh) return false;
    listId = fresh;
    res = await ctx.client.addListMember(listId, accountId);
    await noteRateLimit(ctx, res.rateLimit);
  }

  if (!res.success) {
    console.warn(
      `[lists] addListMember ${slug} <- ${accountId} failed: ${res.error ?? "unknown"}`,
    );
    return false;
  }

  await prisma.listMember.upsert({
    where: { listSlug_accountId: { listSlug: slug, accountId } },
    create: { listSlug: slug, accountId },
    update: {},
  });
  return true;
}

/** Remove an account from a list on Twitter and locally. */
async function removeFromList(
  ctx: ListSyncCtx,
  slug: string,
  accountId: string,
): Promise<void> {
  const listId = listIdCache.get(slug) ?? (await ensureList(ctx, slug));
  if (listId) {
    const res = await ctx.client.removeListMember(listId, accountId);
    await noteRateLimit(ctx, res.rateLimit);
    if (!res.success) {
      console.warn(
        `[lists] removeListMember ${slug} -> ${accountId} failed: ${res.error ?? "unknown"}`,
      );
    }
  }
  await prisma.listMember
    .delete({ where: { listSlug_accountId: { listSlug: slug, accountId } } })
    .catch(() => undefined);
}

/**
 * Reconcile one account's list memberships to the desired set, then stamp
 * `listsSyncedAt`. Adds it to any missing type/alpha lists and removes it from
 * lists it no longer belongs to (e.g. alpha after it's been typed).
 */
export async function reconcileAccountLists(
  ctx: ListSyncCtx,
  account: SyncableAccount,
): Promise<{ added: string[]; removed: string[] }> {
  const desired = new Set(desiredSlugsForAccount(account));
  const current = await prisma.listMember.findMany({
    where: { accountId: account.id },
    select: { listSlug: true },
  });
  const currentSet = new Set(current.map((m) => m.listSlug));

  const added: string[] = [];
  const removed: string[] = [];

  for (const slug of desired) {
    if (!currentSet.has(slug) && (await addToList(ctx, slug, account.id))) {
      added.push(slug);
    }
  }
  for (const slug of currentSet) {
    if (!desired.has(slug)) {
      await removeFromList(ctx, slug, account.id);
      removed.push(slug);
    }
  }

  await prisma.twitterAccount.update({
    where: { id: account.id },
    data: { listsSyncedAt: new Date() },
  });

  return { added, removed };
}

/**
 * Merge newly-discovered type slugs into an account's tags (dropping the
 * `unknown` fallback) and re-run reconciliation, which lifts it out of alpha and
 * into the matching type lists. Returns the slugs it was newly added to.
 */
export async function reclassifyAccount(
  ctx: ListSyncCtx,
  accountId: string,
  foundSlugs: string[],
): Promise<{ added: string[]; removed: string[]; tags: string[] } | null> {
  const account = await prisma.twitterAccount.findUnique({
    where: { id: accountId },
    select: { id: true, tags: true },
  });
  if (!account) return null;

  const merged = new Set(account.tags.filter((t) => t !== DEFAULT_SLUG));
  for (const slug of foundSlugs)
    if (!EXCLUDED_SLUGS.has(slug)) merged.add(slug);
  const tags = [...merged];
  if (tags.length === 0) return null; // nothing typed — stay in alpha

  await prisma.twitterAccount.update({
    where: { id: accountId },
    data: { tags },
  });
  const { added, removed } = await reconcileAccountLists(ctx, {
    id: accountId,
    tags,
  });
  return { added, removed, tags };
}
