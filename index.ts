import "dotenv/config";
import { bot } from "./tg/bots.js";
import "./services/worker.js";
import "./services/seedWorker.js";
import {
  addSeedTrackingJob,
  addDailyFullSyncJob,
  addDailyDigestJob,
  addHealthCheckJob,
} from "./services/queue.js";

export { prisma } from "./db/prisma.js";
export { getTwitterClient, markRateLimited } from "./twitter/getClient.js";
export { TwitterClient } from "./TwitterClient/TwitterClient.js";
export { followTrackerQueue, addWatchJob, removeWatchJob } from "./services/queue.js";
export { checkFollowingDiff } from "./services/followDiff.js";
export { bot } from "./tg/bots.js";

bot.start();
console.log("[bot] Telegram bot started");

await addSeedTrackingJob();
await addDailyFullSyncJob();
await addDailyDigestJob();
await addHealthCheckJob();
console.log("[scheduler] Seed tracking jobs registered");
