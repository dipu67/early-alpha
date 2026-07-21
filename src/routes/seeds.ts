// Seed accounts API — canonical smart-follow graph (SeedAccount + FollowEdge).
//
//   GET    /seeds                 list + edge counts + last edge time
//   GET    /seeds/stats           summary KPIs
//   GET    /seeds/categories      distinct categories in use + suggested
//   POST   /seeds                 add by username (resolves twitter id)
//   PATCH  /seeds/:id             update category / label / active
//   DELETE /seeds/:id             hard delete (edges cascade)
//   POST   /seeds/:id/resolve     re-fetch profile + twitter id
//   POST   /seeds/track           enqueue incremental seed track
//   POST   /seeds/track-full      enqueue full seed sync

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { paginationSchema, jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import { getTwitterClient, markRateLimited } from "../twitter/getClient.js";
import { classifyAccount } from "../services/projectTagger.js";
import type { UserData } from "../TwitterClient/types.js";

export const seedsRouter: Router = Router();

/** Suggested categories (free-form allowed). */
export const SUGGESTED_SEED_CATEGORIES = [
  "DeFi",
  "NFT",
  "L1",
  "L2",
  "GameFi",
  "VC",
  "Angel",
  "Founder",
  "CT",
  "AI",
  "Infra",
  "Other",
] as const;

function normalizeUsername(raw: string): string {
  return raw.replace(/^@/, "").trim().toLowerCase();
}

function isValidUsername(u: string): boolean {
  return /^[A-Za-z0-9_]{1,15}$/.test(u);
}

async function resolveTwitterUser(screenName: string): Promise<UserData> {
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
  return result.user;
}

async function upsertProfile(profile: UserData): Promise<void> {
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

const listQuery = paginationSchema.extend({
  active: z
    .enum(["true", "false", "all"])
    .optional()
    .default("all")
    .transform((v) => (v === "all" ? undefined : v === "true")),
  category: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
});

seedsRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const [
      total,
      active,
      inactive,
      missingTwitterId,
      edgesActive,
      newEdges24h,
      convergence24h,
      lastRun,
    ] = await Promise.all([
      prisma.seedAccount.count(),
      prisma.seedAccount.count({ where: { active: true } }),
      prisma.seedAccount.count({ where: { active: false } }),
      prisma.seedAccount.count({ where: { twitterId: null } }),
      prisma.followEdge.count({ where: { active: true } }),
      prisma.followEdge.count({
        where: { active: true, firstSeenAt: { gte: since24h } },
      }),
      prisma.alert.count({
        where: { alertType: "convergence", createdAt: { gte: since24h } },
      }),
      prisma.trackingRun.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);

    res.json(
      jsonSafe({
        total,
        active,
        inactive,
        missingTwitterId,
        edgesActive,
        newEdges24h,
        convergence24h,
        lastRun: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status,
              startedAt: lastRun.startedAt,
              finishedAt: lastRun.finishedAt,
              seedsProcessed: lastRun.seedsProcessed,
              accountsSeen: lastRun.accountsSeen,
              newFollowEdges: lastRun.newFollowEdges,
              error: lastRun.error,
            }
          : null,
      }),
    );
  }),
);

seedsRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.seedAccount.findMany({
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });
    const inUse = rows.map((r) => r.category);
    res.json({
      suggested: [...SUGGESTED_SEED_CATEGORIES],
      inUse,
    });
  }),
);

seedsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const where = {
      ...(q.active !== undefined ? { active: q.active } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.q
        ? {
            OR: [
              { username: { contains: q.q.toLowerCase(), mode: "insensitive" as const } },
              { label: { contains: q.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.seedAccount.findMany({
        where,
        orderBy: [{ active: "desc" }, { category: "asc" }, { username: "asc" }],
        take: q.limit,
        skip: q.offset,
        include: {
          _count: {
            select: {
              followEdges: { where: { active: true } },
            },
          },
          followEdges: {
            where: { active: true },
            orderBy: { firstSeenAt: "desc" },
            take: 1,
            select: { firstSeenAt: true, lastSeenAt: true },
          },
        },
      }),
      prisma.seedAccount.count({ where }),
    ]);

    res.json({
      total,
      limit: q.limit,
      offset: q.offset,
      items: jsonSafe(
        items.map((s) => ({
          id: s.id,
          username: s.username,
          twitterId: s.twitterId,
          category: s.category,
          label: s.label,
          active: s.active,
          edgeCount: s._count.followEdges,
          lastEdgeAt: s.followEdges[0]?.lastSeenAt ?? s.followEdges[0]?.firstSeenAt ?? null,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      ),
    });
  }),
);

const addBody = z.object({
  username: z.string().min(1),
  category: z.string().min(1).max(64),
  label: z.string().max(128).optional().nullable(),
  active: z.boolean().optional().default(true),
  /** Skip Twitter resolve when providing a known rest id. */
  twitterId: z.string().min(1).optional(),
});

seedsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = addBody.parse(req.body);
    const username = normalizeUsername(body.username);
    if (!isValidUsername(username)) {
      throw new HttpError(400, "invalid_username");
    }

    const existing = await prisma.seedAccount.findUnique({
      where: { username },
    });
    if (existing?.active) {
      throw new HttpError(409, "already_seed");
    }

    let twitterId = body.twitterId?.trim() ?? null;
    let profile: UserData | null = null;
    let resolvedUsername = username;

    if (!twitterId) {
      profile = await resolveTwitterUser(username);
      twitterId = profile.id;
      resolvedUsername = profile.username.toLowerCase();
      await upsertProfile(profile);
    }

    const seed = existing
      ? await prisma.seedAccount.update({
          where: { id: existing.id },
          data: {
            active: body.active,
            twitterId,
            username: resolvedUsername,
            category: body.category.trim(),
            label: body.label?.trim() || null,
          },
        })
      : await prisma.seedAccount.create({
          data: {
            username: resolvedUsername,
            twitterId,
            category: body.category.trim(),
            label: body.label?.trim() || null,
            active: body.active,
          },
        });

    res.status(existing ? 200 : 201).json(
      jsonSafe({
        ...seed,
        name: profile?.name ?? null,
        followersCount: profile?.followersCount ?? null,
      }),
    );
  }),
);

const patchBody = z.object({
  category: z.string().min(1).max(64).optional(),
  label: z.string().max(128).nullable().optional(),
  active: z.boolean().optional(),
});

seedsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = BigInt(String(req.params.id));
    const body = patchBody.parse(req.body);
    if (
      body.category === undefined &&
      body.label === undefined &&
      body.active === undefined
    ) {
      throw new HttpError(400, "no_fields");
    }

    const existing = await prisma.seedAccount.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "not_found");

    const seed = await prisma.seedAccount.update({
      where: { id },
      data: {
        ...(body.category !== undefined ? { category: body.category.trim() } : {}),
        ...(body.label !== undefined
          ? { label: body.label?.trim() || null }
          : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });

    res.json(jsonSafe(seed));
  }),
);

seedsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = BigInt(String(req.params.id));
    const existing = await prisma.seedAccount.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "not_found");

    // FollowEdge cascades via FK on seed delete.
    await prisma.seedAccount.delete({ where: { id } });
    res.json({ ok: true, id: id.toString(), username: existing.username });
  }),
);

seedsRouter.post(
  "/:id/resolve",
  asyncHandler(async (req, res) => {
    const id = BigInt(String(req.params.id));
    const existing = await prisma.seedAccount.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "not_found");

    const profile = await resolveTwitterUser(existing.username);
    await upsertProfile(profile);

    const seed = await prisma.seedAccount.update({
      where: { id },
      data: {
        twitterId: profile.id,
        username: profile.username.toLowerCase(),
      },
    });

    res.json(
      jsonSafe({
        ...seed,
        name: profile.name,
        followersCount: profile.followersCount ?? null,
      }),
    );
  }),
);

seedsRouter.post(
  "/track",
  asyncHandler(async (_req, res) => {
    const result = await enqueueJob("track-seeds", { fullSync: false });
    res.json({ ok: true, ...result });
  }),
);

seedsRouter.post(
  "/track-full",
  asyncHandler(async (_req, res) => {
    const result = await enqueueJob("track-seeds", { fullSync: true });
    res.json({ ok: true, ...result });
  }),
);
