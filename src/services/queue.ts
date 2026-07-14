import "dotenv/config";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  getConfig,
  schedEveryKey,
  schedCronKey,
  schedPausedKey,
} from "./appConfig.js";

export const connection = new Redis(process.env.REDIS_URL as string, {
  maxRetriesPerRequest: null,
});

export const followTrackerQueue = new Queue("follow-tracker", { connection });
export const seedTrackerQueue = new Queue("seed-tracker", { connection });
export const listTrackerQueue = new Queue("list-tracker", { connection });

const QUEUES = {
  "follow-tracker": followTrackerQueue,
  "seed-tracker": seedTrackerQueue,
  "list-tracker": listTrackerQueue,
} as const;

export type QueueName = keyof typeof QUEUES;

export function getQueueByName(name: string): Queue | undefined {
  return (QUEUES as Record<string, Queue>)[name];
}

/** Like getQueueByName but throws on an unknown name (used by the API routes). */
export function getQueue(name: string): Queue {
  const q = getQueueByName(name);
  if (!q) throw new Error(`Unknown queue: ${name}`);
  return q;
}

// ── Scheduler registry ──
// One entry per repeating job. Defaults come from here; admins can override the
// interval/cron or pause a scheduler via the settings table (see appConfig),
// and the values are applied on the next registration (startup or an API-driven
// re-register). This is the single source of truth the backend API reads to list
// and manage schedulers.

export interface SchedulerDef {
  /** Stable key used in config + the API path. */
  key: string;
  queue: QueueName;
  /** BullMQ scheduler id. */
  schedulerId: string;
  /** Job name the worker switches on. */
  jobName: string;
  /** Static job payload. */
  data: Record<string, unknown>;
  /** Default fixed interval in ms (mutually exclusive with defaultCron). */
  defaultEvery?: number;
  /** Default cron pattern. */
  defaultCron?: string;
  label: string;
}

export const SCHEDULERS: SchedulerDef[] = [
  {
    key: "seed-track",
    queue: "seed-tracker",
    schedulerId: "seed-track-cycle",
    jobName: "track-seeds",
    data: { fullSync: false },
    defaultEvery: 15 * 60 * 1000,
    label: "Seed tracking cycle",
  },
  {
    key: "seed-full-sync",
    queue: "seed-tracker",
    schedulerId: "seed-full-sync",
    jobName: "track-seeds",
    data: { fullSync: true },
    defaultCron: "0 3 * * *",
    label: "Daily full sync",
  },
  {
    key: "daily-digest",
    queue: "seed-tracker",
    schedulerId: "daily-digest",
    jobName: "daily-digest",
    data: {},
    defaultCron: "0 9 * * *",
    label: "Daily digest",
  },
  {
    key: "health-check",
    queue: "seed-tracker",
    schedulerId: "health-check",
    jobName: "health-check",
    data: {},
    defaultEvery: 6 * 60 * 60 * 1000,
    label: "Health check",
  },
  {
    key: "list-reconcile",
    queue: "list-tracker",
    schedulerId: "list-reconcile",
    jobName: "reconcile-lists",
    data: {},
    defaultEvery: 60 * 60 * 1000,
    label: "List reconcile",
  },
  {
    key: "list-poll",
    queue: "list-tracker",
    schedulerId: "list-poll",
    jobName: "poll-lists",
    data: {},
    defaultEvery: 5 * 60 * 1000,
    label: "List poll",
  },
  {
    key: "early-digest",
    queue: "list-tracker",
    schedulerId: "early-digest",
    jobName: "early-digest",
    data: {},
    defaultEvery: 12 * 60 * 60 * 1000,
    label: "Early-project digest",
  },
  {
    key: "search-poll",
    queue: "list-tracker",
    schedulerId: "search-poll",
    jobName: "poll-searches",
    data: {},
    defaultEvery: 60 * 1000,
    label: "Twitter search poll",
  },
  {
    key: "monitor-poll",
    queue: "list-tracker",
    schedulerId: "monitor-poll",
    jobName: "poll-monitors",
    data: {},
    defaultEvery: 2 * 60 * 1000,
    label: "User timeline monitors",
  },
  {
    key: "home-signal-poll",
    queue: "list-tracker",
    schedulerId: "home-signal-poll",
    jobName: "poll-home-signals",
    data: {},
    defaultEvery: 2 * 60 * 1000,
    label: "HomeLatest signal scans",
  },
];

export function getScheduler(key: string): SchedulerDef | undefined {
  return SCHEDULERS.find((s) => s.key === key);
}

/**
 * Register (or, if paused, remove) one scheduler using its config-overridable
 * interval/cron. Called at startup and by the API after an edit.
 */
export async function registerScheduler(def: SchedulerDef): Promise<void> {
  const queue = QUEUES[def.queue];
  const paused = await getConfig<boolean>(schedPausedKey(def.key), false);
  if (paused) {
    await queue.removeJobScheduler(def.schedulerId).catch(() => undefined);
    return;
  }

  const cron = await getConfig<string | null>(schedCronKey(def.key), def.defaultCron ?? null);
  const every = await getConfig<number | null>(schedEveryKey(def.key), def.defaultEvery ?? null);

  const repeat = cron ? { pattern: cron } : { every: every ?? def.defaultEvery ?? 60_000 };

  await queue.upsertJobScheduler(def.schedulerId, repeat, {
    name: def.jobName,
    data: def.data,
  });
}

/** Register every scheduler (startup). */
export async function registerAllSchedulers(): Promise<void> {
  for (const def of SCHEDULERS) {
    await registerScheduler(def);
  }
}

// ── Per-watch dynamic schedulers (unchanged; driven by the WatchList) ──

export async function addWatchJob(watchListId: bigint, username: string): Promise<void> {
  const jobId = `watch-${watchListId.toString()}`;
  await followTrackerQueue.upsertJobScheduler(
    jobId,
    { every: 15 * 60 * 1000 },
    { name: "check-following", data: { watchListId: watchListId.toString(), username } },
  );
}

export async function removeWatchJob(watchListId: bigint): Promise<void> {
  const jobId = `watch-${watchListId.toString()}`;
  await followTrackerQueue.removeJobScheduler(jobId);
}
