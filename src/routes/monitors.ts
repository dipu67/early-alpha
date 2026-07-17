// Project monitors — tag-based enrollment + efficient tweetCount prefilter poll.
//
//   GET    /monitors                    list monitors
//   POST   /monitors                    add by username
//   DELETE /monitors                    wipe all
//   PATCH  /monitors/:id                update
//   DELETE /monitors/:id                remove one
//   POST   /monitors/:id/poll           poll one (timeline)
//   POST   /monitors/:id/skip-backlog   clear watermark + re-seed
//   POST   /monitors/poll-all           enqueue bulk poll job
//   POST   /monitors/skip-all-backlogs  clear all watermarks
//   GET    /monitors/tag-rules          list tag enroll rules
//   POST   /monitors/tag-rules          upsert tag rule
//   POST   /monitors/enroll-by-tag      enroll all projects for a tag
//   DELETE /monitors/tag-rules/:id      delete rule

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import {
  addMonitor,
  listMonitors,
  listTagRules,
  upsertTagRule,
  enrollByTag,
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

// ── Tag rules (static paths first) ─────────────────────────────────────

monitorsRouter.get(
  "/tag-rules",
  asyncHandler(async (_req, res) => {
    const items = await listTagRules();
    res.json({ items: jsonSafe(items) });
  }),
);

const tagRuleBody = z.object({
  tagSlug: z.string().min(1),
  enabled: z.boolean().optional(),
  intervalSec: z.number().int().min(60).max(86_400).optional(),
  topicId: z.number().int().nullable().optional(),
  alertMode: z.enum(["all", "signals"]).optional(),
  alertEnabled: z.boolean().optional(),
  maxProjects: z.number().int().min(1).max(5000).optional(),
});

monitorsRouter.post(
  "/tag-rules",
  asyncHandler(async (req, res) => {
    const body = tagRuleBody.parse(req.body ?? {});
    try {
      const row = await upsertTagRule({
        tagSlug: body.tagSlug,
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.intervalSec !== undefined
          ? { intervalSec: body.intervalSec }
          : {}),
        ...(body.topicId !== undefined ? { topicId: body.topicId } : {}),
        ...(body.alertMode !== undefined ? { alertMode: body.alertMode } : {}),
        ...(body.alertEnabled !== undefined
          ? { alertEnabled: body.alertEnabled }
          : {}),
        ...(body.maxProjects !== undefined
          ? { maxProjects: body.maxProjects }
          : {}),
      });
      res.status(201).json(jsonSafe(row));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "tag_required") throw new HttpError(400, msg);
      throw err;
    }
  }),
);

monitorsRouter.delete(
  "/tag-rules/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await prisma.projectMonitorTagRule.delete({ where: { id } }).catch(() => {
      throw new HttpError(404, "not_found");
    });
    res.json({ ok: true });
  }),
);

const enrollBody = z.object({
  tagSlug: z.string().min(1),
  /** If true, upsert the rule with the given settings first. */
  createRule: z.boolean().optional(),
  intervalSec: z.number().int().min(60).max(86_400).optional(),
  topicId: z.number().int().nullable().optional(),
  alertMode: z.enum(["all", "signals"]).optional(),
  alertEnabled: z.boolean().optional(),
  maxProjects: z.number().int().min(1).max(5000).optional(),
  enabled: z.boolean().optional(),
});

monitorsRouter.post(
  "/enroll-by-tag",
  asyncHandler(async (req, res) => {
    const body = enrollBody.parse(req.body ?? {});
    const slug = body.tagSlug.trim().toLowerCase();

    if (body.createRule !== false) {
      await upsertTagRule({
        tagSlug: slug,
        enabled: body.enabled !== false,
        ...(body.intervalSec !== undefined
          ? { intervalSec: body.intervalSec }
          : {}),
        ...(body.topicId !== undefined ? { topicId: body.topicId } : {}),
        ...(body.alertMode !== undefined ? { alertMode: body.alertMode } : {}),
        ...(body.alertEnabled !== undefined
          ? { alertEnabled: body.alertEnabled }
          : {}),
        ...(body.maxProjects !== undefined
          ? { maxProjects: body.maxProjects }
          : {}),
      });
    }

    try {
      const result = await enrollByTag(slug);
      res.json(jsonSafe(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "tag_rule_not_found") throw new HttpError(404, msg);
      if (msg === "tag_rule_disabled") throw new HttpError(400, msg);
      throw err;
    }
  }),
);

const addBody = z.object({
  username: z.string().min(1),
  twitterUserId: z.string().min(1).optional(),
  source: z.enum(["manual", "hunter", "stage", "signal", "tag"]).optional(),
  alertMode: z.enum(["all", "signals"]).optional(),
  alertEnabled: z.boolean().optional(),
  topicId: z.number().int().nullable().optional(),
  intervalSec: z.number().int().min(60).max(86_400).optional(),
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
        ...(body.intervalSec !== undefined
          ? { intervalSec: body.intervalSec }
          : {}),
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

monitorsRouter.post(
  "/poll-all",
  asyncHandler(async (_req, res) => {
    const jobId = await enqueueJob("poll-monitors", {});
    res.json({ ok: true, jobId });
  }),
);

monitorsRouter.post(
  "/skip-all-backlogs",
  asyncHandler(async (_req, res) => {
    const result = await prisma.projectMonitor.updateMany({
      data: { lastTweetId: null, lastError: null },
    });
    const job = await enqueueJob("poll-monitors", {});
    res.json({
      ok: true,
      cleared: result.count,
      enqueued: true,
      ...job,
    });
  }),
);

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
  intervalSec: z.number().int().min(60).max(86_400).optional(),
  resetWatermark: z.boolean().optional(),
});

monitorsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = patchBody.parse(req.body ?? {});
    const existing = await prisma.projectMonitor.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "not_found");

    const data: Record<string, unknown> = {};
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.alertMode !== undefined) data.alertMode = body.alertMode;
    if (body.alertEnabled !== undefined) data.alertEnabled = body.alertEnabled;
    if (body.topicId !== undefined) data.topicId = body.topicId;
    if (body.intervalSec !== undefined) data.intervalSec = body.intervalSec;
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
        intervalSec: row.intervalSec,
        lastTweetId: row.lastTweetId,
        lastTweetCount: row.lastTweetCount,
        lastPolledAt: row.lastPolledAt,
        lastError: row.lastError,
        alertCount: row.alertCount,
        heatAtEnroll: row.heatAtEnroll,
        previousUsername: row.previousUsername,
        usernameChangedAt: row.usernameChangedAt,
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
    const result = await pollMonitor(id, { forceTimeline: true });
    res.json(result);
  }),
);

monitorsRouter.post(
  "/:id/skip-backlog",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await prisma.projectMonitor.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "not_found");

    await prisma.projectMonitor.update({
      where: { id },
      data: { lastTweetId: null, lastError: null },
    });

    if (!existing.isActive) {
      res.json({ ok: true, cleared: true, seeded: false, skippedPoll: true });
      return;
    }

    const result = await pollMonitor(id, { forceTimeline: true });
    res.json({ ok: true, cleared: true, ...result });
  }),
);
