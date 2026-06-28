import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "./queue.js";

const worker = new Worker(
  "seed-tracker",
  async (job) => {
    if (job.name === "track-seeds") {
      const { fullSync } = job.data as { fullSync: boolean };
      const { runTrackingCycle } = await import("../Tools/following_Track/track.js");
      await runTrackingCycle({ fullSync });
    } else if (job.name === "daily-digest") {
      const { sendDailyDigestMessage } = await import("../Tools/following_Track/track.js");
      await sendDailyDigestMessage();
    } else if (job.name === "health-check") {
      const { checkHealth } = await import("../Tools/following_Track/track.js");
      await checkHealth();
    }
  },
  { connection, concurrency: 1 },
);

worker.on("failed", (job, err) => {
  console.error(`[seed-worker] Job ${job?.name} failed:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`[seed-worker] Job ${job.name} completed`);
});

console.log("[seed-worker] Seed tracker worker started");

export { worker };
