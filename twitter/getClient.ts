import { prisma } from "../db/prisma.js";
import { TwitterClient } from "../TwitterClient/index.js";

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
