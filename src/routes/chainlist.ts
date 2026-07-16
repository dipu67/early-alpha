// Chainlist JSON-snapshot new-chain API.
//
//   GET  /chainlist              status + discoveries + optional DB recent
//   POST /chainlist/poll         fetch rpcs.json → compare file → alert
//   PATCH /chainlist/topic       set Telegram topic for chainlist alerts
//   POST /chainlist/seed-search  ensure Live Search starter queries

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import { setConfig } from "../services/appConfig.js";
import { alertTopicKey } from "../services/appConfig.js";
import {
  ensureChainSearchQueries,
  getChainlistStatus,
  pollChainlist,
} from "../services/chainlistPoller.js";

export const chainlistRouter: Router = Router();

chainlistRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional().default(50),
        includeTestnet: z
          .enum(["true", "false", "1", "0"])
          .optional()
          .transform((v) => v === "true" || v === "1"),
      })
      .parse(req.query);

    const status = await getChainlistStatus();
    let discoveries = status.discoveries;
    if (!q.includeTestnet) {
      discoveries = discoveries.filter((d) => !d.isTestnet);
    }
    discoveries = discoveries.slice(0, q.limit);

    // Fallback: DB recent if no file discoveries yet
    let dbItems: unknown[] = [];
    if (discoveries.length === 0) {
      const where = q.includeTestnet ? {} : { isTestnet: false };
      const recent = await prisma.knownChain.findMany({
        where,
        orderBy: { firstSeenAt: "desc" },
        take: q.limit,
      });
      dbItems = recent.map((c) => ({
        chainId: c.chainId,
        name: c.name,
        shortName: c.shortName,
        nativeSymbol: c.nativeSymbol,
        rpcUrl: c.rpcUrl,
        explorerUrl: c.explorerUrl,
        infoUrl: c.infoUrl,
        isTestnet: c.isTestnet,
        source: c.source,
        rpcLive: c.rpcLive,
        firstSeenAt: c.firstSeenAt,
        alerted: c.alertedAt != null,
        chainlistUrl: `https://chainlist.org/chain/${c.chainId}`,
      }));
    }

    const items =
      discoveries.length > 0
        ? discoveries.map((c) => ({
            chainId: c.chainId,
            name: c.name,
            shortName: c.shortName,
            nativeSymbol: c.nativeSymbol,
            rpcUrl: c.rpcUrl,
            explorerUrl: c.explorerUrl,
            infoUrl: c.infoUrl,
            isTestnet: c.isTestnet,
            source: c.source,
            rpcLive: c.rpcLive,
            firstSeenAt: c.firstSeenAt,
            alerted: c.alerted,
            chainlistUrl: `https://chainlist.org/chain/${c.chainId}`,
          }))
        : dbItems;

    res.json(
      jsonSafe({
        total: status.snapshotCount,
        alerted: discoveries.filter((d) => d.alerted).length,
        limit: q.limit,
        items,
        snapshot: {
          path: status.snapshotPath,
          exists: status.snapshotExists,
          updatedAt: status.snapshotUpdatedAt,
          count: status.snapshotCount,
          source: status.source,
        },
        topicId: status.topicId,
      }),
    );
  }),
);

chainlistRouter.post(
  "/poll",
  asyncHandler(async (_req, res) => {
    const result = await pollChainlist();
    res.json({ ok: true, ...result });
  }),
);

chainlistRouter.post(
  "/poll-async",
  asyncHandler(async (_req, res) => {
    const result = await enqueueJob("poll-chainlist", {});
    res.status(202).json({ enqueued: true, ...result });
  }),
);

/** Set Telegram forum topic for chainlist alerts (null = default topic). */
chainlistRouter.patch(
  "/topic",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        topicId: z.number().int().nullable(),
      })
      .parse(req.body ?? {});
    await setConfig(alertTopicKey("chainlist"), body.topicId);
    res.json({ ok: true, topicId: body.topicId });
  }),
);

chainlistRouter.post(
  "/seed-search",
  asyncHandler(async (_req, res) => {
    const result = await ensureChainSearchQueries();
    res.json({ ok: true, ...result });
  }),
);
