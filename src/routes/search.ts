// Search router — global search across projects, watched accounts, and signal
// posts. Returns a small capped set per category for the command palette.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../middleware/error.js";
import { jsonSafe } from "../http.js";

export const searchRouter: Router = Router();

const query = z.object({ q: z.string().min(1).max(120) });

searchRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q } = query.parse(req.query);
    const ci = { contains: q, mode: "insensitive" as const };

    const [projects, seeds, signals] = await Promise.all([
      prisma.twitterAccount.findMany({
        where: { OR: [{ username: ci }, { name: ci }] },
        take: 8,
        select: { id: true, username: true, name: true, tags: true },
      }),
      prisma.seedAccount.findMany({
        where: { username: ci },
        take: 5,
        select: { id: true, username: true, active: true, category: true },
      }),
      prisma.postAlert.findMany({
        where: { OR: [{ username: ci }, { text: ci }] },
        take: 8,
        orderBy: { createdAt: "desc" },
        select: { tweetId: true, username: true, slug: true },
      }),
    ]);

    res.json(
      jsonSafe({
        projects,
        seeds,
        /** @deprecated empty — use seeds */
        watches: [],
        signals,
      }),
    );
  }),
);
