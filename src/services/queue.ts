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

export const seedTrackerQueue = new Queue("seed-tracker", { connection });
export const listTrackerQueue = new Queue("list-tracker", { connection });

const QUEUES = {
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
    key: "search-poll",
    queue: "list-tracker",
    schedulerId: "search-poll",
    jobName: "poll-searches",
    data: {},
    defaultEvery: 60 * 1000,
    label: "Twitter search poll",
  },
  {
    key: "list-monitor-poll",
    queue: "list-tracker",
    schedulerId: "list-monitor-poll",
    jobName: "poll-list-monitors",
    data: {},
    defaultEvery: 60 * 1000,
    label: "Public Twitter list monitors",
  },
  {
    key: "chainlist-poll",
    queue: "list-tracker",
    schedulerId: "chainlist-poll",
    jobName: "poll-chainlist",
    data: {},
    defaultEvery: 60 * 60 * 1000,
    label: "New chains (rpcs.json + GitHub registry)",
  },
  {
    key: "github-repo-poll",
    queue: "list-tracker",
    schedulerId: "github-repo-poll",
    jobName: "poll-github-repos",
    data: {},
    defaultEvery: 5 * 60 * 1000,
    label: "GitHub repo commit monitors",
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
    key: "watching-poll",
    queue: "list-tracker",
    schedulerId: "watching-poll",
    jobName: "poll-watching",
    data: {},
    defaultEvery: 3600 * 1000,
    label: "Watching projects poll (1h)",
  },
  {
    key: "growth-report",
    queue: "list-tracker",
    schedulerId: "growth-report",
    jobName: "growth-report",
    data: {},
    defaultCron: "0 10 * * 1",
    label: "Weekly top growing projects (Mon 10:00 UTC)",
  },
];

export function getScheduler(key: string): SchedulerDef | undefined {
  return SCHEDULERS.find((s) => s.key === key);
}

/**
 * Resolve active repeat options for a scheduler.
 *
 * Settings keys `sched.<key>.cron` / `sched.<key>.every`:
 * - missing / JSON null → use def.defaultCron or def.defaultEvery
 * - non-empty cron string → cron mode
 * - numeric every ≥ 10s → interval mode (only if cron override not set)
 * Cron and every are mutually exclusive; cron wins if both overrides exist.
 */
export async function resolveSchedulerRepeat(
  def: SchedulerDef,
): Promise<{ pattern: string } | { every: number }> {
  // No fallback: undefined = key absent, null = explicitly cleared
  const cronRaw = await getConfig<string | null | undefined>(
    schedCronKey(def.key),
    undefined,
  );
  const everyRaw = await getConfig<number | null | undefined>(
    schedEveryKey(def.key),
    undefined,
  );

  const cronOverride =
    typeof cronRaw === "string" && cronRaw.trim().length > 0
      ? cronRaw.trim()
      : null;
  const everyOverride =
    typeof everyRaw === "number" &&
    Number.isFinite(everyRaw) &&
    everyRaw >= 10_000
      ? everyRaw
      : null;

  if (cronOverride) return { pattern: cronOverride };
  if (everyOverride != null) return { every: everyOverride };

  if (def.defaultCron && def.defaultCron.trim().length > 0) {
    return { pattern: def.defaultCron.trim() };
  }
  if (def.defaultEvery != null && def.defaultEvery >= 10_000) {
    return { every: def.defaultEvery };
  }
  return { every: 60_000 };
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

  const repeat = await resolveSchedulerRepeat(def);
  await queue.upsertJobScheduler(def.schedulerId, repeat, {
    name: def.jobName,
    data: def.data,
  });
}

/**
 * Recurring jobs that were removed from SCHEDULERS — strip from Redis so an
 * old process restart does not leave them running forever.
 */
const REMOVED_SCHEDULERS: { queue: QueueName; schedulerId: string }[] = [
  { queue: "list-tracker", schedulerId: "list-reconcile" },
  { queue: "list-tracker", schedulerId: "list-poll" },
];

/** Register every scheduler (startup). */
export async function registerAllSchedulers(): Promise<void> {
  for (const dead of REMOVED_SCHEDULERS) {
    await QUEUES[dead.queue]
      .removeJobScheduler(dead.schedulerId)
      .catch(() => undefined);
  }
  for (const def of SCHEDULERS) {
    await registerScheduler(def);
  }
}


