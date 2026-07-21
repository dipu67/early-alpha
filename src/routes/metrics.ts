// Metrics router — aggregate stats for the overview dashboard. Counts are direct
// Prisma; time-series use raw SQL date_trunc for per-day grouping.
//
// Canonical sources: SeedAccount / FollowEdge / Alert (convergence) / PostAlert.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../middleware/error.js";
import { jsonSafe } from "../http.js";

export const metricsRouter: Router = Router();

metricsRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const now = new Date();
    const [
      projects,
      taggedProjects,
      activeSeeds,
      inactiveSeeds,
      edgesActive,
      newEdges24h,
      convergence24h,
      lists,
      members,
      signals24h,
      authActive,
      authRateLimited,
      hotProjects,
      lastRun,
    ] = await Promise.all([
      prisma.twitterAccount.count(),
      prisma.twitterAccount.count({ where: { NOT: { tags: { has: "unknown" } } } }),
      prisma.seedAccount.count({ where: { active: true } }),
      prisma.seedAccount.count({ where: { active: false } }),
      prisma.followEdge.count({ where: { active: true } }),
      prisma.followEdge.count({
        where: { active: true, firstSeenAt: { gte: since24h } },
      }),
      prisma.alert.count({
        where: { alertType: "convergence", createdAt: { gte: since24h } },
      }),
      prisma.projectList.count(),
      prisma.listMember.count(),
      prisma.postAlert.count({ where: { createdAt: { gte: since24h } } }),
      prisma.twitterAuthAccount.count({ where: { isActive: true } }),
      prisma.twitterAuthAccount.count({ where: { rateLimitedUntil: { gt: now } } }),
      prisma.twitterAccount.count({ where: { huntStage: "hot" } }),
      prisma.trackingRun.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);

    res.json(
      jsonSafe({
        projects,
        taggedProjects,
        activeSeeds,
        inactiveSeeds,
        edgesActive,
        newEdges24h,
        convergence24h,
        hotProjects,
        lists,
        listMembers: members,
        signals24h,
        authActive,
        authRateLimited,
        lastSeedRun: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status,
              startedAt: lastRun.startedAt,
              finishedAt: lastRun.finishedAt,
              seedsProcessed: lastRun.seedsProcessed,
              newFollowEdges: lastRun.newFollowEdges,
            }
          : null,
      }),
    );
  }),
);

const tsQuery = z.object({
  metric: z
    .enum(["signals", "follows", "edges", "convergence"])
    .default("signals"),
  days: z.coerce.number().int().min(1).max(90).default(14),
});

metricsRouter.get(
  "/timeseries",
  asyncHandler(async (req, res) => {
    const { metric, days } = tsQuery.parse(req.query);

    // Canonical tables only (no legacy alert_logs for "follows").
    // "follows" alias → follow_edges for backward-compatible chart labels.
    let table: string;
    let tsCol: string;
    let extraWhere = "";
    if (metric === "signals") {
      table = "post_alerts";
      tsCol = "created_at";
    } else if (metric === "convergence") {
      table = "alerts";
      tsCol = "created_at";
      extraWhere = ` AND "alert_type" = 'convergence'`;
    } else {
      // follows | edges
      table = "follow_edges";
      tsCol = "first_seen_at";
      extraWhere = ` AND "active" = true`;
    }

    const rows = await prisma.$queryRawUnsafe<{ day: Date; count: bigint }[]>(
      `SELECT date_trunc('day', "${tsCol}") AS day, count(*)::bigint AS count
         FROM "${table}"
        WHERE "${tsCol}" >= now() - ($1 || ' days')::interval${extraWhere}
        GROUP BY 1
        ORDER BY 1 ASC`,
      String(days),
    );

    res.json({
      metric,
      days,
      points: rows.map((r) => ({
        day:
          r.day instanceof Date
            ? r.day.toISOString().slice(0, 10)
            : String(r.day),
        count: Number(r.count),
      })),
    });
  }),
);

metricsRouter.get(
  "/tag-distribution",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.$queryRawUnsafe<{ tag: string; count: bigint }[]>(
      `SELECT unnest(tags) AS tag, count(*)::bigint AS count
         FROM "twitter_accounts"
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 20`,
    );
    res.json({
      items: rows.map((r) => ({ tag: r.tag, count: Number(r.count) })),
    });
  }),
);

const activityQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

metricsRouter.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const { limit } = activityQuery.parse(req.query);
    const [signals, edges, convergence] = await Promise.all([
      prisma.postAlert.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          tweetId: true,
          username: true,
          slug: true,
          signals: true,
          createdAt: true,
        },
      }),
      prisma.followEdge.findMany({
        where: { active: true },
        orderBy: { firstSeenAt: "desc" },
        take: limit,
        select: {
          followingId: true,
          firstSeenAt: true,
          following: { select: { username: true } },
          seed: { select: { username: true } },
        },
      }),
      prisma.alert.findMany({
        where: { alertType: "convergence" },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          followingId: true,
          seedUsernames: true,
          score: true,
          createdAt: true,
          following: { select: { username: true } },
        },
      }),
    ]);

    const items = [
      ...signals.map((s) => ({
        type: "signal" as const,
        id: s.tweetId,
        username: s.username,
        slug: s.slug,
        signals: s.signals,
        at: s.createdAt,
      })),
      ...edges.map((e) => ({
        type: "follow" as const,
        id: `${e.followingId}-${e.firstSeenAt.toISOString()}`,
        username: e.following.username,
        seed: e.seed.username,
        at: e.firstSeenAt,
      })),
      ...convergence.map((a) => ({
        type: "convergence" as const,
        id: a.id.toString(),
        username: a.following.username,
        seeds: a.seedUsernames,
        score: a.score,
        at: a.createdAt,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, limit);

    res.json({ items: jsonSafe(items) });
  }),
);
