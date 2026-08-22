import "dotenv/config";
import { prisma } from "../db/prisma.js";

async function main(): Promise<void> {
  const days = Number(process.argv[2] ?? process.env.PRUNE_FOLLOW_EDGE_STALE_DAYS ?? 90);
  const [result] = await prisma.$queryRaw<{ deleted_rows: bigint }[]>`
    SELECT * FROM prune_follow_edges(${days})
  `;
  const count = result?.deleted_rows ?? 0n;
  console.log(
    `[prune-edges] deleted ${count} inactive follow_edges older than ${days}d`,
  );
}

main()
  .catch((err) => {
    console.error("[prune-edges] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });