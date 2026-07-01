import { prisma } from "../db/prisma.js";
import { getTwitterClient, markRateLimited } from "../twitter/getClient.js";
import type { UserData } from "../TwitterClient/TwitterClient.js";

export interface DiffResult {
  newFollows: UserData[];
  watchListId: bigint;
  username: string;
}

export async function checkFollowingDiff(
  watchListId: bigint,
): Promise<DiffResult> {
  const entry = await prisma.watchList.findUniqueOrThrow({
    where: { id: watchListId },
  });

  const { client, accountId } = await getTwitterClient();
  const result = await client.getFollowing(entry.twitterUserId, 20);

  if (result.rateLimit && result.rateLimit.remaining === 0) {
    await markRateLimited(accountId, result.rateLimit.reset);
  }

  if (!result.success || !result.users) {
    throw new Error(  
      `Failed to fetch following for @${entry.username}: ${result.error ?? "Unknown error"}`,
    );
  }

  const currentIds = result.users.map((u) => u.id);

  const latestSnapshot = await prisma.followSnapshot.findFirst({
    where: { watchListId },
    orderBy: { takenAt: "desc" },
  });

  await prisma.followSnapshot.create({
    data: {
      watchListId,
      userIds: currentIds,
    },
  });

  if (!latestSnapshot) {
    return { newFollows: [], watchListId, username: entry.username };
  }

  const previousIds = new Set(latestSnapshot.userIds);
  const newFollows = result.users.filter((u) => !previousIds.has(u.id));

  if (newFollows.length === 0) {
    return { newFollows: [], watchListId, username: entry.username };
  }

  for (const user of newFollows) {
    await prisma.twitterAccount.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        username: user.username,
        name: user.name,
        description: user.description ?? null,
        followersCount: user.followersCount ?? null,
        followingCount: user.followingCount ?? null,
        tweetCount: user.tweetCount ?? null,
        likeCount: user.likeCount ?? null,
        isBlueVerified: user.isBlueVerified ?? null,
        profileImageUrl: user.profileImageUrl ?? null,
        profileBannerUrl: user.profileBannerUrl ?? null,
        location: user.location ?? null,
        createdAt: user.createdAt ? new Date(user.createdAt) : null,
      },
      update: {
        username: user.username,
        name: user.name,
        description: user.description ?? null,
        followersCount: user.followersCount ?? null,
        followingCount: user.followingCount ?? null,
        tweetCount: user.tweetCount ?? null,
        likeCount: user.likeCount ?? null,
        isBlueVerified: user.isBlueVerified ?? null,
        profileImageUrl: user.profileImageUrl ?? null,
        profileBannerUrl: user.profileBannerUrl ?? null,
        location: user.location ?? null,
        createdAt: user.createdAt ? new Date(user.createdAt) : null,
      },
    });
  }

  return { newFollows, watchListId, username: entry.username };
}
