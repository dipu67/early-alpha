// Chainlist dual-source new-chain API (no DB table).
//
//   GET   /chainlist              snapshot status + discoveries + source toggles
//   POST  /chainlist/poll         run enabled sources → compare → alert
//   PATCH /chainlist/topic        set Telegram topic for chainlist alerts
//   PATCH /chainlist/sources      enable/disable rpcs + github approaches
//   POST  /chainlist/seed-search  ensure Live Search starter queries

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import { setConfig, alertTopicKey } from "../services/appConfig.js";
import {
  ensureChainSearchQueries,
  getChainlistStatus,
  pollChainlist,
  setChainlistSources,
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

    res.json(
      jsonSafe({
        total: status.snapshotCount,
        alerted: status.discoveries.filter((d) => d.alerted).length,
        limit: q.limit,
        items: discoveries.map((c) => ({
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
          commitSha: c.commitSha ?? null,
          commitUrl: c.commitUrl ?? null,
          githubFile: c.githubFile ?? null,
          chainlistUrl: `https://chainlist.org/chain/${c.chainId}`,
        })),
        sources: status.sources,
        snapshot: {
          path: status.snapshotPath,
          exists: status.snapshotExists,
          updatedAt: status.snapshotUpdatedAt,
          count: status.snapshotCount,
          source: status.source,
        },
        github: status.github,
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

/** Enable / disable each detection approach independently. */
chainlistRouter.patch(
  "/sources",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        rpcs: z.boolean().optional(),
        github: z.boolean().optional(),
      })
      .refine((b) => b.rpcs !== undefined || b.github !== undefined, {
        message: "Provide rpcs and/or github",
      })
      .parse(req.body ?? {});
    const patch: { rpcs?: boolean; github?: boolean } = {};
    if (body.rpcs !== undefined) patch.rpcs = body.rpcs;
    if (body.github !== undefined) patch.github = body.github;
    const sources = await setChainlistSources(patch);
    res.json({ ok: true, sources });
  }),
);

chainlistRouter.post(
  "/seed-search",
  asyncHandler(async (_req, res) => {
    const result = await ensureChainSearchQueries();
    res.json({ ok: true, ...result });
  }),
);
