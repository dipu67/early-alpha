// Signal desk: HomeLatest scanners per tag, rules, and manual follow.
//
//   GET/POST/PATCH/DELETE /signal-scans
//   POST /signal-scans/:id/poll | /signal-scans/poll-all
//   GET/POST/PATCH/DELETE /signal-rules
//   POST /signal-rules/seed
//   GET/POST/DELETE /auth-follows  (project follows for HomeLatest — not AlertLog /follows)

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import {
  pollSignalScan,
  pollAllSignalScans,
  followProjectForTag,
} from "../services/homeSignalScan.js";
import {
  seedDefaultSignalRules,
  invalidateSignalRuleCache,
} from "../services/signalRules.js";

export const signalScansRouter: Router = Router();

function parseId(raw: string | string[] | undefined): bigint {
  const s = Array.isArray(raw) ? raw[0] : raw;
  try {
    return BigInt(s ?? "");
  } catch {
    throw new HttpError(400, `invalid id: ${String(s)}`);
  }
}

function viewScan(s: {
  id: bigint;
  tagSlug: string;
  authAccountId: bigint;
  enabled: boolean;
  autoFollow: boolean;
  alertEnabled: boolean;
  topicId: number | null;
  intervalSec: number;
  lastTweetId: string | null;
  lastPolledAt: Date | null;
  lastError: string | null;
  hitCount: number;
  createdAt: Date;
  authAccount?: { username: string } | null;
}) {
  return {
    id: s.id.toString(),
    tagSlug: s.tagSlug,
    authAccountId: s.authAccountId.toString(),
    authUsername: s.authAccount?.username ?? null,
    enabled: s.enabled,
    autoFollow: s.autoFollow,
    alertEnabled: s.alertEnabled,
    topicId: s.topicId,
    intervalSec: s.intervalSec,
    lastTweetId: s.lastTweetId,
    lastPolledAt: s.lastPolledAt,
    lastError: s.lastError,
    hitCount: s.hitCount,
    createdAt: s.createdAt,
  };
}

// ── Scans ────────────────────────────────────────────────────────────

signalScansRouter.get(
  "/scans",
  asyncHandler(async (_req, res) => {
    const items = await prisma.signalScan.findMany({
      orderBy: { tagSlug: "asc" },
      include: { authAccount: { select: { username: true } } },
    });
    res.json({ items: jsonSafe(items.map(viewScan)) });
  }),
);

const upsertScan = z.object({
  tagSlug: z.string().min(1),
  authAccountId: z.string().min(1),
  enabled: z.boolean().optional(),
  autoFollow: z.boolean().optional(),
  alertEnabled: z.boolean().optional(),
  topicId: z.number().int().nullable().optional(),
  intervalSec: z.number().int().min(30).max(3600).optional(),
  resetWatermark: z.boolean().optional(),
});

signalScansRouter.post(
  "/scans",
  asyncHandler(async (req, res) => {
    const body = upsertScan.parse(req.body ?? {});
    const tagSlug = body.tagSlug.trim().toLowerCase();
    const authAccountId = BigInt(body.authAccountId);
    const auth = await prisma.twitterAuthAccount.findUnique({
      where: { id: authAccountId },
    });
    if (!auth) throw new HttpError(404, "auth_account_not_found");

    const data = {
      tagSlug,
      authAccountId,
      enabled: body.enabled ?? true,
      autoFollow: body.autoFollow ?? false,
      alertEnabled: body.alertEnabled ?? true,
      topicId: body.topicId ?? null,
      intervalSec: body.intervalSec ?? 120,
      ...(body.resetWatermark
        ? { lastTweetId: null as string | null, lastError: null as string | null }
        : {}),
    };

    const row = await prisma.signalScan.upsert({
      where: { tagSlug },
      create: data,
      update: data,
      include: { authAccount: { select: { username: true } } },
    });
    res.status(201).json(jsonSafe(viewScan(row)));
  }),
);

signalScansRouter.patch(
  "/scans/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = upsertScan.partial().parse(req.body ?? {});
    const existing = await prisma.signalScan.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "not_found");

    const data: Record<string, unknown> = {};
    if (body.tagSlug) data.tagSlug = body.tagSlug.trim().toLowerCase();
    if (body.authAccountId) data.authAccountId = BigInt(body.authAccountId);
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.autoFollow !== undefined) data.autoFollow = body.autoFollow;
    if (body.alertEnabled !== undefined) data.alertEnabled = body.alertEnabled;
    if (body.topicId !== undefined) data.topicId = body.topicId;
    if (body.intervalSec !== undefined) data.intervalSec = body.intervalSec;
    if (body.resetWatermark) {
      data.lastTweetId = null;
      data.lastError = null;
    }

    const row = await prisma.signalScan.update({
      where: { id },
      data,
      include: { authAccount: { select: { username: true } } },
    });
    res.json(jsonSafe(viewScan(row)));
  }),
);

signalScansRouter.delete(
  "/scans/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await prisma.signalScan.delete({ where: { id } }).catch(() => {
      throw new HttpError(404, "not_found");
    });
    res.json({ ok: true });
  }),
);

signalScansRouter.post(
  "/scans/poll-all",
  asyncHandler(async (_req, res) => {
    const jobId = await enqueueJob("poll-home-signals", {});
    res.json({ ok: true, jobId });
  }),
);

signalScansRouter.post(
  "/scans/:id/poll",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pollSignalScan(id);
    res.json(result);
  }),
);

// ── Rules ────────────────────────────────────────────────────────────

signalScansRouter.get(
  "/rules",
  asyncHandler(async (_req, res) => {
    const items = await prisma.signalRule.findMany({
      orderBy: [{ slug: "asc" }, { category: "asc" }, { label: "asc" }],
    });
    res.json({
      items: jsonSafe(
        items.map((r) => ({
          id: r.id.toString(),
          slug: r.slug,
          category: r.category,
          label: r.label,
          pattern: r.pattern,
          isRegex: r.isRegex,
          enabled: r.enabled,
          createdAt: r.createdAt,
        })),
      ),
    });
  }),
);

const ruleBody = z.object({
  slug: z.string().nullable().optional(),
  category: z.string().min(1).optional(),
  label: z.string().min(1),
  pattern: z.string().min(1),
  isRegex: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

signalScansRouter.post(
  "/rules",
  asyncHandler(async (req, res) => {
    const body = ruleBody.parse(req.body ?? {});
    const row = await prisma.signalRule.create({
      data: {
        slug: body.slug === undefined ? null : body.slug,
        category: body.category ?? "other",
        label: body.label,
        pattern: body.pattern,
        isRegex: body.isRegex ?? false,
        enabled: body.enabled ?? true,
      },
    });
    invalidateSignalRuleCache();
    res.status(201).json(jsonSafe({ ...row, id: row.id.toString() }));
  }),
);

signalScansRouter.post(
  "/rules/seed",
  asyncHandler(async (_req, res) => {
    const r = await seedDefaultSignalRules();
    res.json(r);
  }),
);

signalScansRouter.patch(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = ruleBody.partial().parse(req.body ?? {});
    const data: Record<string, unknown> = {};
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.category !== undefined) data.category = body.category;
    if (body.label !== undefined) data.label = body.label;
    if (body.pattern !== undefined) data.pattern = body.pattern;
    if (body.isRegex !== undefined) data.isRegex = body.isRegex;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    const row = await prisma.signalRule
      .update({ where: { id }, data })
      .catch(() => null);
    if (!row) throw new HttpError(404, "not_found");
    invalidateSignalRuleCache();
    res.json(jsonSafe({ ...row, id: row.id.toString() }));
  }),
);

signalScansRouter.delete(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await prisma.signalRule.delete({ where: { id } }).catch(() => {
      throw new HttpError(404, "not_found");
    });
    invalidateSignalRuleCache();
    res.json({ ok: true });
  }),
);

// ── Auth project-follows (distinct from GET /signals/follows = AlertLog) ─

signalScansRouter.get(
  "/auth-follows",
  asyncHandler(async (req, res) => {
    const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
    const items = await prisma.authFollow.findMany({
      where: tag ? { tagSlug: tag } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { authAccount: { select: { username: true } } },
    });
    res.json({
      items: jsonSafe(
        items.map((f) => ({
          id: f.id.toString(),
          authAccountId: f.authAccountId.toString(),
          authUsername: f.authAccount?.username ?? null,
          twitterUserId: f.twitterUserId,
          username: f.username,
          tagSlug: f.tagSlug,
          source: f.source,
          createdAt: f.createdAt,
        })),
      ),
    });
  }),
);

const followBody = z.object({
  username: z.string().min(1).optional(),
  twitterUserId: z.string().min(1).optional(),
  tagSlug: z.string().min(1),
  authAccountId: z.string().optional(),
});

signalScansRouter.post(
  "/auth-follows",
  asyncHandler(async (req, res) => {
    const body = followBody.parse(req.body ?? {});
    let twitterUserId = body.twitterUserId;
    let username = body.username?.replace(/^@/, "").toLowerCase();

    if (!twitterUserId && username) {
      const acc = await prisma.twitterAccount.findUnique({
        where: { username },
      });
      if (acc) {
        twitterUserId = acc.id;
        username = acc.username;
      } else {
        // resolve via Twitter
        const { getTwitterClient } = await import("../twitter/getClient.js");
        const { client } = await getTwitterClient();
        const u = await client.getUserByScreenName(username);
        if (!u.success || !u.user) {
          throw new HttpError(404, "user_not_found");
        }
        twitterUserId = u.user.id;
        username = u.user.username.toLowerCase();
      }
    }

    if (!twitterUserId || !username) {
      throw new HttpError(400, "username_or_twitterUserId_required");
    }

    const r = await followProjectForTag({
      twitterUserId,
      username,
      tagSlug: body.tagSlug.trim().toLowerCase(),
      ...(body.authAccountId
        ? { authAccountId: BigInt(body.authAccountId) }
        : {}),
      source: "manual",
      ensureScan: true,
    });
    if (!r.ok) throw new HttpError(400, r.error ?? "follow_failed");
    res.status(201).json({
      ok: true,
      username,
      twitterUserId,
      authUsername: r.authUsername,
    });
  }),
);

signalScansRouter.delete(
  "/auth-follows/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const row = await prisma.authFollow.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, "not_found");
    try {
      const { getTwitterClientById } = await import("../twitter/getClient.js");
      const { client } = await getTwitterClientById(row.authAccountId);
      await client.unfollow(row.twitterUserId);
    } catch (err) {
      console.warn("[signal-scan] unfollow twitter:", err);
    }
    await prisma.authFollow.delete({ where: { id } });
    res.json({ ok: true });
  }),
);
