import { prisma } from "../db/prisma.js";
import { TwitterClient } from "../TwitterClient/index.js";

// Cache of auth-account id -> owner Twitter user id (never changes per account).
const ownerUserIdCache = new Map<string, string>();

export async function getTwitterClient(): Promise<{
  client: TwitterClient;
  accountId: bigint;
}> {
  const account = await prisma.twitterAuthAccount.findFirst({
    where: {
      isActive: true,
      OR: [
        { rateLimitedUntil: null },
        { rateLimitedUntil: { lt: new Date() } },
      ],
    },
    orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } },
  });

  if (!account) {
    throw new Error(
      "No available Twitter auth accounts (all rate-limited or inactive)",
    );
  }

  await prisma.twitterAuthAccount.update({
    where: { id: account.id },
    data: { lastUsedAt: new Date() },
  });

  const client = new TwitterClient({
    cookies: { authToken: account.authToken, ct0: account.ct0 },
  });

  return { client, accountId: account.id };
}

export async function markRateLimited(
  accountId: bigint,
  resetEpoch: number,
): Promise<void> {
  await prisma.twitterAuthAccount.update({
    where: { id: accountId },
    data: { rateLimitedUntil: new Date(resetEpoch * 1000) },
  });
}

/**
 * Client pinned to ONE deterministic auth account for all Twitter List work.
 *
 * Twitter only lets a list's owner add/remove members, but `getTwitterClient()`
 * rotates accounts by last-used — so a list created by one account can't be
 * mutated by another (→ "You aren't allowed to add members to this list").
 * List create/add/remove must therefore always run as the same account.
 *
 * Selection: `LIST_OWNER_USERNAME` if set, else the lowest-id active account.
 * Rate-limit rotation is intentionally NOT applied here — consistency of owner
 * matters more; a 429 is handled by the caller via `markRateLimited` and retried
 * next cycle.
 */
export async function getListClient(): Promise<{
  client: TwitterClient;
  accountId: bigint;
  ownerUserId: string;
}> {
  const username = process.env.LIST_OWNER_USERNAME;
  const account = await prisma.twitterAuthAccount.findFirst({
    where: { isActive: true, ...(username ? { username } : {}) },
    orderBy: { id: "asc" },
  });

  if (!account) {
    throw new Error(
      username
        ? `No active Twitter auth account matches LIST_OWNER_USERNAME=${username}`
        : "No active Twitter auth account available for list operations",
    );
  }

  await prisma.twitterAuthAccount.update({
    where: { id: account.id },
    data: { lastUsedAt: new Date() },
  });

  const client = new TwitterClient({
    cookies: { authToken: account.authToken, ct0: account.ct0 },
  });

  // The owner's Twitter user id lets list code verify it actually owns a stored
  // list before mutating it. Cached per auth account — it never changes.
  let ownerUserId = ownerUserIdCache.get(account.id.toString()) ?? "";
  if (!ownerUserId) {
    const me = await client.getCurrentUser();
    if (me.success && me.user) {
      ownerUserId = me.user.id;
      ownerUserIdCache.set(account.id.toString(), ownerUserId);
    } else {
      console.warn(`[lists] could not resolve owner user id: ${me.error ?? "unknown"}`);
    }
  }

  return { client, accountId: account.id, ownerUserId };
}
