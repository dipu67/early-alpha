// Growth monitor — top growing projects by follower count.
import { Router } from "express";
import { asyncHandler } from "../middleware/error.js";
import { computeTopGrowingProjects } from "../services/growthReport.js";
import { enqueueJob } from "../enqueue.js";

export const growthRouter: Router = Router();

growthRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const days = Math.min(30, Math.max(1, parseInt(req.query.days as string) || 7));
    const top = Math.min(50, Math.max(5, parseInt(req.query.top as string) || 20));

    const items = await computeTopGrowingProjects({ days, top });

    // Transform to GrowthBoardRow format
    const rows = items.map((row) => ({
      accountId: row.accountId,
      username: row.username,
      name: row.name,
      tags: row.tags,
      followersNow: row.followersNow,
      followersBefore: row.followersBefore,
      absGain: row.absGain,
      pctGain: row.pctGain,
      firstSeenAt: row.firstSeenAt.toISOString(),
      huntStage: row.huntStage,
    }));

    res.json({ items: rows, days, top });
  }),
);

growthRouter.post(
  "/report",
  asyncHandler(async (req, res) => {
    const topicId = req.body?.topicId != null ? Number(req.body.topicId) : null;
    const jobId = await enqueueJob("growth-report", { topicId });
    res.json({ jobId });
  }),
);
