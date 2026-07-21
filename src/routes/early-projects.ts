// Early-project monitor API — pool status, growth board, manual poll / report.
//
//   GET  /early-projects/stats     pool size + last poll result + config snapshot
//   GET  /early-projects           list accounts in the early pool (paginated)
//   GET  /early-projects/growth    top growers (7d) without sending Telegram
//   POST /early-projects/poll      enqueue poll-early-projects
//   POST /early-projects/growth-report  enqueue weekly growth report

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../middleware/error.js";
import { paginationSchema, jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import { getConfig } from "../services/appConfig.js";
import {
  EARLY_MAX_FOLLOWERS,
  EARLY_MAX_AGE_MS,
} from "../services/earlyProjectFilter.js";
import { computeTopGrowingProjects } from "../services/growthReport.js";

export const earlyProjectsRouter: Router = Router();

const STALE_MS = Math.max(
  60_000,
  Number(process.env.EARLY_POLL_STALE_MS ?? 55 * 60 * 1000),
);
const MAX_AGE_MS = Number(process.env.EARLY_POLL_MAX_AGE_MS ?? EARLY_MAX_AGE_MS);
const MAX_FOLLOWERS = Number(
  process.env.EARLY_POLL_MAX_FOLLOWERS ?? EARLY_MAX_FOLLOWERS,
);
const BATCH = Math.min(100, Math.max(10, Number(process.env.EARLY_POLL_BATCH ?? 100)));
const MAX_BATCHES = Math.max(1, Number(process.env.EARLY_POLL_MAX_BATCHES ?? 10));
const MAX_TIMELINES = Math.max(
  1,
  Number(process.env.EARLY_POLL_MAX_TIMELINES ?? 40),
);

/** Shared WHERE for “in the early pool” (mirrors selectEarlyProjectIds loosely). */
function earlyPoolWhere() {
  const minCreated = new Date(Date.now() - MAX_AGE_MS);
  return {
    OR: [
      { huntStage: { in: ["soft", "hot"] } },
      { firstSeenAt: { gte: new Date(Date.now() - 90 * 86400 * 1000) } },
      {
        AND: [
          {
            OR: [
              { followersCount: { lte: MAX_FOLLOWERS } },
              { followersCount: null },
            ],
          },
          {
            OR: [
              { createdAt: { gte: minCreated } },
              { createdAt: null },
              { firstSeenAt: { gte: minCreated } },
            ],
          },
        ],
      },
    ],
  };
}

earlyProjectsRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const staleBefore = new Date(Date.now() - STALE_MS);
    const poolWhere = earlyPoolWhere();

    const [
      poolSize,
      dueNow,
      polled24h,
      renames7d,
      snapshots7d,
      hot,
      soft,
      lastResult,
      lastGrowth,
    ] = await Promise.all([
      prisma.twitterAccount.count({ where: poolWhere }),
      prisma.twitterAccount.count({
        where: {
          AND: [
            poolWhere,
            {
              OR: [
                { lastProfilePolledAt: null },
                { lastProfilePolledAt: { lte: staleBefore } },
              ],
            },
          ],
        },
      }),
      prisma.twitterAccount.count({
        where: {
          lastProfilePolledAt: {
            gte: new Date(Date.now() - 24 * 3600 * 1000),
          },
        },
      }),
      prisma.twitterAccount.count({
        where: {
          usernameChangedAt: {
            gte: new Date(Date.now() - 7 * 86400 * 1000),
          },
        },
      }),
      prisma.accountMetricSnapshot.count({
        where: {
          recordedAt: { gte: new Date(Date.now() - 7 * 86400 * 1000) },
        },
      }),
      prisma.twitterAccount.count({ where: { huntStage: "hot" } }),
      prisma.twitterAccount.count({ where: { huntStage: "soft" } }),
      getConfig<Record<string, unknown> | null>("earlyPoll.lastResult", null),
      getConfig<Record<string, unknown> | null>(
        "earlyPoll.lastGrowthReport",
        null,
      ),
    ]);

    res.json(
      jsonSafe({
        poolSize,
        dueNow,
        polled24h,
        renames7d,
        snapshots7d,
        hot,
        soft,
        lastPoll: lastResult,
        lastGrowthReport: lastGrowth,
        config: {
          staleMs: STALE_MS,
          maxAgeMs: MAX_AGE_MS,
          maxFollowers: MAX_FOLLOWERS,
          batchSize: BATCH,
          maxBatches: MAX_BATCHES,
          maxAccountsPerCycle: BATCH * MAX_BATCHES,
          maxTimelines: MAX_TIMELINES,
          pollEveryLabel: "1h",
        },
      }),
    );
  }),
);

const listQuery = paginationSchema.extend({
  stage: z.string().optional(),
  q: z.string().optional(),
  staleOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

earlyProjectsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const staleBefore = new Date(Date.now() - STALE_MS);

    const where = {
      AND: [
        earlyPoolWhere(),
        ...(q.stage ? [{ huntStage: q.stage }] : []),
        ...(q.staleOnly
          ? [
              {
                OR: [
                  { lastProfilePolledAt: null as Date | null },
                  { lastProfilePolledAt: { lte: staleBefore } },
                ],
              },
            ]
          : []),
        ...(q.q
          ? [
              {
                OR: [
                  {
                    username: {
                      contains: q.q.toLowerCase(),
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    name: { contains: q.q, mode: "insensitive" as const },
                  },
                ],
              },
            ]
          : []),
      ],
    };

    const [items, total] = await Promise.all([
      prisma.twitterAccount.findMany({
        where,
        orderBy: [
          { lastProfilePolledAt: { sort: "asc", nulls: "first" } },
          { firstSeenAt: "desc" },
        ],
        take: q.limit,
        skip: q.offset,
        select: {
          id: true,
          username: true,
          name: true,
          tags: true,
          followersCount: true,
          followersAtDetect: true,
          tweetCount: true,
          huntStage: true,
          firstSeenAt: true,
          lastProfilePolledAt: true,
          lastTweetId: true,
          previousUsername: true,
          usernameChangedAt: true,
          description: true,
        },
      }),
      prisma.twitterAccount.count({ where }),
    ]);

    res.json({
      total,
      limit: q.limit,
      offset: q.offset,
      items: jsonSafe(
        items.map((a) => ({
          ...a,
          growthFromDetect:
            a.followersCount != null && a.followersAtDetect != null
              ? a.followersCount - a.followersAtDetect
              : null,
          dueForPoll:
            !a.lastProfilePolledAt ||
            a.lastProfilePolledAt.getTime() <= staleBefore.getTime(),
        })),
      ),
    });
  }),
);

earlyProjectsRouter.get(
  "/growth",
  asyncHandler(async (req, res) => {
    const days = z.coerce.number().int().min(1).max(90).optional().parse(req.query.days) ?? 7;
    const top = z.coerce.number().int().min(1).max(100).optional().parse(req.query.top) ?? 20;
    const rows = await computeTopGrowingProjects({ days, top });
    res.json(
      jsonSafe({
        days,
        top,
        items: rows.map((r) => ({
          ...r,
          firstSeenAt: r.firstSeenAt.toISOString(),
        })),
      }),
    );
  }),
);

earlyProjectsRouter.post(
  "/poll",
  asyncHandler(async (_req, res) => {
    const result = await enqueueJob("poll-early-projects", {});
    res.json({ ok: true, ...result });
  }),
);

earlyProjectsRouter.post(
  "/growth-report",
  asyncHandler(async (_req, res) => {
    const result = await enqueueJob("growth-report", {});
    res.json({ ok: true, ...result });
  }),
);
