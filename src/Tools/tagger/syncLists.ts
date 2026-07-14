import "dotenv/config";
import { prisma } from "../../db/prisma.js";
import { getListClient } from "../../twitter/getClient.js";
import { reconcileAccountLists, type ListSyncCtx } from "../../services/projectLists.js";

// One-shot bootstrap: reconcile every tagged account into its Twitter list(s).
// The scheduled `reconcile-lists` job does this incrementally; this runs it on
// demand from the CLI, in bounded batches, until nothing is left to sync.
//
//   npm run list:sync

const BATCH = Number(process.env.LIST_RECONCILE_BATCH ?? 40);

async function main(): Promise<void> {
  const { client, accountId, ownerUserId } = await getListClient();
  const ctx: ListSyncCtx = { client, authAccountId: accountId, ownerUserId };

  let total = 0;
  for (;;) {
    const pending = await prisma.$queryRaw<{ id: string; tags: string[] }[]>`
      SELECT "id", "tags" FROM "twitter_accounts"
      WHERE "lists_synced_at" IS NULL OR "updated_at" > "lists_synced_at"
      ORDER BY "lists_synced_at" ASC NULLS FIRST
      LIMIT ${BATCH}
    `;
    if (pending.length === 0) break;

    for (const account of pending) {
      try {
        const { added, removed } = await reconcileAccountLists(ctx, account);
        if (added.length || removed.length) {
          console.log(`[list:sync] ${account.id}: +[${added.join(",")}] -[${removed.join(",")}]`);
        }
        total++;
      } catch (err) {
        console.error(`[list:sync] ${account.id} failed:`, err);
      }
    }
    console.log(`[list:sync] synced ${total} so far…`);
  }

  console.log(`[list:sync] done — reconciled ${total} accounts`);
}

main()
  .catch((err) => {
    console.error("[list:sync] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
