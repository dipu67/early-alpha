import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "./queue.js";
import { checkFollowingDiff } from "./followDiff.js";
import { prisma } from "../db/prisma.js";
import { formatNewFollowAlert } from "./formatAlert.js";
import { sendTelegramAlert, isAlertEnabled, sendTelegramPlaintext } from "../tg/sendAlert.js";

// Keep the process alive if Twitter homepage/ondemand parsing throws outside
// a job await chain (Node 24 exits on unhandled rejections by default).
process.on("unhandledRejection", (reason) => {
  console.error("[worker] unhandledRejection (non-fatal):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[worker] uncaughtException (non-fatal):", err);
});

async function sendAlert(
  influencerUsername: string,
  user: import("../TwitterClient/types.js").UserData,
): Promise<void> {
  try {
    if (!(await isAlertEnabled("newFollow"))) return;
    const alertMessage = await formatNewFollowAlert(influencerUsername, user);
    await sendTelegramAlert(alertMessage, "MarkdownV2", undefined, "newFollow");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Failed to send alert for @${user.username}:`, error);
    void sendTelegramPlaintext(
      `Failed to send newFollow alert for @${user.username}: ${msg}`,
    ).catch(() => undefined);
  }
}

const worker = new Worker(
  "follow-tracker",
  async (job) => {
    const { watchListId, username } = job.data as {
      watchListId: string;
      username: string;
    };
    const id = BigInt(watchListId);


    const { newFollows } = await checkFollowingDiff(id);

    if (newFollows.length === 0) {
      // console.log(`[worker] No new follows for @${username}`);
      return;
    }


    for (const user of newFollows) {
      await sendAlert(username, user);

      await prisma.alertLog.create({
        data: {
          watchListId: id,
          newFollowId: user.id,
          newFollowUsername: user.username,
        },
      });
    }
  },
  { connection },
);

worker.on("failed", (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

console.log("[worker] Follow tracker worker started");

export { worker };
