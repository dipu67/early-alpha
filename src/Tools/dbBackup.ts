// CLI database backup / restore.
//
//   npm run db:export -- ./backup.json
//   npm run db:import -- ./backup.json
//   npm run db:import -- ./backup.json --replace
//
// Same logic as the admin Backup page / API.

import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../db/prisma.js";
import {
  exportDatabase,
  importDatabase,
  parseBackupPayload,
  getBackupSummary,
} from "../services/dbBackup.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "summary" || cmd === undefined) {
    const s = await getBackupSummary();
    console.log(`[db:backup] total rows: ${s.totalRows}`);
    for (const t of s.tables) {
      console.log(`  ${t.table.padEnd(28)} ${t.count}`);
    }
    return;
  }

  if (cmd === "export") {
    const out = resolve(args[1] ?? `early-alpha-backup-${Date.now()}.json`);
    const full = args.includes("--full");
    const backup = await exportDatabase({ fullSnapshots: full });
    await writeFile(out, JSON.stringify(backup, null, 2), "utf-8");
    const n = Object.values(backup.counts).reduce((a, b) => a + b, 0);
    console.log(
      `[db:export] wrote ${n} rows → ${out} (compact=${backup.compact})`,
    );
    for (const w of backup.warnings) console.log(`[db:export] note: ${w}`);
    return;
  }

  if (cmd === "import") {
    const file = args[1];
    if (!file) {
      console.error("Usage: npm run db:import -- <file.json> [--replace]");
      process.exitCode = 1;
      return;
    }
    const mode = args.includes("--replace") ? "replace" : "merge";
    const raw = JSON.parse(await readFile(resolve(file), "utf-8"));
    const backup = parseBackupPayload(raw);
    console.log(
      `[db:import] mode=${mode} source=${backup.exportedAt || "unknown"}`,
    );
    const result = await importDatabase(backup, mode);
    for (const [t, c] of Object.entries(result.imported)) {
      if (c > 0) console.log(`  + ${t}: ${c}`);
    }
    for (const [t, c] of Object.entries(result.skipped ?? {})) {
      if (c > 0) console.log(`  ~ skipped ${t}: ${c}`);
    }
    if (mode === "replace") {
      for (const [t, c] of Object.entries(result.wiped)) {
        if (c > 0) console.log(`  - wiped ${t}: ${c}`);
      }
    }
    if (result.errors.length) {
      console.warn(`[db:import] ${result.errors.length} error(s):`);
      for (const e of result.errors.slice(0, 20)) console.warn(`  ! ${e}`);
    }
    console.log("[db:import] done");
    return;
  }

  console.error("Usage: dbBackup.ts [summary|export|import] ...");
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[db:backup] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
