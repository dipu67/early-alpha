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

/**
 * Pin a specific auth-pool account as the Twitter client (e.g. per search query).
 * Falls back to rotating pool if `authAccountId` is null/undefined.
 * Throws if the pinned account is missing or inactive.
 */
export async function getTwitterClientById(
  authAccountId?: bigint | null,
): Promise<{ client: TwitterClient; accountId: bigint; username: string }> {
  if (authAccountId == null) {
    const rotated = await getTwitterClient();
    const row = await prisma.twitterAuthAccount.findUnique({
      where: { id: rotated.accountId },
      select: { username: true },
    });
    return {
      client: rotated.client,
      accountId: rotated.accountId,
      username: row?.username ?? "unknown",
    };
  }

  const account = await prisma.twitterAuthAccount.findFirst({
    where: { id: authAccountId, isActive: true },
  });
  if (!account) {
    throw new Error(`Auth account ${authAccountId} not found or inactive`);
  }

  await prisma.twitterAuthAccount.update({
    where: { id: account.id },
    data: { lastUsedAt: new Date() },
  });

  const client = new TwitterClient({
    cookies: { authToken: account.authToken, ct0: account.ct0 },
  });

  return { client, accountId: account.id, username: account.username };
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
 * Confirmed dead session (Twitter code 32 / "Could not authenticate you").
 *
 * Soft-pauses via rateLimitedUntil so the pool rotates away without flipping
 * isActive=false (that was fighting admin "Activate" and leaving only one
 * usable account). Re-add fresh auth_token+ct0 to recover permanently.
 *
 * Set AUTH_HARD_DEACTIVATE=1 to permanently set isActive=false (old behavior).
 */
export async function markAuthInvalid(
  accountId: bigint,
  reason: string,
): Promise<void> {
  const hard = process.env.AUTH_HARD_DEACTIVATE === "1";
  const pauseMs = Number(process.env.AUTH_INVALID_PAUSE_MS ?? 2 * 60 * 60 * 1000); // 2h
  const until = new Date(Date.now() + Math.max(pauseMs, 60_000));

  console.warn(
    `[auth] ${hard ? "deactivating" : "pausing"} account ${accountId} until ${until.toISOString()} ` +
      `(dead session): ${reason.slice(0, 200)}`,
  );

  await prisma.twitterAuthAccount
    .update({
      where: { id: accountId },
      data: hard
        ? { isActive: false, rateLimitedUntil: until }
        : { rateLimitedUntil: until },
    })
    .catch((err) => {
      console.error(`[auth] markAuthInvalid failed for ${accountId}:`, err);
    });
}

/** Pause an auth account until a Date (e.g. list daily-add limit → try tomorrow). */
export async function markRateLimitedUntil(
  accountId: bigint,
  until: Date,
): Promise<void> {
  await prisma.twitterAuthAccount.update({
    where: { id: accountId },
    data: { rateLimitedUntil: until },
  });
}

/** Next UTC midnight + 5 minutes — when Twitter daily list-add caps typically reset. */
export function nextUtcDayReset(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 5, 0, 0);
  return d;
}

/**
 * Client pinned to ONE deterministic auth account for Twitter List work.
 *
 * Twitter only lets a list's owner add/remove members, so create/add/remove must
 * always run as the same account that owns the list.
 *
 * Selection when `authAccountId` is omitted: lowest-id active auth account.
 * Prefer passing ProjectList.authAccountId so the list owner is correct.
 */
export async function getListClient(authAccountId?: bigint | null): Promise<{
  client: TwitterClient;
  accountId: bigint;
  ownerUserId: string;
  username: string;
}> {
  let account;
  if (authAccountId != null) {
    account = await prisma.twitterAuthAccount.findFirst({
      where: { id: authAccountId, isActive: true },
    });
    if (!account) {
      throw new Error(`List auth account ${authAccountId} not found or inactive`);
    }
  } else {
    account = await prisma.twitterAuthAccount.findFirst({
      where: { isActive: true },
      orderBy: { id: "asc" },
    });
    if (!account) {
      throw new Error(
        "No active Twitter auth account available for list operations",
      );
    }
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

  return {
    client,
    accountId: account.id,
    ownerUserId,
    username: account.username,
  };
}
