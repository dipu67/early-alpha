// Jobs router — the generic action surface. Enqueues an allowlisted job by name.
// Every Twitter-touching action funnels through here so the running early-alpha
// workers do the actual work (single owner, no concurrency races).
//
//   GET  /jobs            -> list allowlisted jobs + whether a worker consumes them
//   POST /jobs/:name      -> validate payload, enqueue

import { Router } from "express";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { enqueueJob } from "../enqueue.js";
import { JOBS, JOB_NAMES, isJobName } from "../jobs.js";

export const jobsRouter: Router = Router();

jobsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({
      jobs: JOB_NAMES.map((name) => ({
        name,
        queue: JOBS[name].queue,
        jobName: JOBS[name].jobName,
        consumedByWorker: JOBS[name].existing,
      })),
    });
  }),
);

jobsRouter.post(
  "/:name",
  asyncHandler(async (req, res) => {
    const nameRaw = req.params.name;
    const name = Array.isArray(nameRaw) ? nameRaw[0]! : nameRaw!;
    if (!isJobName(name)) {
      throw new HttpError(404, `unknown job: ${name}`);
    }
    const result = await enqueueJob(name, req.body);
    res.status(202).json({ enqueued: true, ...result });
  }),
);
