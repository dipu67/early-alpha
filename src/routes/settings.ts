// Settings router — key/value app config (Claude API key, Telegram tokens, poll
// intervals). Values are secrets: masked on GET, written whole on PUT.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../middleware/error.js";

export const settingsRouter: Router = Router();

function mask(value: string): string {
  if (value.length <= 4) return "****";
  return `****${value.slice(-4)}`;
}

settingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } });
    res.json({
      items: rows.map((r) => ({
        key: r.key,
        masked: mask(r.value),
        hasValue: r.value.length > 0,
        updatedAt: r.updatedAt,
      })),
    });
  }),
);

const putBody = z.object({ key: z.string().min(1), value: z.string() });

settingsRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const { key, value } = putBody.parse(req.body);
    const row = await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    res.json({ key: row.key, masked: mask(row.value), updatedAt: row.updatedAt });
  }),
);
