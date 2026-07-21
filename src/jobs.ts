// Job contract — the single source of truth for what the backend is allowed to
// enqueue, which queue each job lands on, the BullMQ job NAME the worker matches,
// and a zod schema validating the payload.
//
// This is the ONLY coupling between the backend and early-alpha: both sides must
// agree on (queueName, jobName, payload). Reads go direct to Postgres; every
// action is one of these jobs.
//
// Status column:
//   [existing] — early-alpha already has a worker handler; enqueue works today.
//   [new]      — needs a handler added in early-alpha (premise 3) before it runs;
//                the backend can enqueue now and the job waits in Redis.

import { z } from "zod";
import type { QueueName } from "./services/queue.js";

export interface JobDef<S extends z.ZodTypeAny> {
  queue: QueueName;
  /** BullMQ job name the early-alpha Worker switches on. */
  jobName: string;
  /** Payload validator. */
  schema: S;
  /** Whether early-alpha already consumes this job. */
  existing: boolean;
}

// Helper to keep each entry terse and correctly typed.
function def<S extends z.ZodTypeAny>(d: JobDef<S>): JobDef<S> {
  return d;
}

export const JOBS = {
  // ── list-tracker (services/listWorker.ts) ──
  "reconcile-lists": def({
    queue: "list-tracker",
    jobName: "reconcile-lists",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "poll-lists": def({
    queue: "list-tracker",
    jobName: "poll-lists",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "early-digest": def({
    queue: "list-tracker",
    jobName: "early-digest",
    schema: z.object({}).strict(),
    existing: true,
  }),

  // ── seed-tracker (services/seedWorker.ts) ──
  "track-seeds": def({
    queue: "seed-tracker",
    jobName: "track-seeds",
    schema: z.object({ fullSync: z.boolean().default(false) }).strict(),
    existing: true,
  }),
  "daily-digest": def({
    queue: "seed-tracker",
    jobName: "daily-digest",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "health-check": def({
    queue: "seed-tracker",
    jobName: "health-check",
    schema: z.object({}).strict(),
    existing: true,
  }),

  // ── new jobs (need handlers added in early-alpha — premise 3) ──
  "list-delete": def({
    queue: "list-tracker",
    jobName: "list-delete",
    schema: z.object({ all: z.boolean().default(false) }).strict(),
    existing: false,
  }),
  reclassify: def({
    queue: "list-tracker",
    jobName: "reclassify",
    schema: z
      .object({
        accountId: z.string().min(1),
        tags: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    existing: true,
  }),
  "poll-searches": def({
    queue: "list-tracker",
    jobName: "poll-searches",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "poll-list-monitors": def({
    queue: "list-tracker",
    jobName: "poll-list-monitors",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "poll-chainlist": def({
    queue: "list-tracker",
    jobName: "poll-chainlist",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "poll-github-repos": def({
    queue: "list-tracker",
    jobName: "poll-github-repos",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "poll-monitors": def({
    queue: "list-tracker",
    jobName: "poll-monitors",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "poll-home-signals": def({
    queue: "list-tracker",
    jobName: "poll-home-signals",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "poll-early-projects": def({
    queue: "list-tracker",
    jobName: "poll-early-projects",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "growth-report": def({
    queue: "list-tracker",
    jobName: "growth-report",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "tag-seed": def({
    queue: "list-tracker",
    jobName: "tag-seed",
    schema: z.object({}).strict(),
    existing: true,
  }),
  "tag-backfill": def({
    queue: "list-tracker",
    jobName: "tag-backfill",
    schema: z
      .object({
        onlyUnknown: z.boolean().optional().default(false),
        limit: z.number().int().positive().optional(),
      })
      .strict(),
    existing: true,
  }),
} as const;

export type JobName = keyof typeof JOBS;

export const JOB_NAMES = Object.keys(JOBS) as JobName[];

export function isJobName(x: string): x is JobName {
  return Object.prototype.hasOwnProperty.call(JOBS, x);
}
