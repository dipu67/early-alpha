import { prisma } from "../db/prisma.js";
import {
  getTwitterClient,
  markRateLimited,
  markAuthInvalid,
} from "../twitter/getClient.js";
import { isTwitterAuthError } from "../TwitterClient/TwitterClient.js";
import type { UserData } from "../TwitterClient/types.js";
import { classifyAccount } from "./projectTagger.js";
import { isEarlyProjectCandidate } from "./earlyProjectFilter.js";

export interface DiffResult {
  /** Every newly followed account (alert on all of these). */
  newFollows: UserData[];
  /** Subset of newFollows that look early — only these were written to TwitterAccount. */
  storedFollows: UserData[];
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
  client.getUsersByIds
  if (result.rateLimit && result.rateLimit.remaining === 0) {
    await markRateLimited(accountId, result.rateLimit.reset);
  }

  if (!result.success || !result.users) {
    const errText = result.error ?? "Unknown error";
    // Dead auth_token/ct0 — drop from pool so we don't hammer the same cookies
    if (isTwitterAuthError(errText)) {
      await markAuthInvalid(accountId, errText);
    }
    throw new Error(
      `Failed to fetch following for @${entry.username}: ${errText}`,
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
    return {
      newFollows: [],
      storedFollows: [],
      watchListId,
      username: entry.username,
    };
  }

  const previousIds = new Set(latestSnapshot.userIds);
  const newFollows = result.users.filter((u) => !previousIds.has(u.id));

  if (newFollows.length === 0) {
    return {
      newFollows: [],
      storedFollows: [],
      watchListId,
      username: entry.username,
    };
  }

  // Always return every new follow for alerting. Only upsert early-looking
  // accounts into TwitterAccount (age ≤ 1y, followers/following < 50k).
  const storedFollows: UserData[] = [];
  for (const user of newFollows) {
    if (!isEarlyProjectCandidate(user)) continue;

    const tags = await classifyAccount(user);
    await prisma.twitterAccount.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        username: user.username,
        name: user.name,
        description: user.description ?? null,
        tags,
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
        tags,
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
    storedFollows.push(user);
  }

  return { newFollows, storedFollows, watchListId, username: entry.username };
}
