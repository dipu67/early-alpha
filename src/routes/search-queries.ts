// Twitter live search queries admin API.
//
//   GET    /search-queries           list queries (+ auth username)
//   POST   /search-queries           create
//   PATCH  /search-queries/:id       update query / auth / enabled / interval
//   DELETE /search-queries/:id       delete
//   POST   /search-queries/:id/run   poll this query now (ignore interval)
//   POST   /search-queries/run-all   enqueue poll-searches job
//   GET    /search-queries/hits      recent hits (optional queryId filter)

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { paginationSchema, jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import { pollSearchQuery } from "../services/searchPoller.js";

export const searchQueriesRouter: Router = Router();

function parseId(raw: string | string[] | undefined): bigint {
  const s = Array.isArray(raw) ? raw[0] : raw;
  try {
    return BigInt(s ?? "");
  } catch {
    throw new HttpError(400, `invalid id: ${String(s)}`);
  }
}

function viewQuery(q: {
  id: bigint;
  query: string;
  label: string | null;
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
    id: q.id.toString(),
    query: q.query,
    label: q.label,
    enabled: q.enabled,
    authAccountId: q.authAccountId?.toString() ?? null,
    authUsername: q.authAccount?.username ?? null,
    topicId: q.topicId,
    alertEnabled: q.alertEnabled,
    intervalSec: q.intervalSec,
    lastPolledAt: q.lastPolledAt,
    lastTweetId: q.lastTweetId,
    lastError: q.lastError,
    hitCount: q.hitCount,
    recentHitCount: q._count?.hits,
    createdAt: q.createdAt,
  };
}

searchQueriesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const items = await prisma.searchQuery.findMany({
      orderBy: { id: "asc" },
      include: {
        authAccount: { select: { id: true, username: true } },
        _count: { select: { hits: true } },
      },
    });
    res.json({ items: jsonSafe(items.map(viewQuery)) });
  }),
);

// Hits must be registered before /:id routes that could capture "hits".
searchQueriesRouter.get(
  "/hits",
  asyncHandler(async (req, res) => {
    const q = paginationSchema
      .extend({ queryId: z.string().optional() })
      .parse(req.query);
    const where = q.queryId ? { queryId: BigInt(q.queryId) } : {};
    const [items, total] = await Promise.all([
      prisma.searchHit.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: q.limit,
        skip: q.offset,
        include: {
          query: { select: { id: true, query: true, label: true } },
        },
      }),
      prisma.searchHit.count({ where }),
    ]);
    res.json({
      total,
      limit: q.limit,
      offset: q.offset,
      items: jsonSafe(
        items.map((h) => ({
          id: h.id.toString(),
          queryId: h.queryId.toString(),
          query: h.query.query,
          queryLabel: h.query.label,
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
  query: z.string().min(1).max(280),
  label: z.string().max(80).nullable().optional(),
  authAccountId: z.string().nullable().optional(),
  topicId: z.number().int().nullable().optional(),
  alertEnabled: z.boolean().optional().default(true),
  intervalSec: z.number().int().min(30).max(3600).optional().default(120),
  enabled: z.boolean().optional().default(true),
});

searchQueriesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createBody.parse(req.body);
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
    const row = await prisma.searchQuery.create({
      data: {
        query: body.query.trim(),
        label: body.label?.trim() || null,
        authAccountId,
        topicId: body.topicId ?? null,
        alertEnabled: body.alertEnabled,
        intervalSec: body.intervalSec,
        enabled: body.enabled,
      },
      include: { authAccount: { select: { id: true, username: true } } },
    });
    res.status(201).json({ item: jsonSafe(viewQuery(row)) });
  }),
);

const patchBody = z
  .object({
    query: z.string().min(1).max(280).optional(),
    label: z.string().max(80).nullable().optional(),
    authAccountId: z.string().nullable().optional(),
    topicId: z.number().int().nullable().optional(),
    alertEnabled: z.boolean().optional(),
    intervalSec: z.number().int().min(30).max(3600).optional(),
    enabled: z.boolean().optional(),
    /** Clear watermark so next poll re-seeds (no history flood). */
    lastTweetId: z.string().nullable().optional(),
    lastPolledAt: z.null().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "empty_patch" });

searchQueriesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = patchBody.parse(req.body);
    const existing = await prisma.searchQuery.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "query_not_found");

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

    const row = await prisma.searchQuery.update({
      where: { id },
      data: {
        ...(body.query !== undefined ? { query: body.query.trim() } : {}),
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
    res.json({ item: jsonSafe(viewQuery(row)) });
  }),
);

searchQueriesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await prisma.searchQuery.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "query_not_found");
    await prisma.searchQuery.delete({ where: { id } });
    res.json({ deleted: true, id: id.toString() });
  }),
);

// Static path first so it is not captured by /:id/...
searchQueriesRouter.post(
  "/run-all",
  asyncHandler(async (_req, res) => {
    const result = await enqueueJob("poll-searches", {});
    res.status(202).json({ enqueued: true, ...result });
  }),
);

// Force-run one query now (ignores per-query interval).
searchQueriesRouter.post(
  "/:id/run",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await prisma.searchQuery.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "query_not_found");
    if (!existing.enabled) throw new HttpError(400, "query_disabled");

    const result = await pollSearchQuery(id, { force: true });
    res.json({ ok: true, ...result });
  }),
);
