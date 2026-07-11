import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "./queue.js";
import { prisma } from "../db/prisma.js";
import { getListClient } from "../twitter/getClient.js";
import { reconcileAccountLists, type ListSyncCtx } from "./projectLists.js";
import { pollAllLists } from "./listPoller.js";

/** Accounts reconciled per cycle — bounded to stay under add-member limits. */
const RECONCILE_BATCH = Number(process.env.LIST_RECONCILE_BATCH ?? 40);

async function runReconcile(): Promise<void> {
  const { client, accountId, ownerUserId } = await getListClient();
  const ctx: ListSyncCtx = { client, authAccountId: accountId, ownerUserId };

  // Accounts never synced, or changed since their last sync (tags may differ).
  const pending = await prisma.$queryRaw<{ id: string; tags: string[] }[]>`
    SELECT "id", "tags" FROM "twitter_accounts"
    WHERE "lists_synced_at" IS NULL OR "updated_at" > "lists_synced_at"
    ORDER BY "lists_synced_at" ASC NULLS FIRST
    LIMIT ${RECONCILE_BATCH}
  `;

  let synced = 0;
  for (const account of pending) {
    try {
      await reconcileAccountLists(ctx, account);
      synced++;
    } catch (err) {
      console.error(`[list-worker] reconcile ${account.id} failed:`, err);
    }
  }
  console.log(`[list-worker] reconciled ${synced}/${pending.length} accounts`);
}

async function runPoll(): Promise<void> {
  const { client, accountId, ownerUserId } = await getListClient();
  await pollAllLists({ client: client, authAccountId: accountId, ownerUserId });
}

// const worker = new Worker(
//   "list-tracker",
//   async (job) => {
//     if (job.name === "reconcile-lists") {
//       await runReconcile();
//     } else if (job.name === "poll-lists") {
//       await runPoll();
//     } else if (job.name === "early-digest") {
//       const { sendEarlyProjectDigest } = await import("./earlyDigest.js");
//       await sendEarlyProjectDigest();
//     }
//   },
//   { connection, concurrency: 1 },
// );

// worker.on("failed", (job, err) => {
//   console.error(`[list-worker] Job ${job?.name} failed:`, err.message);
// });

// worker.on("completed", (job) => {
//   console.log(`[list-worker] Job ${job.name} completed`);
// });

// console.log("[list-worker] List tracker worker started");

// export { worker };
