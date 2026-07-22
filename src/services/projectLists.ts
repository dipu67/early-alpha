// Project list management — maps tag slugs to real Twitter Lists and keeps each
// tagged account's list memberships in sync.
//
// - Lists are created ONLY from the admin dashboard (`createProjectList`).
//   The list worker / reconcile path NEVER auto-creates Twitter lists.
// - Membership is mirrored locally in ListMember so we can diff desired-vs-actual.
// - When an account is tagged with a slug that has no ProjectList row yet,
//   reconcile skips that slug until an admin creates the list.

import { prisma } from "../db/prisma.js";
import type { TwitterClient } from "../TwitterClient/index.js";
import {
  markRateLimited,
  markRateLimitedUntil,
  nextUtcDayReset,
} from "../twitter/getClient.js";
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
// Slugs we've resolved from DB this process (no auto-create path).
const resolvedSlugs = new Set<string>();

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
async function storeList(
  slug: string,
  twitterListId: string,
  opts?: { name?: string; authAccountId?: bigint | null },
): Promise<string> {
  const name = opts?.name ?? listName(slug);
  const row = await prisma.projectList.upsert({
    where: { slug },
    create: {
      slug,
      twitterListId,
      name,
      ...(opts?.authAccountId !== undefined ? { authAccountId: opts.authAccountId } : {}),
    },
    update: {
      twitterListId,
      ...(opts?.name !== undefined ? { name: opts.name } : {}),
      ...(opts?.authAccountId !== undefined ? { authAccountId: opts.authAccountId } : {}),
    },
  });
  listIdCache.set(slug, row.twitterListId);
  resolvedSlugs.add(slug);
  return row.twitterListId;
}

/**
 * Admin: create a Twitter list under a chosen auth account and register it in DB.
 * Fails if the slug already exists.
 */
export async function createProjectList(input: {
  slug: string;
  name?: string;
  description?: string;
  authAccountId: bigint;
}): Promise<{
  slug: string;
  name: string;
  twitterListId: string;
  authAccountId: string;
  authUsername: string;
}> {
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("slug must be lowercase kebab-case (e.g. nft-mint)");
  }

  const existing = await prisma.projectList.findUnique({ where: { slug } });
  if (existing) throw new Error("list_slug_exists");

  const { getListClient } = await import("../twitter/getClient.js");
  const { client, accountId, username } = await getListClient(input.authAccountId);

  const name = (input.name?.trim() || listName(slug)).slice(0, 80);
  const description =
    (input.description?.trim() || `early-alpha ${name} projects`).slice(0, 100);

  const res = await client.createList(name, description, false);
  if (res.rateLimit && res.rateLimit.remaining === 0) {
    await markRateLimited(accountId, res.rateLimit.reset);
  }
  if (!res.success || !res.list) {
    throw new Error(res.error ?? "createList_failed");
  }

  await storeList(slug, res.list.id, { name, authAccountId: accountId });

  // So list-worker reconcile will pick up accounts tagged with this slug.
  await prisma.twitterAccount.updateMany({
    where: { tags: { has: slug } },
    data: { listsSyncedAt: null },
  });

  return {
    slug,
    name,
    twitterListId: res.list.id,
    authAccountId: accountId.toString(),
    authUsername: username,
  };
}

/**
 * Admin: delete one project list on Twitter (using its owner auth) and remove
 * local project_lists + list_members for that slug. Does not wipe other lists.
 */
export async function deleteProjectList(slug: string): Promise<{
  slug: string;
  twitterDeleted: boolean;
  twitterListId: string;
}> {
  const row = await prisma.projectList.findUnique({ where: { slug } });
  if (!row) throw new Error("list_not_found");

  const { getListClient } = await import("../twitter/getClient.js");
  const { client, accountId } = await getListClient(row.authAccountId);

  let twitterDeleted = false;
  const del = await client.deleteList(row.twitterListId);
  if (del.rateLimit && del.rateLimit.remaining === 0) {
    await markRateLimited(accountId, del.rateLimit.reset);
  }
  if (del.success) {
    twitterDeleted = true;
  } else {
    // Still remove local state if Twitter says the list is already gone.
    const err = (del.error ?? "").toLowerCase();
    const gone =
      err.includes("not found") ||
      err.includes("does not exist") ||
      err.includes("couldn't find");
    if (!gone) {
      throw new Error(del.error ?? "deleteList_failed");
    }
  }

  await prisma.listMember.deleteMany({ where: { listSlug: slug } });
  await prisma.projectList.delete({ where: { slug } });
  listIdCache.delete(slug);
  resolvedSlugs.delete(slug);

  // Force re-sync for accounts that were on this list (best-effort).
  await prisma.twitterAccount.updateMany({
    where: { tags: { has: slug } },
    data: { listsSyncedAt: null },
  });

  return {
    slug,
    twitterDeleted,
    twitterListId: row.twitterListId,
  };
}

/**
 * Admin: add a member to an owned list (Twitter + local ListMember).
 * Accepts Twitter username (preferred) or rest id. Upserts TwitterAccount.
 */
export async function addMemberToProjectList(
  slug: string,
  input: { username?: string; accountId?: string },
): Promise<{
  slug: string;
  accountId: string;
  username: string;
  name: string;
  alreadyMember: boolean;
}> {
  const row = await prisma.projectList.findUnique({ where: { slug } });
  if (!row) throw new Error("list_not_found");

  const usernameRaw = input.username?.trim().replace(/^@/, "");
  const idRaw = input.accountId?.trim();
  if (!usernameRaw && !idRaw) throw new Error("username_or_account_id_required");

  const { getListClient } = await import("../twitter/getClient.js");
  const { client, accountId: authId } = await getListClient(row.authAccountId);

  let twitterUserId = idRaw ?? "";
  let username = usernameRaw ?? "";
  let name = username;
  let description: string | null = null;
  let followersCount: number | null = null;
  let followingCount: number | null = null;
  let tweetCount: number | null = null;
  let profileImageUrl: string | null = null;
  let isBlueVerified: boolean | null = null;
  let createdAt: Date | null = null;

  if (usernameRaw) {
    const res = await client.getUserByScreenName(usernameRaw);
    if (res.rateLimit && res.rateLimit.remaining === 0) {
      await markRateLimited(authId, res.rateLimit.reset);
    }
    if (!res.success || !res.user) {
      throw new Error(res.error ?? "user_not_found");
    }
    const u = res.user;
    twitterUserId = u.id;
    username = u.username;
    name = u.name ?? u.username;
    description = u.description ?? null;
    followersCount = u.followersCount ?? null;
    followingCount = u.followingCount ?? null;
    tweetCount = u.tweetCount ?? null;
    profileImageUrl = u.profileImageUrl ?? null;
    isBlueVerified = u.isBlueVerified ?? null;
    createdAt = u.createdAt ? new Date(u.createdAt) : null;
  } else if (idRaw) {
    // Resolve profile if we only have id (best-effort).
    const existing = await prisma.twitterAccount.findUnique({
      where: { id: idRaw },
    });
    if (existing) {
      twitterUserId = existing.id;
      username = existing.username;
      name = existing.name;
    } else {
      twitterUserId = idRaw;
      username = idRaw;
      name = idRaw;
    }
  }

  if (!twitterUserId) throw new Error("user_not_found");

  await prisma.twitterAccount.upsert({
    where: { id: twitterUserId },
    create: {
      id: twitterUserId,
      username,
      name,
      description,
      followersCount,
      followingCount,
      tweetCount,
      profileImageUrl,
      isBlueVerified,
      createdAt,
      tags: [],
    },
    update: {
      username,
      name,
      ...(description != null ? { description } : {}),
      ...(followersCount != null ? { followersCount } : {}),
      ...(followingCount != null ? { followingCount } : {}),
      ...(tweetCount != null ? { tweetCount } : {}),
      ...(profileImageUrl != null ? { profileImageUrl } : {}),
      ...(isBlueVerified != null ? { isBlueVerified } : {}),
    },
  });

  const already = await prisma.listMember.findUnique({
    where: {
      listSlug_accountId: { listSlug: slug, accountId: twitterUserId },
    },
  });
  if (already) {
    return {
      slug,
      accountId: twitterUserId,
      username,
      name,
      alreadyMember: true,
    };
  }

  const res = await client.addListMember(row.twitterListId, twitterUserId);
  if (res.rateLimit && res.rateLimit.remaining === 0) {
    await markRateLimited(authId, res.rateLimit.reset);
  }
  if (!res.success) {
    if (isListDailyAddLimitError(res.error)) {
      const until = nextUtcDayReset();
      await markRateLimitedUntil(authId, until);
      throw new ListDailyAddLimitError(authId, res.error ?? "daily list add limit");
    }
    throw new Error(res.error ?? "addListMember_failed");
  }

  await prisma.listMember.create({
    data: { listSlug: slug, accountId: twitterUserId },
  });

  return {
    slug,
    accountId: twitterUserId,
    username,
    name,
    alreadyMember: false,
  };
}

/**
 * Admin: remove a member from an owned list (Twitter + local ListMember).
 * Keeps the TwitterAccount row (project may still exist elsewhere).
 */
export async function removeMemberFromProjectList(
  slug: string,
  accountId: string,
): Promise<{ slug: string; accountId: string; twitterRemoved: boolean }> {
  const row = await prisma.projectList.findUnique({ where: { slug } });
  if (!row) throw new Error("list_not_found");

  const member = await prisma.listMember.findUnique({
    where: { listSlug_accountId: { listSlug: slug, accountId } },
  });
  if (!member) throw new Error("member_not_found");

  const { getListClient } = await import("../twitter/getClient.js");
  const { client, accountId: authId } = await getListClient(row.authAccountId);

  let twitterRemoved = false;
  const res = await client.removeListMember(row.twitterListId, accountId);
  if (res.rateLimit && res.rateLimit.remaining === 0) {
    await markRateLimited(authId, res.rateLimit.reset);
  }
  if (res.success) {
    twitterRemoved = true;
  } else {
    const err = (res.error ?? "").toLowerCase();
    const gone =
      err.includes("not found") ||
      err.includes("not a member") ||
      err.includes("does not exist");
    if (!gone) {
      throw new Error(res.error ?? "removeListMember_failed");
    }
  }

  await prisma.listMember.delete({
    where: { listSlug_accountId: { listSlug: slug, accountId } },
  });

  return { slug, accountId, twitterRemoved };
}

/**
 * Resolve an existing ProjectList for a slug. NEVER creates a Twitter list —
 * creation is admin-only via `createProjectList`. Worker/reconcile only attach
 * members to lists that already exist in the DB.
 */
export async function ensureList(
  _ctx: ListSyncCtx,
  slug: string,
): Promise<string | null> {
  const cached = listIdCache.get(slug);
  if (cached && resolvedSlugs.has(slug)) return cached;

  const existing = await prisma.projectList.findUnique({
    where: { slug },
    select: { twitterListId: true },
  });
  if (!existing) {
    // No admin-created list for this slug — skip silently (do not auto-create).
    return null;
  }

  listIdCache.set(slug, existing.twitterListId);
  resolvedSlugs.add(slug);
  return existing.twitterListId;
}

/**
 * Twitter daily list-add cap (not ownership).
 * Typical message: "You aren't allowed to add this member to this List."
 * Distinct from ownership: "…add members to this list" (plural / list-level).
 */
export function isListDailyAddLimitError(error?: string): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  if (/this member/i.test(error) && /allowed to add/i.test(error)) return true;
  if (/daily.?limit|add.?limit|limit.?reached|too many.*member/i.test(e)) return true;
  return false;
}

/** Does an error indicate the operating account doesn't own the list? */
function isOwnershipError(error?: string): boolean {
  if (!error || isListDailyAddLimitError(error)) return false;
  return /allowed to add members|not authorized|Authorization/i.test(error);
}

/** Thrown when Twitter daily list-member add limit is hit — retry tomorrow. */
export class ListDailyAddLimitError extends Error {
  constructor(
    public readonly authAccountId: bigint,
    message: string,
  ) {
    super(message);
    this.name = "ListDailyAddLimitError";
  }
}

/** Pause list-owner auth until next UTC day and rethrow as ListDailyAddLimitError. */
async function hitDailyAddLimit(ctx: ListSyncCtx, error: string): Promise<never> {
  const until = nextUtcDayReset();
  await markRateLimitedUntil(ctx.authAccountId, until);
  console.warn(
    `[lists] daily list-add limit reached for auth ${ctx.authAccountId} — ` +
      `pausing until ${until.toISOString()} (try again tomorrow). Error: ${error}`,
  );
  throw new ListDailyAddLimitError(ctx.authAccountId, error);
}

/** Add an account to a list on Twitter and mirror it locally. */
async function addToList(
  ctx: ListSyncCtx,
  slug: string,
  accountId: string,
): Promise<boolean> {
  const listId = await ensureList(ctx, slug);
  if (!listId) {
    // List was never created in admin — wait for createProjectList.
    return false;
  }
  console.log(`[lists] adding ${accountId} to ${slug} (${listId})`);
  const res = await ctx.client.addListMember(listId, accountId);
  await noteRateLimit(ctx, res.rateLimit);

  if (!res.success) {
    if (isListDailyAddLimitError(res.error)) {
      await hitDailyAddLimit(ctx, res.error ?? "daily list add limit");
    }
    if (isOwnershipError(res.error)) {
      console.warn(
        `[lists] ${slug} not owned by current auth (list owner must match create-time auth account) — ` +
          `${res.error ?? "ownership error"}`,
      );
    } else {
      console.warn(
        `[lists] addListMember ${slug} <- ${accountId} failed: ${res.error ?? "unknown"}`,
      );
    }
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
 *
 * If Twitter daily list-add limit is hit, throws ListDailyAddLimitError and does
 * NOT stamp listsSyncedAt so this account is retried tomorrow.
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

  try {
    for (const slug of desired) {
      if (!currentSet.has(slug) && (await addToList(ctx, slug, account.id))) {
        added.push(slug);
      }
    }
  } catch (err) {
    // Daily limit: leave listsSyncedAt unset so we retry after reset.
    if (err instanceof ListDailyAddLimitError) throw err;
    throw err;
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
    select: { id: true, tags: true, username: true },
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

/**
 * Admin / manual tag set: replace an account's tags with the given list, then
 * reconcile Twitter list memberships. Dedupes and drops empty strings.
 * Pass `ctx` null to only update the DB (list sync deferred).
 */
export async function setAccountTags(
  accountId: string,
  rawTags: string[],
  ctx: ListSyncCtx | null,
): Promise<{ tags: string[]; added: string[]; removed: string[] } | null> {
  const account = await prisma.twitterAccount.findUnique({
    where: { id: accountId },
    select: { id: true, username: true, tags: true },
  });
  if (!account) return null;

  const tags = [...new Set(rawTags.map((t) => t.trim()).filter(Boolean))];
  if (tags.length === 0) return null;

  await prisma.twitterAccount.update({
    where: { id: accountId },
    data: { tags },
  });

  if (!ctx) {
    return { tags, added: [], removed: [] };
  }

  const { added, removed } = await reconcileAccountLists(ctx, {
    id: accountId,
    tags,
  });
  return { tags, added, removed };
}
