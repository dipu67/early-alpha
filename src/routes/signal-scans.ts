// Signal keyword rules API (desk is rules-only).
//
//   GET/POST/PATCH/DELETE /api/signals/rules
//   POST /api/signals/rules/seed

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
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
