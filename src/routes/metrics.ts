// Metrics router — aggregate stats for the overview dashboard. Counts are direct
// Prisma; time-series use raw SQL date_trunc for per-day grouping.

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
      activeWatch,
      lists,
      members,
      signals24h,
      authActive,
      authRateLimited,
    ] = await Promise.all([
      prisma.twitterAccount.count(),
      prisma.twitterAccount.count({ where: { NOT: { tags: { has: "unknown" } } } }),
      prisma.watchList.count({ where: { isActive: true } }),
      prisma.projectList.count(),
      prisma.listMember.count(),
      prisma.postAlert.count({ where: { createdAt: { gte: since24h } } }),
      prisma.twitterAuthAccount.count({ where: { isActive: true } }),
      prisma.twitterAuthAccount.count({ where: { rateLimitedUntil: { gt: now } } }),
    ]);

    res.json({
      projects,
      taggedProjects,
      activeWatch,
      lists,
      listMembers: members,
      signals24h,
      authActive,
      authRateLimited,
    });
  }),
);

const tsQuery = z.object({
  metric: z.enum(["signals", "follows"]).default("signals"),
  days: z.coerce.number().int().min(1).max(90).default(14),
});

metricsRouter.get(
  "/timeseries",
  asyncHandler(async (req, res) => {
    const { metric, days } = tsQuery.parse(req.query);
    const table = metric === "signals" ? "post_alerts" : "alert_logs";
    const tsCol = metric === "signals" ? "created_at" : "sent_at";

    // Per-day counts for the last N days. Table/column are from a fixed allowlist
    // above, never user input, so interpolating them is safe.
    const rows = await prisma.$queryRawUnsafe<{ day: Date; count: bigint }[]>(
      `SELECT date_trunc('day', "${tsCol}") AS day, count(*)::bigint AS count
         FROM "${table}"
        WHERE "${tsCol}" >= now() - ($1 || ' days')::interval
        GROUP BY 1
        ORDER BY 1 ASC`,
      String(days),
    );

    res.json({
      metric,
      days,
      points: rows.map((r) => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
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

const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

metricsRouter.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const { limit } = activityQuery.parse(req.query);
    const [signals, follows] = await Promise.all([
      prisma.postAlert.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { tweetId: true, username: true, slug: true, signals: true, createdAt: true },
      }),
      prisma.alertLog.findMany({
        orderBy: { sentAt: "desc" },
        take: limit,
        select: { id: true, newFollowUsername: true, sentAt: true },
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
      ...follows.map((f) => ({
        type: "follow" as const,
        id: f.id.toString(),
        username: f.newFollowUsername,
        at: f.sentAt,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, limit);

    res.json({ items: jsonSafe(items) });
  }),
);
