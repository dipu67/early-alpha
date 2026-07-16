import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "./queue.js";
import { prisma } from "../db/prisma.js";
import { getListClient } from "../twitter/getClient.js";
import {
  reconcileAccountLists,
  setAccountTags,
  ListDailyAddLimitError,
  type ListSyncCtx,
} from "./projectLists.js";
import { pollAllLists } from "./listPoller.js";

/** Accounts reconciled per cycle — bounded to stay under add-member limits. */
const RECONCILE_BATCH = Number(process.env.LIST_RECONCILE_BATCH ?? 40);

async function runReconcile(): Promise<void> {
  const { client, accountId, ownerUserId, username } = await getListClient();
  const ctx: ListSyncCtx = { client, authAccountId: accountId, ownerUserId };

  // Skip cycle if this auth already hit the daily list-add cap (paused until tomorrow).
  const auth = await prisma.twitterAuthAccount.findUnique({
    where: { id: accountId },
    select: { rateLimitedUntil: true },
  });
  if (auth?.rateLimitedUntil && auth.rateLimitedUntil.getTime() > Date.now()) {
    console.warn(
      `[list-worker] reconcile skipped — @${username} list-add paused until ${auth.rateLimitedUntil.toISOString()} (try tomorrow)`,
    );
    return;
  }

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
      if (err instanceof ListDailyAddLimitError) {
        console.warn(
          `[list-worker] daily list-add limit hit on @${username} while reconciling ${account.id} — ` +
            `stopping batch, will retry tomorrow`,
        );
        break;
      }
      console.error(`[list-worker] reconcile ${account.id} failed:`, err);
    }
  }
  console.log(`[list-worker] reconciled ${synced}/${pending.length} accounts`);
}

async function runPoll(): Promise<void> {
  const { client, accountId, ownerUserId } = await getListClient();
  await pollAllLists({ client, authAccountId: accountId, ownerUserId });
}

async function runReclassify(data: {
  accountId: string;
  tags: string[];
}): Promise<void> {
  const { client, accountId, ownerUserId } = await getListClient();
  const ctx: ListSyncCtx = { client, authAccountId: accountId, ownerUserId };
  try {
    const result = await setAccountTags(data.accountId, data.tags, ctx);
    if (!result) {
      console.warn(`[list-worker] reclassify: account ${data.accountId} not found or empty tags`);
      return;
    }
    console.log(
      `[list-worker] reclassify ${data.accountId} → [${result.tags.join(", ")}] ` +
        `lists +${result.added.join(",") || "—"} -${result.removed.join(",") || "—"}`,
    );
  } catch (err) {
    if (err instanceof ListDailyAddLimitError) {
      // Tags were already written by the API; list membership retries tomorrow.
      console.warn(
        `[list-worker] reclassify: daily list-add limit — tags saved, list sync deferred until tomorrow`,
      );
      return;
    }
    throw err;
  }
}

async function runListDelete(data: { all?: boolean }): Promise<void> {
  // Optional admin job — full delete is handled by Tools/tagger/deleteLists when needed.
  // Keep a safe no-op-with-log if the tool isn't imported here yet.
  console.warn(
    `[list-worker] list-delete received (all=${Boolean(data.all)}) — use npm run list:delete for full wipe`,
  );
}

const worker = new Worker(
  "list-tracker",
  async (job) => {
    if (job.name === "reconcile-lists") {
      await runReconcile();
    } else if (job.name === "poll-lists") {
      await runPoll();
    } else if (job.name === "early-digest") {
      const { sendEarlyProjectDigest } = await import("./earlyDigest.js");
      await sendEarlyProjectDigest();
    } else if (job.name === "reclassify") {
      const data = job.data as { accountId: string; tags: string[] };
      await runReclassify(data);
    } else if (job.name === "list-delete") {
      await runListDelete(job.data as { all?: boolean });
    } else if (job.name === "poll-searches") {
      const { pollAllSearchQueries } = await import("./searchPoller.js");
      await pollAllSearchQueries();
    } else if (job.name === "poll-list-monitors") {
      const { pollAllListMonitors } = await import("./listMonitorPoller.js");
      await pollAllListMonitors();
    } else if (job.name === "poll-monitors") {
      // Manual monitors only — never auto-enroll from hunter heat
      const { pollAllMonitors } = await import("./projectMonitor.js");
      await pollAllMonitors();
    } else if (job.name === "poll-home-signals") {
      const { pollAllSignalScans } = await import("./homeSignalScan.js");
      const { seedDefaultSignalRules } = await import("./signalRules.js");
      await seedDefaultSignalRules();
      await pollAllSignalScans();
    } else if (job.name === "tag-seed") {
      const { seedKeywordsFromLexicon } = await import("./tagTools.js");
      const r = await seedKeywordsFromLexicon();
      console.log(
        `[list-worker] tag-seed: ${r.tagCount} tags, ${r.keywordCount} keywords, ${r.handleCount} handle tokens`,
      );
    } else if (job.name === "tag-backfill") {
      const data = job.data as { onlyUnknown?: boolean; limit?: number };
      const { backfillAccountTags } = await import("./tagTools.js");
      const r = await backfillAccountTags({
        onlyUnknown: data.onlyUnknown ?? false,
        ...(data.limit !== undefined ? { limit: data.limit } : {}),
        onProgress: (p) =>
          console.log(
            `[list-worker] tag-backfill progress scanned=${p.scanned} updated=${p.updated}`,
          ),
      });
      console.log(
        `[list-worker] tag-backfill done scanned=${r.scanned} updated=${r.updated} unchanged=${r.unchanged}`,
      );
    } else {
      console.warn(`[list-worker] unknown job: ${job.name}`);
    }
  },
  { connection, concurrency: 1 },
);

worker.on("failed", (job, err) => {
  console.error(`[list-worker] Job ${job?.name} failed:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`[list-worker] Job ${job.name} completed`);
});

console.log("[list-worker] List tracker worker started");

export { worker };
