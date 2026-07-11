import "dotenv/config";
import { bot } from "./tg/bots.js";
import {grokBot} from "./tg/grokBot.js";
import "./services/worker.js";
import "./services/seedWorker.js";
import "./services/listWorker.js";
import {
  addSeedTrackingJob,
  addDailyFullSyncJob,
  addDailyDigestJob,
  addHealthCheckJob,
  addListReconcileJob,
  addListPollJob,
  addEarlyDigestJob,
} from "./services/queue.js";

export { prisma } from "./db/prisma.js";
export { getTwitterClient, markRateLimited } from "./twitter/getClient.js";
export { TwitterClient } from "./TwitterClient/TwitterClient.js";
export { followTrackerQueue, addWatchJob, removeWatchJob } from "./services/queue.js";
export { checkFollowingDiff } from "./services/followDiff.js";
export { bot } from "./tg/bots.js";

bot.start();
console.log("[bot] Telegram bot started");
grokBot.start();
console.log("[bot] Grok bot started");

await addSeedTrackingJob();
await addDailyFullSyncJob();
await addDailyDigestJob();
await addHealthCheckJob();
await addListReconcileJob();
await addListPollJob();
await addEarlyDigestJob();
console.log("[scheduler] Seed tracking + list monitoring jobs registered");
