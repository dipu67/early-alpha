// Watchlist + tracking control router.
//
//   GET    /watchlist              -> watched accounts + last snapshot time
//   POST   /watchlist              -> add by username (resolves via TwitterClient)
//   POST   /watchlist/:id/deactivate -> soft-stop (isActive=false, remove scheduler)
//   DELETE /watchlist/:id            -> hard remove (row + snapshots/alerts + scheduler)
//   POST   /watchlist/:id/track-now  -> re-activate + enqueue immediate follow check
//
// POST accepts username only. We call getUserByScreenName to resolve the Twitter
// user id, upsert the profile, register the 5-min scheduler, and activate.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { paginationSchema, jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import { getTwitterClient, markRateLimited } from "../twitter/getClient.js";
import { addWatchJob, removeWatchJob } from "../services/queue.js";
import { classifyAccount } from "../services/projectTagger.js";
import type { UserData } from "../TwitterClient/types.js";

export const watchlistRouter: Router = Router();

watchlistRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = paginationSchema.parse(req.query);
    const [items, total] = await Promise.all([
      prisma.watchList.findMany({
        orderBy: { createdAt: "desc" },
        take: q.limit,
        skip: q.offset,
        include: {
          snapshots: { orderBy: { takenAt: "desc" }, take: 1, select: { takenAt: true } },
          _count: { select: { alertLogs: true } },
        },
      }),
      prisma.watchList.count(),
    ]);
    res.json({
      total,
      limit: q.limit,
      offset: q.offset,
      items: jsonSafe(
        items.map((w) => ({
          id: w.id,
          username: w.username,
          twitterUserId: w.twitterUserId,
          isActive: w.isActive,
          lastSnapshotAt: w.snapshots[0]?.takenAt ?? null,
          alertCount: w._count.alertLogs,
          createdAt: w.createdAt,
        })),
      ),
    });
  }),
);

const addBody = z.object({
  username: z.string().min(1),
  /** Optional override; if omitted we resolve via getUserByScreenName. */
  twitterUserId: z.string().min(1).optional(),
  addedBy: z.string().optional(),
});

watchlistRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = addBody.parse(req.body);
    const screenName = body.username.replace(/^@/, "").trim();

    if (!/^[A-Za-z0-9_]{1,15}$/.test(screenName)) {
      throw new HttpError(400, "invalid_username");
    }

    const usernameKey = screenName.toLowerCase();
    const existing = await prisma.watchList.findUnique({
      where: { username: usernameKey },
    });
    if (existing?.isActive) {
      throw new HttpError(409, "already_watching");
    }

    let twitterUserId = body.twitterUserId?.trim();
    let resolvedUsername = usernameKey;
    let profile: UserData | null = null;

    if (!twitterUserId) {
      const { client, accountId } = await getTwitterClient();
      const result = await client.getUserByScreenName(screenName);

      if (result.rateLimit && result.rateLimit.remaining === 0) {
        await markRateLimited(accountId, result.rateLimit.reset);
      }

      if (!result.success || !result.user) {
        throw new HttpError(
          404,
          result.error ? `user_not_found: ${result.error}` : "user_not_found",
        );
      }

      profile = result.user;
      twitterUserId = result.user.id;
      resolvedUsername = result.user.username.toLowerCase();
    }

    const watchEntry = existing
      ? await prisma.watchList.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            twitterUserId,
            username: resolvedUsername,
          },
        })
      : await prisma.watchList.create({
          data: {
            twitterUserId,
            username: resolvedUsername,
            addedBy: body.addedBy ?? "admin-api",
            isActive: true,
          },
        });

    // Mirror profile into twitter_accounts when we fetched it (same as /watch bot).
    if (profile) {
      const tags = await classifyAccount(profile);
      await prisma.twitterAccount.upsert({
        where: { id: profile.id },
        create: {
          id: profile.id,
          username: profile.username,
          name: profile.name,
          description: profile.description ?? null,
          tags,
          followersCount: profile.followersCount ?? null,
          followingCount: profile.followingCount ?? null,
          isBlueVerified: profile.isBlueVerified ?? null,
          profileImageUrl: profile.profileImageUrl ?? null,
          createdAt: profile.createdAt ? new Date(profile.createdAt) : null,
        },
        update: {
          username: profile.username,
          name: profile.name,
          description: profile.description ?? null,
          tags,
          followersCount: profile.followersCount ?? null,
          followingCount: profile.followingCount ?? null,
          isBlueVerified: profile.isBlueVerified ?? null,
          profileImageUrl: profile.profileImageUrl ?? null,
        },
      });
    }

    await addWatchJob(watchEntry.id, resolvedUsername);

    res.status(201).json(
      jsonSafe({
        ...watchEntry,
        name: profile?.name ?? null,
        followersCount: profile?.followersCount ?? null,
      }),
    );
  }),
);

watchlistRouter.post(
  "/:id/deactivate",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const row = await prisma.watchList
      .update({ where: { id }, data: { isActive: false } })
      .catch(() => null);
    if (!row) throw new HttpError(404, "watchlist entry not found");
    await removeWatchJob(id).catch(() => undefined);
    res.json(jsonSafe(row));
  }),
);

watchlistRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const existing = await prisma.watchList.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "watchlist entry not found");

    // Stop the 5-min scheduler first so no job fires after the row is gone.
    await removeWatchJob(id).catch(() => undefined);

    // Hard delete — FollowSnapshot + AlertLog cascade via schema onDelete.
    const row = await prisma.watchList.delete({ where: { id } });
    res.json(jsonSafe({ deleted: true, id: row.id, username: row.username }));
  }),
);

watchlistRouter.post(
  "/:id/track-now",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const entry = await prisma.watchList.findUnique({ where: { id } });
    if (!entry) throw new HttpError(404, "watchlist entry not found");
    await prisma.watchList.update({ where: { id }, data: { isActive: true } });
    // Re-register the recurring scheduler when reactivating.
    await addWatchJob(entry.id, entry.username);
    const result = await enqueueJob("track-now", {
      watchListId: entry.id.toString(),
      username: entry.username,
    });
    res.status(202).json({ enqueued: true, ...result });
  }),
);

/** Parse a path param into a BigInt id, 400 on garbage. */
function parseBigId(raw: string | string[] | undefined): bigint {
  const s = Array.isArray(raw) ? raw[0] : raw;
  try {
    return BigInt(s ?? "");
  } catch {
    throw new HttpError(400, `invalid id: ${String(s)}`);
  }
}
