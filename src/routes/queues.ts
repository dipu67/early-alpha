// Queue management router — list schedulers with live counts, pause/resume,
// trigger-now, edit interval/cron (persisted in settings), and clean failed jobs.
// The backend drives BullMQ directly on the shared Redis; the running worker
// consumes whatever is scheduled.

import { Router } from "express";
import { z } from "zod";
import {
  getQueue,
  SCHEDULERS,
  getScheduler,
  registerScheduler,
  resolveSchedulerRepeat,
  type SchedulerDef,
} from "../services/queue.js";
import {
  getConfig,
  setConfig,
  schedEveryKey,
  schedCronKey,
  schedPausedKey,
} from "../services/appConfig.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { jsonSafe } from "../http.js";

export const queuesRouter: Router = Router();

queuesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const items = await Promise.all(
      SCHEDULERS.map(async (def) => {
        const queue = getQueue(def.queue);
        const [paused, repeat, schedulers, counts] = await Promise.all([
          getConfig<boolean>(schedPausedKey(def.key), false),
          resolveSchedulerRepeat(def),
          queue.getJobSchedulers(0, 50).catch(() => []),
          queue
            .getJobCounts("waiting", "active", "delayed", "failed", "completed")
            .catch(() => ({})),
        ]);
        const sched = schedulers.find((s) => s.key === def.schedulerId);
        const cron = "pattern" in repeat ? repeat.pattern : null;
        const every = "every" in repeat ? repeat.every : null;
        return {
          key: def.key,
          label: def.label,
          queue: def.queue,
          jobName: def.jobName,
          paused,
          cron,
          every,
          nextRun: sched?.next ?? null,
          counts,
        };
      }),
    );
    res.json({ items: jsonSafe(items) });
  }),
);

function defOr404(key: string | string[] | undefined): SchedulerDef {
  const k = Array.isArray(key) ? key[0] : key;
  const def = k ? getScheduler(k) : undefined;
  if (!def) throw new HttpError(404, `unknown scheduler: ${String(k)}`);
  return def;
}

queuesRouter.post(
  "/:key/pause",
  asyncHandler(async (req, res) => {
    const def = defOr404(req.params.key);
    await setConfig(schedPausedKey(def.key), true);
    await registerScheduler(def);
    res.json({ ok: true, paused: true });
  }),
);

queuesRouter.post(
  "/:key/resume",
  asyncHandler(async (req, res) => {
    const def = defOr404(req.params.key);
    await setConfig(schedPausedKey(def.key), false);
    await registerScheduler(def);
    res.json({ ok: true, paused: false });
  }),
);

queuesRouter.post(
  "/:key/trigger",
  asyncHandler(async (req, res) => {
    const def = defOr404(req.params.key);
    const queue = getQueue(def.queue);
    const job = await queue.add(def.jobName, def.data, { removeOnComplete: 1000, removeOnFail: 5000 });
    res.status(202).json({ enqueued: true, jobId: job.id });
  }),
);

const cronPattern = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (s) => {
      const n = s.trim().split(/\s+/).length;
      return n === 5 || n === 6;
    },
    { message: "cron must have 5 or 6 space-separated fields (e.g. 0 9 * * *)" },
  );

const patchBody = z
  .object({
    every: z.number().int().min(10_000).nullable().optional(),
    cron: cronPattern.nullable().optional(),
  })
  .refine((b) => b.every !== undefined || b.cron !== undefined, {
    message: "provide every or cron",
  });

queuesRouter.patch(
  "/:key",
  asyncHandler(async (req, res) => {
    const def = defOr404(req.params.key);
    const body = patchBody.parse(req.body);
    // Setting one mode clears the other so only one schedule is active.
    if (body.cron !== undefined) {
      const pattern = body.cron?.trim() || null;
      await setConfig(schedCronKey(def.key), pattern);
      // Cron mode clears interval override
      if (pattern) await setConfig(schedEveryKey(def.key), null);
    }
    if (body.every !== undefined) {
      await setConfig(schedEveryKey(def.key), body.every);
      // Interval mode clears cron override
      if (body.every != null) await setConfig(schedCronKey(def.key), null);
    }
    await registerScheduler(def);
    res.json({ ok: true });
  }),
);

queuesRouter.post(
  "/:key/clean-failed",
  asyncHandler(async (req, res) => {
    const def = defOr404(req.params.key);
    const queue = getQueue(def.queue);
    const removed = await queue.clean(0, 1000, "failed");
    res.json({ ok: true, removed: removed.length });
  }),
);
