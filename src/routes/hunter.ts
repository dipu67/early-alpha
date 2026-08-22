// Pro-hunter API: hot board, entity fusion, hunt stages.
//
//   GET   /hunter/hot              -> ranked heat board
//   GET   /hunter/entity/:id       -> fused evidence for one account
//   PATCH /hunter/entity/:id/stage -> set hunt funnel stage + note

import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
import {
  getEntity,
  getHotBoard,
  HUNT_STAGES,
  isHuntStage,
  setHuntStage,
  promoteTakenStage,
} from "../services/hunter.js";
import { prisma } from "../db/prisma.js";

export const hunterRouter: Router = Router();

const hotQuery = z.object({
  hours: z.coerce.number().int().min(1).max(168).optional().default(72),
  minHeat: z.coerce.number().optional(),
  maxFollowers: z.coerce.number().int().positive().optional(),
  maxAgeDays: z.coerce.number().int().positive().optional(),
  tag: z.string().optional(),
  stage: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

hunterRouter.get(
  "/hot",
  asyncHandler(async (req, res) => {
    const q = hotQuery.parse(req.query);
    const items = await getHotBoard({
      hours: q.hours,
      minHeat: q.minHeat ?? null,
      maxFollowers: q.maxFollowers ?? null,
      maxAgeDays: q.maxAgeDays ?? null,
      tag: q.tag?.trim().toLowerCase() || null,
      stage: q.stage?.trim().toLowerCase() || null,
      limit: q.limit,
    });
    res.json(
      jsonSafe({
        hours: q.hours,
        total: items.length,
        items,
        stages: HUNT_STAGES,
      }),
    );
  }),
);

hunterRouter.get(
  "/entity/:id",
  asyncHandler(async (req, res) => {
    const idRaw = req.params.id;
    const id = Array.isArray(idRaw) ? idRaw[0]! : idRaw!;
    const entity = await getEntity(id);
    if (!entity) throw new HttpError(404, "account_not_found");
    res.json(jsonSafe(entity));
  }),
);

const stageBody = z.object({
  stage: z.string().min(1),
  note: z.string().max(2000).optional().nullable(),
});

hunterRouter.patch(
  "/entity/:id/stage",
  asyncHandler(async (req, res) => {
    const idRaw = req.params.id;
    const id = Array.isArray(idRaw) ? idRaw[0]! : idRaw!;
    const body = stageBody.parse(req.body ?? {});
    if (!isHuntStage(body.stage)) {
      throw new HttpError(400, `invalid_stage: use ${HUNT_STAGES.join("|")}`);
    }
    const exists = await prisma.twitterAccount.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new HttpError(404, "account_not_found");

    const row = await setHuntStage(id, body.stage, body.note);
    const takenOpts = (() => {
      const id = process.env.TAKEN_AUTH_ACCOUNT_ID;
      return id ? { authAccountId: BigInt(id) } : {};
    })();
    const takeActions =
      body.stage === "taken"
        ? await promoteTakenStage(id, takenOpts)
        : null;
    // Stage does not auto-add User Monitors — use "Monitor this user" explicitly.
    res.json(jsonSafe({ ...row, takeActions }));
  }),
);

/** Pipeline counts for hunter overview strip. */
hunterRouter.get(
  "/pipeline",
  asyncHandler(async (_req, res) => {
    const groups = await prisma.twitterAccount.groupBy({
      by: ["huntStage"],
      _count: { id: true },
    });
    const counts: Record<string, number> = {};
    for (const s of HUNT_STAGES) counts[s] = 0;
    for (const g of groups) counts[g.huntStage] = g._count.id;
    res.json({ counts });
  }),
);
