// Per-user timeline monitors — poll getUserTweets by username (not lists).
// Empty by default: only usernames you add manually are monitored.
//
//   GET    /monitors                 list
//   POST   /monitors                 add by username
//   DELETE /monitors                 wipe all monitors
//   PATCH  /monitors/:id             update mode / active / topic / alerts
//   DELETE /monitors/:id             remove one
//   POST   /monitors/:id/poll        poll this account now
//   POST   /monitors/poll-all        enqueue poll-monitors job

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import {
  addMonitor,
  listMonitors,
  pollMonitor,
} from "../services/projectMonitor.js";

export const monitorsRouter: Router = Router();

function parseId(raw: string | string[] | undefined): bigint {
  const s = Array.isArray(raw) ? raw[0] : raw;
  try {
    return BigInt(s ?? "");
  } catch {
    throw new HttpError(400, `invalid id: ${String(s)}`);
  }
}

monitorsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const items = await listMonitors();
    res.json({ items: jsonSafe(items) });
  }),
);

const addBody = z.object({
  username: z.string().min(1),
  twitterUserId: z.string().min(1).optional(),
  source: z.enum(["manual", "hunter", "stage", "signal"]).optional(),
  alertMode: z.enum(["all", "signals"]).optional(),
  alertEnabled: z.boolean().optional(),
  topicId: z.number().int().nullable().optional(),
  heatAtEnroll: z.number().optional(),
});

monitorsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = addBody.parse(req.body ?? {});
    try {
      const row = await addMonitor({
        username: body.username,
        ...(body.twitterUserId ? { twitterUserId: body.twitterUserId } : {}),
        source: body.source ?? "manual",
        alertMode: body.alertMode ?? "all",
        alertEnabled: body.alertEnabled ?? true,
        topicId: body.topicId ?? null,
        heatAtEnroll: body.heatAtEnroll ?? null,
      });
      res.status(201).json(jsonSafe(row));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "invalid_username") throw new HttpError(400, msg);
      if (msg.startsWith("user_not_found")) throw new HttpError(404, msg);
      if (msg === "already_monitoring") throw new HttpError(409, msg);
      throw err;
    }
  }),
);

// Static paths before /:id
monitorsRouter.post(
  "/poll-all",
  asyncHandler(async (_req, res) => {
    const jobId = await enqueueJob("poll-monitors", {});
    res.json({ ok: true, jobId });
  }),
);

/** Wipe entire user monitor list (default empty state). */
monitorsRouter.delete(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await prisma.projectMonitor.deleteMany({});
    res.json({ ok: true, deleted: result.count });
  }),
);

const patchBody = z.object({
  isActive: z.boolean().optional(),
  alertMode: z.enum(["all", "signals"]).optional(),
  alertEnabled: z.boolean().optional(),
  topicId: z.number().int().nullable().optional(),
  resetWatermark: z.boolean().optional(),
});

monitorsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = patchBody.parse(req.body ?? {});
    const existing = await prisma.projectMonitor.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "not_found");

    const data: {
      isActive?: boolean;
      alertMode?: string;
      alertEnabled?: boolean;
      topicId?: number | null;
      lastTweetId?: null;
      lastError?: null;
    } = {};
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.alertMode !== undefined) data.alertMode = body.alertMode;
    if (body.alertEnabled !== undefined) data.alertEnabled = body.alertEnabled;
    if (body.topicId !== undefined) data.topicId = body.topicId;
    if (body.resetWatermark) {
      data.lastTweetId = null;
      data.lastError = null;
    }

    const row = await prisma.projectMonitor.update({ where: { id }, data });
    res.json(
      jsonSafe({
        id: row.id.toString(),
        twitterUserId: row.twitterUserId,
        username: row.username,
        name: row.name,
        primaryTag: row.primaryTag,
        tags: row.tags,
        isActive: row.isActive,
        source: row.source,
        alertMode: row.alertMode,
        alertEnabled: row.alertEnabled,
        topicId: row.topicId,
        lastTweetId: row.lastTweetId,
        lastPolledAt: row.lastPolledAt,
        lastError: row.lastError,
        alertCount: row.alertCount,
        heatAtEnroll: row.heatAtEnroll,
        createdAt: row.createdAt,
      }),
    );
  }),
);

monitorsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await prisma.projectMonitor.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "not_found");
    await prisma.projectMonitor.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

monitorsRouter.post(
  "/:id/poll",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await prisma.projectMonitor.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "not_found");
    const result = await pollMonitor(id);
    res.json(result);
  }),
);
