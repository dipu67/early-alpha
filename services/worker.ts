import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "./queue.js";
import { checkFollowingDiff } from "./followDiff.js";
import { prisma } from "../db/prisma.js";
import { formatNewFollowAlert } from "./formatAlert.js";
import { sendTelegramAlert } from "../tg/sendAlert.js";
import { bot } from "../index.js";

async function sendAlert(
  influencerUsername: string,
  user: import("../TwitterClient/types.js").UserData,
): Promise<void> {
  try {
    const alertMessage = formatNewFollowAlert(influencerUsername, user);
    await sendTelegramAlert(alertMessage);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    bot.api.sendMessage(process.env.ADMIN_IDS as string, `Failed to send alert for @${user.username}: ${msg}`);
    console.error(`Failed to send alert for @${user.username}:`, error);
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
