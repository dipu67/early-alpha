import "dotenv/config";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const connection = new Redis(process.env.REDIS_URL as string, {
  maxRetriesPerRequest: null,
});

export const followTrackerQueue = new Queue("follow-tracker", { connection });

export async function addWatchJob(watchListId: bigint, username: string): Promise<void> {
  const jobId = `watch-${watchListId.toString()}`;

  await followTrackerQueue.upsertJobScheduler(
    jobId,
    { every: 15 * 60 * 1000 },
    {
      name: "check-following",
      data: { watchListId: watchListId.toString(), username },
    },
  );
}

export async function removeWatchJob(watchListId: bigint): Promise<void> {
  const jobId = `watch-${watchListId.toString()}`;
  await followTrackerQueue.removeJobScheduler(jobId);
}

export const seedTrackerQueue = new Queue("seed-tracker", { connection });

export async function addSeedTrackingJob(): Promise<void> {
  await seedTrackerQueue.upsertJobScheduler(
    "seed-track-cycle",
    { every: 15 * 60 * 1000 },
    { name: "track-seeds", data: { fullSync: false } },
  );
}

export async function addDailyFullSyncJob(): Promise<void> {
  await seedTrackerQueue.upsertJobScheduler(
    "seed-full-sync",
    { pattern: "0 3 * * *" },
    { name: "track-seeds", data: { fullSync: true } },
  );
}

export async function addDailyDigestJob(): Promise<void> {
  await seedTrackerQueue.upsertJobScheduler(
    "daily-digest",
    { pattern: "0 9 * * *" },
    { name: "daily-digest", data: {} },
  );
}

export async function addHealthCheckJob(): Promise<void> {
  await seedTrackerQueue.upsertJobScheduler(
    "health-check",
    { every: 6 * 60 * 60 * 1000 },
    { name: "health-check", data: {} },
  );
}

export const listTrackerQueue = new Queue("list-tracker", { connection });

export async function addListReconcileJob(): Promise<void> {
  await listTrackerQueue.upsertJobScheduler(
    "list-reconcile",
    { every: 60 * 60 * 1000 },
    { name: "reconcile-lists", data: {} },
  );
}

export async function addListPollJob(): Promise<void> {
  await listTrackerQueue.upsertJobScheduler(
    "list-poll",
    { every: 5 * 60 * 1000 },
    { name: "poll-lists", data: {} },
  );
}

export async function addEarlyDigestJob(): Promise<void> {
  await listTrackerQueue.upsertJobScheduler(
    "early-digest",
    { every: 12 * 60 * 60 * 1000 },
    { name: "early-digest", data: {} },
  );
}
