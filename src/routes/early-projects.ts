// Early-project monitor API — pool status, growth board, manual poll / report.
//
//   GET  /early-projects/stats     pool size + last poll result + config snapshot
//   GET  /early-projects/config    live poller + detection rules + topics
//   PATCH /early-projects/config   update all knobs (settings table)
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
import {
  getConfig,
  setConfig,
  CONFIG_KEYS,
} from "../services/appConfig.js";
import { computeTopGrowingProjects } from "../services/growthReport.js";
import {
  resolveEarlyPollConfig,
  earlyPoolWhereFromConfig,
  type EarlyPollRuntimeConfig,
} from "../services/earlyProjectPoller.js";

export const earlyProjectsRouter: Router = Router();

function configView(cfg: EarlyPollRuntimeConfig) {
  return {
    batchSize: cfg.batchSize,
    maxBatches: cfg.maxBatches,
    maxAccountsPerCycle: cfg.maxAccountsPerCycle,
    maxTimelines: cfg.maxTimelines,
    delayMs: cfg.delayMs,
    staleMs: cfg.staleMs,
    snapshotMinMs: cfg.snapshotMinMs,
    // Detection rules
    maxFollowers: cfg.maxFollowers,
    maxFollowing: cfg.maxFollowing,
    maxAgeDays: cfg.maxAgeDays,
    maxAgeMs: cfg.maxAgeMs,
    firstSeenDays: cfg.firstSeenDays,
    includeSoftHot: cfg.includeSoftHot,
    strictEarlyOnly: cfg.strictEarlyOnly,
    // Topics + raw
    signalTopicId: cfg.signalTopicId,
    rawTopicId: cfg.rawTopicId,
    profileChangeTopicId: cfg.profileChangeTopicId,
    sendRawPosts: cfg.sendRawPosts,
    // Rate limit
    tweetReqBudget: cfg.tweetReqBudget,
    pollEveryLabel: "1h",
  };
}

earlyProjectsRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const cfg = await resolveEarlyPollConfig();
    const staleBefore = new Date(Date.now() - cfg.staleMs);
    const poolWhere = earlyPoolWhereFromConfig(cfg);

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
        config: configView(cfg),
      }),
    );
  }),
);

const configPatchSchema = z.object({
  // Poller
  batchSize: z.number().int().min(10).max(100).optional(),
  maxBatches: z.number().int().min(1).max(50).optional(),
  maxTimelines: z.number().int().min(0).max(500).optional(),
  delayMs: z.number().int().min(0).max(10_000).optional(),
  staleMs: z.number().int().min(60_000).max(7 * 86400_000).optional(),
  snapshotMinMs: z.number().int().min(60_000).max(7 * 86400_000).optional(),
  tweetReqBudget: z.number().int().min(5).max(1000).optional(),
  // Detection rules
  maxFollowers: z.number().int().min(100).max(5_000_000).optional(),
  maxFollowing: z.number().int().min(100).max(5_000_000).optional(),
  maxAgeDays: z.number().int().min(7).max(3650).optional(),
  firstSeenDays: z.number().int().min(1).max(3650).optional(),
  includeSoftHot: z.boolean().optional(),
  strictEarlyOnly: z.boolean().optional(),
  // Topics
  signalTopicId: z.number().int().nullable().optional(),
  rawTopicId: z.number().int().nullable().optional(),
  profileChangeTopicId: z.number().int().nullable().optional(),
  sendRawPosts: z.boolean().optional(),
});

earlyProjectsRouter.get(
  "/config",
  asyncHandler(async (_req, res) => {
    const cfg = await resolveEarlyPollConfig();
    res.json(jsonSafe(configView(cfg)));
  }),
);

earlyProjectsRouter.patch(
  "/config",
  asyncHandler(async (req, res) => {
    const body = configPatchSchema.parse(req.body ?? {});
    const writes: Promise<void>[] = [];

    const map: [keyof typeof body, string][] = [
      ["batchSize", CONFIG_KEYS.earlyPollBatch],
      ["maxBatches", CONFIG_KEYS.earlyPollMaxBatches],
      ["maxTimelines", CONFIG_KEYS.earlyPollMaxTimelines],
      ["delayMs", CONFIG_KEYS.earlyPollDelayMs],
      ["staleMs", CONFIG_KEYS.earlyPollStaleMs],
      ["snapshotMinMs", CONFIG_KEYS.earlyPollSnapshotMinMs],
      ["tweetReqBudget", CONFIG_KEYS.earlyPollTweetReqBudget],
      ["maxFollowers", CONFIG_KEYS.earlyPollMaxFollowers],
      ["maxFollowing", CONFIG_KEYS.earlyPollMaxFollowing],
      ["maxAgeDays", CONFIG_KEYS.earlyPollMaxAgeDays],
      ["firstSeenDays", CONFIG_KEYS.earlyPollFirstSeenDays],
      ["includeSoftHot", CONFIG_KEYS.earlyPollIncludeSoftHot],
      ["strictEarlyOnly", CONFIG_KEYS.earlyPollStrictEarlyOnly],
      ["signalTopicId", CONFIG_KEYS.earlyPollSignalTopicId],
      ["rawTopicId", CONFIG_KEYS.earlyPollRawTopicId],
      ["profileChangeTopicId", CONFIG_KEYS.earlyPollProfileChangeTopicId],
      ["sendRawPosts", CONFIG_KEYS.earlyPollSendRawPosts],
    ];

    for (const [field, key] of map) {
      if (body[field] !== undefined) {
        writes.push(setConfig(key, body[field]));
      }
    }
    await Promise.all(writes);
    const cfg = await resolveEarlyPollConfig();
    res.json(jsonSafe({ ok: true, config: configView(cfg) }));
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
    const cfg = await resolveEarlyPollConfig();
    const staleBefore = new Date(Date.now() - cfg.staleMs);
    const poolWhere = earlyPoolWhereFromConfig(cfg);

    const where = {
      AND: [
        poolWhere,
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
    const days =
      z.coerce.number().int().min(1).max(90).optional().parse(req.query.days) ??
      7;
    const top =
      z.coerce.number().int().min(1).max(100).optional().parse(req.query.top) ??
      20;
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

const growthReportBody = z.object({
  topicId: z.number().int().nullable().optional(),
});

earlyProjectsRouter.post(
  "/growth-report",
  asyncHandler(async (req, res) => {
    const body = growthReportBody.parse(req.body ?? {});
    const result = await enqueueJob("growth-report", {
      topicId: body.topicId ?? null,
    });
    res.json({ ok: true, ...result });
  }),
);
