// Signals router — PostAlert feed + handoff into hunter / user monitors.
//
//   GET  /signals            -> PostAlert feed (mint/launch/etc), filter slug/signal/since
//                              Storage is capped at latest 20 posts per tag (slug).
//   POST /signals/promote    -> monitor this project OR set hunter stage
//   GET  /signals/follows    -> AlertLog feed (new-follow alerts), filter since

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { paginationSchema, parseSince, jsonSafe } from "../http.js";
import { POST_ALERT_KEEP_PER_SLUG } from "../services/postAlerts.js";
import { addMonitor } from "../services/projectMonitor.js";
import {
  HUNT_STAGES,
  isHuntStage,
  setHuntStage,
} from "../services/hunter.js";

export const signalsRouter: Router = Router();

const signalsQuery = paginationSchema.extend({
  slug: z.string().optional(),
  signal: z.string().optional(),
  since: z.string().optional(),
  /** When true (default with no slug), return up to 20 newest per tag. */
  perTag: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false")])
    .optional(),
});

signalsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = signalsQuery.parse(req.query);
    const since = parseSince(q.since);
    const perTagRaw = q.perTag;
    const perTag =
      perTagRaw === "0" || perTagRaw === "false"
        ? false
        : perTagRaw === "1" || perTagRaw === "true"
          ? true
          : !q.slug; // default: per-tag cap when browsing all tags

    const where = {
      ...(q.slug ? { slug: q.slug } : {}),
      ...(q.signal ? { signals: { has: q.signal } } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    };

    // Single tag: latest 20 (or request limit, max 20 by default keep)
    if (q.slug || !perTag) {
      const take = q.slug
        ? Math.min(q.limit, POST_ALERT_KEEP_PER_SLUG)
        : q.limit;
      const [items, total] = await Promise.all([
        prisma.postAlert.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take,
          skip: q.offset,
        }),
        prisma.postAlert.count({ where }),
      ]);
      res.json({
        total,
        limit: take,
        offset: q.offset,
        perTag: false,
        keepPerTag: POST_ALERT_KEEP_PER_SLUG,
        items: jsonSafe(items),
      });
      return;
    }

    // All tags: latest N posts for each distinct slug, merged + sorted
    const slugs = await prisma.postAlert.findMany({
      where: {
        ...(q.signal ? { signals: { has: q.signal } } : {}),
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      distinct: ["slug"],
      select: { slug: true },
      orderBy: { slug: "asc" },
    });

    const perSlug = await Promise.all(
      slugs.map(({ slug }) =>
        prisma.postAlert.findMany({
          where: {
            slug,
            ...(q.signal ? { signals: { has: q.signal } } : {}),
            ...(since ? { createdAt: { gte: since } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: POST_ALERT_KEEP_PER_SLUG,
        }),
      ),
    );

    const merged = perSlug
      .flat()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Optional pagination over the merged feed
    const total = merged.length;
    const items = merged.slice(q.offset, q.offset + q.limit);

    res.json({
      total,
      limit: q.limit,
      offset: q.offset,
      perTag: true,
      keepPerTag: POST_ALERT_KEEP_PER_SLUG,
      tagCount: slugs.length,
      items: jsonSafe(items),
    });
  }),
);

/** Resolve TwitterAccount id from signal row (accountId and/or username). */
async function resolveSignalAccount(
  username: string,
  accountId?: string | null,
): Promise<{ id: string; username: string }> {
  const uname = username.replace(/^@/, "").trim().toLowerCase();
  if (!uname) throw new HttpError(400, "username_required");

  if (accountId && accountId !== uname) {
    const byId = await prisma.twitterAccount.findUnique({
      where: { id: accountId },
      select: { id: true, username: true },
    });
    if (byId) return { id: byId.id, username: byId.username };
  }

  const byName = await prisma.twitterAccount.findUnique({
    where: { username: uname },
    select: { id: true, username: true },
  });
  if (byName) return { id: byName.id, username: byName.username };

  // Stub from snowflake-looking accountId so hunter stage can stick
  if (accountId && /^\d{5,}$/.test(accountId)) {
    const row = await prisma.twitterAccount.upsert({
      where: { id: accountId },
      create: {
        id: accountId,
        username: uname,
        name: uname,
        tags: [],
      },
      update: { username: uname },
      select: { id: true, username: true },
    });
    return { id: row.id, username: row.username };
  }

  throw new HttpError(
    404,
    "account_not_found — project not in DB yet; try Monitor (resolves via Twitter)",
  );
}

const promoteBody = z.object({
  username: z.string().min(1),
  accountId: z.string().min(1).optional(),
  action: z.enum(["monitor", "hunt"]),
  /** Hunter funnel stage when action=hunt (default soft). */
  stage: z.string().optional().default("soft"),
  note: z.string().max(2000).optional().nullable(),
  alertMode: z.enum(["all", "signals"]).optional().default("signals"),
  /** Tag from signal for note context */
  slug: z.string().optional(),
  tweetId: z.string().optional(),
});

signalsRouter.post(
  "/promote",
  asyncHandler(async (req, res) => {
    const body = promoteBody.parse(req.body ?? {});
    const uname = body.username.replace(/^@/, "").trim().toLowerCase();

    if (body.action === "monitor") {
      try {
        const row = await addMonitor({
          username: uname,
          ...(body.accountId && /^\d{5,}$/.test(body.accountId)
            ? { twitterUserId: body.accountId }
            : {}),
          source: "signal",
          alertMode: body.alertMode ?? "signals",
          alertEnabled: true,
        });
        res.status(201).json(
          jsonSafe({
            ok: true,
            action: "monitor",
            monitor: row,
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "invalid_username") throw new HttpError(400, msg);
        if (msg.startsWith("user_not_found")) throw new HttpError(404, msg);
        if (msg === "already_monitoring") {
          res.json({ ok: true, action: "monitor", already: true });
          return;
        }
        throw err;
      }
      return;
    }

    // hunt
    const stage = body.stage?.trim().toLowerCase() || "soft";
    if (!isHuntStage(stage)) {
      throw new HttpError(400, `invalid_stage: use ${HUNT_STAGES.join("|")}`);
    }
    const acc = await resolveSignalAccount(uname, body.accountId);
    const noteParts = [
      body.note?.trim() || null,
      body.slug ? `signal tag=${body.slug}` : null,
      body.tweetId ? `tweet=${body.tweetId}` : null,
      "from signals feed",
    ].filter(Boolean);
    const row = await setHuntStage(acc.id, stage, noteParts.join(" · "));
    res.json(
      jsonSafe({
        ok: true,
        action: "hunt",
        stage: row.huntStage,
        account: row,
      }),
    );
  }),
);

const followsQuery = paginationSchema.extend({ since: z.string().optional() });

signalsRouter.get(
  "/follows",
  asyncHandler(async (req, res) => {
    const q = followsQuery.parse(req.query);
    const since = parseSince(q.since);
    const where = since ? { sentAt: { gte: since } } : {};

    const [items, total] = await Promise.all([
      prisma.alertLog.findMany({
        where,
        orderBy: { sentAt: "desc" },
        take: q.limit,
        skip: q.offset,
      }),
      prisma.alertLog.count({ where }),
    ]);

    res.json({ total, limit: q.limit, offset: q.offset, items: jsonSafe(items) });
  }),
);
