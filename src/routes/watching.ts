// Watching projects control panel — interval, alerts, topic config.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../middleware/error.js";
import { getConfig, setConfig, CONFIG_KEYS } from "../services/appConfig.js";
import { enqueueJob } from "../enqueue.js";

export const watchingRouter: Router = Router();

watchingRouter.get(
  "/config",
  asyncHandler(async (_req, res) => {
    const [signalEnabled, rowEnabled, intervalMs, signalTopicId, rowTopicId] = await Promise.all([
      getConfig<boolean>(CONFIG_KEYS.watchingSignalEnabled, true),
      getConfig<boolean>(CONFIG_KEYS.watchingRowEnabled, true),
      getConfig<number>(CONFIG_KEYS.watchingIntervalMs, 3600000),
      getConfig<number | null>(CONFIG_KEYS.watchingSignalTopicId, null),
      getConfig<number | null>(CONFIG_KEYS.watchingRowTopicId, null),
    ]);
    res.json({
      signalEnabled,
      rowEnabled,
      intervalMs,
      signalTopicId,
      rowTopicId,
      botId: null,
    });
  }),
);

const patchBody = z.object({
  signalEnabled: z.boolean().optional(),
  rowEnabled: z.boolean().optional(),
  intervalMs: z.number().int().min(60000).optional(),
  signalTopicId: z.number().nullable().optional(),
  rowTopicId: z.number().nullable().optional(),
});

watchingRouter.patch(
  "/config",
  asyncHandler(async (req, res) => {
    const body = patchBody.parse(req.body);
    if (body.signalEnabled !== undefined) await setConfig(CONFIG_KEYS.watchingSignalEnabled, body.signalEnabled);
    if (body.rowEnabled !== undefined) await setConfig(CONFIG_KEYS.watchingRowEnabled, body.rowEnabled);
    if (body.intervalMs !== undefined) await setConfig(CONFIG_KEYS.watchingIntervalMs, body.intervalMs);
    if (body.signalTopicId !== undefined) await setConfig(CONFIG_KEYS.watchingSignalTopicId, body.signalTopicId);
    if (body.rowTopicId !== undefined) await setConfig(CONFIG_KEYS.watchingRowTopicId, body.rowTopicId);
    res.json({ ok: true });
  }),
);

watchingRouter.get(
  "/count",
  asyncHandler(async (_req, res) => {
    const count = await prisma.twitterAccount.count({
      where: { project: { projectStatus: "watching" } },
    });
    res.json({ count });
  }),
);

watchingRouter.get(
  "/topics",
  asyncHandler(async (_req, res) => {
    // Fetch all Telegram groups and their topics
    const { listGroups } = await import("../tg/groupAdmin.js");
    const groups = await listGroups();

    const topics: Array<{ id: number; label: string; isGeneral: boolean; groupId: number }> = [];

    for (const group of groups) {
      if (!group.topics) continue;
      for (const topic of group.topics) {
        topics.push({
          id: topic.messageThreadId,
          label: topic.isGeneral ? "General" : topic.name,
          isGeneral: topic.isGeneral,
          groupId: Number(group.id),
        });
      }
    }

    // Sort: General first, then by name
    topics.sort((a, b) => {
      if (a.isGeneral && !b.isGeneral) return -1;
      if (!a.isGeneral && b.isGeneral) return 1;
      return a.label.localeCompare(b.label);
    });

    res.json({ topics });
  }),
);

watchingRouter.post(
  "/poll",
  asyncHandler(async (_req, res) => {
    const { enqueueJob } = await import("../enqueue.js");
    await enqueueJob("poll-watching", {});
    res.json({ ok: true });
  }),
);
