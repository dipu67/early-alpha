// Public Twitter list monitors admin API.
//
//   GET    /list-monitors           list monitors (+ auth username)
//   POST   /list-monitors           create (list id or x.com/i/lists/… URL)
//   PATCH  /list-monitors/:id       update label / auth / topic / interval / …
//   DELETE /list-monitors/:id       delete
//   POST   /list-monitors/:id/run   poll now (ignore interval)
//   POST   /list-monitors/run-all   enqueue poll-list-monitors job
//   GET    /list-monitors/hits      recent hits

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { paginationSchema, jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import {
  parseTwitterListId,
  pollListMonitor,
} from "../services/listMonitorPoller.js";
import { getTwitterClientById } from "../twitter/getClient.js";

export const listMonitorsRouter: Router = Router();

function parseId(raw: string | string[] | undefined): bigint {
  const s = Array.isArray(raw) ? raw[0] : raw;
  try {
    return BigInt(s ?? "");
  } catch {
    throw new HttpError(400, `invalid id: ${String(s)}`);
  }
}

function viewMonitor(m: {
  id: bigint;
  twitterListId: string;
  label: string | null;
  listName: string | null;
  enabled: boolean;
  authAccountId: bigint | null;
  topicId: number | null;
  alertEnabled: boolean;
  intervalSec: number;
  lastPolledAt: Date | null;
  lastTweetId: string | null;
  lastError: string | null;
  hitCount: number;
  createdAt: Date;
  authAccount?: { id: bigint; username: string } | null;
  _count?: { hits: number };
}) {
  return {
    id: m.id.toString(),
    twitterListId: m.twitterListId,
    label: m.label,
    listName: m.listName,
    enabled: m.enabled,
    authAccountId: m.authAccountId?.toString() ?? null,
    authUsername: m.authAccount?.username ?? null,
    topicId: m.topicId,
    alertEnabled: m.alertEnabled,
    intervalSec: m.intervalSec,
    lastPolledAt: m.lastPolledAt,
    lastTweetId: m.lastTweetId,
    lastError: m.lastError,
    hitCount: m.hitCount,
    recentHitCount: m._count?.hits,
    listUrl: `https://x.com/i/lists/${m.twitterListId}`,
    createdAt: m.createdAt,
  };
}

listMonitorsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const items = await prisma.listMonitor.findMany({
      orderBy: { id: "asc" },
      include: {
        authAccount: { select: { id: true, username: true } },
        _count: { select: { hits: true } },
      },
    });
    res.json({ items: jsonSafe(items.map(viewMonitor)) });
  }),
);

listMonitorsRouter.get(
  "/hits",
  asyncHandler(async (req, res) => {
    const q = paginationSchema
      .extend({ monitorId: z.string().optional() })
      .parse(req.query);
    const where = q.monitorId ? { monitorId: BigInt(q.monitorId) } : {};
    const [items, total] = await Promise.all([
      prisma.listMonitorHit.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: q.limit,
        skip: q.offset,
        include: {
          monitor: {
            select: { id: true, twitterListId: true, label: true, listName: true },
          },
        },
      }),
      prisma.listMonitorHit.count({ where }),
    ]);
    res.json({
      total,
      limit: q.limit,
      offset: q.offset,
      items: jsonSafe(
        items.map((h) => ({
          id: h.id.toString(),
          monitorId: h.monitorId.toString(),
          listId: h.monitor.twitterListId,
          listLabel: h.monitor.label ?? h.monitor.listName,
          tweetId: h.tweetId,
          username: h.username,
          name: h.name,
          text: h.text,
          postedAt: h.postedAt,
          createdAt: h.createdAt,
        })),
      ),
    });
  }),
);

const createBody = z.object({
  /** List rest id or full x.com/i/lists/… URL. */
  list: z.string().min(1).max(500),
  label: z.string().max(80).nullable().optional(),
  authAccountId: z.string().nullable().optional(),
  topicId: z.number().int().nullable().optional(),
  alertEnabled: z.boolean().optional().default(true),
  intervalSec: z.number().int().min(30).max(3600).optional().default(120),
  enabled: z.boolean().optional().default(true),
});

listMonitorsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createBody.parse(req.body);
    const twitterListId = parseTwitterListId(body.list);
    if (!twitterListId) {
      throw new HttpError(400, "invalid_list_id");
    }

    const existing = await prisma.listMonitor.findUnique({
      where: { twitterListId },
    });
    if (existing) throw new HttpError(409, "list_already_monitored");

    const authAccountId =
      body.authAccountId != null && body.authAccountId !== ""
        ? BigInt(body.authAccountId)
        : null;
    if (authAccountId != null) {
      const exists = await prisma.twitterAuthAccount.findUnique({
        where: { id: authAccountId },
      });
      if (!exists) throw new HttpError(400, "auth_account_not_found");
    }

    // Best-effort resolve list name via Twitter.
    let listName: string | null = null;
    try {
      const { client } = await getTwitterClientById(authAccountId);
      const meta = await client.getList(twitterListId);
      if (meta.success && meta.list?.name) {
        listName = meta.list.name;
      } else if (!meta.success) {
        // Still allow create — poll will surface errors; private lists fail later.
        console.warn(
          `[list-monitors] getList ${twitterListId}: ${meta.error ?? "unknown"}`,
        );
      }
    } catch (err) {
      console.warn(
        `[list-monitors] resolve name failed:`,
        err instanceof Error ? err.message : err,
      );
    }

    const row = await prisma.listMonitor.create({
      data: {
        twitterListId,
        label: body.label?.trim() || null,
        listName,
        authAccountId,
        topicId: body.topicId ?? null,
        alertEnabled: body.alertEnabled,
        intervalSec: body.intervalSec,
        enabled: body.enabled,
      },
      include: { authAccount: { select: { id: true, username: true } } },
    });
    res.status(201).json({ item: jsonSafe(viewMonitor(row)) });
  }),
);

const patchBody = z
  .object({
    label: z.string().max(80).nullable().optional(),
    authAccountId: z.string().nullable().optional(),
    topicId: z.number().int().nullable().optional(),
    alertEnabled: z.boolean().optional(),
    intervalSec: z.number().int().min(30).max(3600).optional(),
    enabled: z.boolean().optional(),
    lastTweetId: z.string().nullable().optional(),
    lastPolledAt: z.null().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "empty_patch" });

listMonitorsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = patchBody.parse(req.body);
    const existing = await prisma.listMonitor.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "monitor_not_found");

    let authAccountId: bigint | null | undefined = undefined;
    if (body.authAccountId !== undefined) {
      if (body.authAccountId === null || body.authAccountId === "") {
        authAccountId = null;
      } else {
        authAccountId = BigInt(body.authAccountId);
        const exists = await prisma.twitterAuthAccount.findUnique({
          where: { id: authAccountId },
        });
        if (!exists) throw new HttpError(400, "auth_account_not_found");
      }
    }

    const row = await prisma.listMonitor.update({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: body.label?.trim() || null } : {}),
        ...(authAccountId !== undefined ? { authAccountId } : {}),
        ...(body.topicId !== undefined ? { topicId: body.topicId } : {}),
        ...(body.alertEnabled !== undefined ? { alertEnabled: body.alertEnabled } : {}),
        ...(body.intervalSec !== undefined ? { intervalSec: body.intervalSec } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.lastTweetId !== undefined ? { lastTweetId: body.lastTweetId } : {}),
        ...(body.lastPolledAt === null ? { lastPolledAt: null } : {}),
      },
      include: { authAccount: { select: { id: true, username: true } } },
    });
    res.json({ item: jsonSafe(viewMonitor(row)) });
  }),
);

listMonitorsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await prisma.listMonitor.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "monitor_not_found");
    await prisma.listMonitor.delete({ where: { id } });
    res.json({ deleted: true, id: id.toString() });
  }),
);

listMonitorsRouter.post(
  "/run-all",
  asyncHandler(async (_req, res) => {
    const result = await enqueueJob("poll-list-monitors", {});
    res.status(202).json({ enqueued: true, ...result });
  }),
);

listMonitorsRouter.post(
  "/:id/run",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await prisma.listMonitor.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "monitor_not_found");
    if (!existing.enabled) throw new HttpError(400, "monitor_disabled");

    const result = await pollListMonitor(id, { force: true });
    res.json({ ok: true, ...result });
  }),
);
