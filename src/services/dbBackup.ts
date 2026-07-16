// Full-database JSON backup / restore.
//
// Export dumps every application table. Import restores in FK-safe order.
// Modes:
//   merge   — upsert / createMany skipDuplicates (keep existing rows)
//   replace — wipe target tables (reverse FK order) then insert from backup

import { prisma } from "../db/prisma.js";

export type BackupMode = "merge" | "replace";

/** Prisma client delegate key → table map name for the backup file. */
export type BackupTableKey =
  | "projectTag"
  | "adminUser"
  | "setting"
  | "telegramBot"
  | "twitterAuthAccount"
  | "twitterAccount"
  | "seedAccount"
  | "trackingRun"
  | "watchList"
  | "projectList"
  | "searchQuery"
  | "listMonitor"
  | "grokConversation"
  | "grokResearchPrompt"
  | "listMember"
  | "postAlert"
  | "followEdge"
  | "alert"
  | "searchHit"
  | "followSnapshot"
  | "alertLog"
  | "grokMessage"
  | "grokResearchRun"
  | "telegramGroup"
  | "telegramTopic";

export interface BackupTableDef {
  key: BackupTableKey;
  /** Human / SQL table name stored in the backup JSON. */
  table: string;
  /** Fields that must be BigInt on write (ids, FKs). */
  bigints: string[];
  /** Fields that must be Date on write. */
  dates: string[];
}

/**
 * Insert order: parents before children.
 * Wipe order for replace = reverse of this list.
 */
export const BACKUP_TABLES: BackupTableDef[] = [
  {
    key: "projectTag",
    table: "project_tags",
    bigints: [],
    dates: ["createdAt"],
  },
  {
    key: "adminUser",
    table: "admin_users",
    bigints: ["id"],
    dates: ["createdAt", "updatedAt"],
  },
  {
    key: "setting",
    table: "settings",
    bigints: [],
    dates: ["updatedAt"],
  },
  {
    key: "telegramBot",
    table: "telegram_bots",
    bigints: ["id"],
    dates: ["createdAt", "updatedAt"],
  },
  {
    key: "twitterAuthAccount",
    table: "twitter_auth_accounts",
    bigints: ["id"],
    dates: ["rateLimitedUntil", "lastUsedAt", "createdAt", "updatedAt"],
  },
  {
    key: "twitterAccount",
    table: "twitter_accounts",
    bigints: [],
    dates: [
      "createdAt",
      "detectedAt",
      "firstSeenAt",
      "updatedAt",
      "listsSyncedAt",
      "huntUpdatedAt",
    ],
  },
  {
    key: "seedAccount",
    table: "seed_accounts",
    bigints: ["id"],
    dates: ["createdAt", "updatedAt"],
  },
  {
    key: "trackingRun",
    table: "tracking_runs",
    bigints: ["id"],
    dates: ["startedAt", "finishedAt"],
  },
  {
    key: "watchList",
    table: "watch_list",
    bigints: ["id"],
    dates: ["createdAt", "updatedAt"],
  },
  {
    key: "projectList",
    table: "project_lists",
    bigints: ["id", "authAccountId"],
    dates: ["lastPolledAt", "createdAt"],
  },
  {
    key: "searchQuery",
    table: "search_queries",
    bigints: ["id", "authAccountId"],
    dates: ["lastPolledAt", "createdAt", "updatedAt"],
  },
  {
    key: "listMonitor",
    table: "list_monitors",
    bigints: ["id", "authAccountId"],
    dates: ["lastPolledAt", "createdAt", "updatedAt"],
  },
  {
    key: "grokConversation",
    table: "grok_conversations",
    bigints: ["id"],
    dates: ["createdAt", "updatedAt", "lastMessageAt"],
  },
  {
    key: "grokResearchPrompt",
    table: "grok_research_prompts",
    bigints: ["id"],
    dates: ["createdAt", "updatedAt"],
  },
  {
    key: "listMember",
    table: "list_members",
    bigints: [],
    dates: ["addedAt"],
  },
  {
    key: "postAlert",
    table: "post_alerts",
    bigints: [],
    dates: ["postedAt", "createdAt"],
  },
  {
    key: "followEdge",
    table: "follow_edges",
    bigints: ["seedId", "firstSeenRunId", "lastSeenRunId"],
    dates: ["firstSeenAt", "lastSeenAt"],
  },
  {
    key: "alert",
    table: "alerts",
    bigints: ["id", "runId"],
    dates: ["createdAt"],
  },
  {
    key: "searchHit",
    table: "search_hits",
    bigints: ["id", "queryId"],
    dates: ["postedAt", "createdAt"],
  },
  {
    key: "followSnapshot",
    table: "follow_snapshots",
    bigints: ["id", "watchListId"],
    dates: ["takenAt"],
  },
  {
    key: "alertLog",
    table: "alert_logs",
    bigints: ["id", "watchListId"],
    dates: ["sentAt"],
  },
  {
    key: "grokMessage",
    table: "grok_messages",
    bigints: ["id", "conversationDbId", "telegramMessageId"],
    dates: ["createdAt"],
  },
  {
    key: "grokResearchRun",
    table: "grok_research_runs",
    bigints: ["id", "promptId"],
    dates: ["createdAt", "completedAt"],
  },
  {
    key: "telegramGroup",
    table: "telegram_groups",
    bigints: ["id", "botDbId"],
    dates: ["createdAt", "updatedAt"],
  },
  {
    key: "telegramTopic",
    table: "telegram_topics",
    bigints: ["id", "groupId"],
    dates: ["createdAt", "updatedAt"],
  },
];

export const BACKUP_FORMAT = "early-alpha-db-backup" as const;
export const BACKUP_VERSION = 1 as const;

export interface DbBackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  app: string;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
}

type Delegate = {
  findMany: (args?: { take?: number }) => Promise<Record<string, unknown>[]>;
  count: () => Promise<number>;
  deleteMany: (args?: object) => Promise<{ count: number }>;
  createMany: (args: {
    data: Record<string, unknown>[];
    skipDuplicates?: boolean;
  }) => Promise<{ count: number }>;
};

function delegate(key: BackupTableKey): Delegate {
  // Prisma client model accessors are camelCase matching our keys.
  return (prisma as unknown as Record<string, Delegate>)[key]!;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "bigint") out[k] = v.toString();
    else if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}

function reviveRow(
  def: BackupTableDef,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const f of def.bigints) {
    if (out[f] === null || out[f] === undefined || out[f] === "") {
      out[f] = null;
      continue;
    }
    try {
      out[f] = BigInt(String(out[f]));
    } catch {
      out[f] = null;
    }
  }
  for (const f of def.dates) {
    if (out[f] === null || out[f] === undefined || out[f] === "") {
      out[f] = null;
      continue;
    }
    const d = new Date(String(out[f]));
    out[f] = Number.isNaN(d.getTime()) ? null : d;
  }
  return out;
}

export async function getBackupSummary(): Promise<{
  tables: { key: string; table: string; count: number }[];
  totalRows: number;
}> {
  const tables: { key: string; table: string; count: number }[] = [];
  let totalRows = 0;
  for (const def of BACKUP_TABLES) {
    const count = await delegate(def.key).count();
    tables.push({ key: def.key, table: def.table, count });
    totalRows += count;
  }
  return { tables, totalRows };
}

export async function exportDatabase(): Promise<DbBackupFile> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const def of BACKUP_TABLES) {
    const rows = await delegate(def.key).findMany();
    tables[def.table] = rows.map((r) => serializeRow(r));
    counts[def.table] = rows.length;
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: "early-alpha",
    tables,
    counts,
  };
}

export function parseBackupPayload(raw: unknown): DbBackupFile {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid_backup: not an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.format !== BACKUP_FORMAT) {
    throw new Error(`invalid_backup: expected format ${BACKUP_FORMAT}`);
  }
  if (typeof o.version !== "number") {
    throw new Error("invalid_backup: missing version");
  }
  if (!o.tables || typeof o.tables !== "object") {
    throw new Error("invalid_backup: missing tables");
  }
  return {
    format: BACKUP_FORMAT,
    version: o.version as typeof BACKUP_VERSION,
    exportedAt: String(o.exportedAt ?? ""),
    app: String(o.app ?? "early-alpha"),
    tables: o.tables as Record<string, unknown[]>,
    counts: (o.counts as Record<string, number>) ?? {},
  };
}

const BATCH = 500;

export async function importDatabase(
  backup: DbBackupFile,
  mode: BackupMode,
): Promise<{
  mode: BackupMode;
  imported: Record<string, number>;
  wiped: Record<string, number>;
  errors: string[];
}> {
  const imported: Record<string, number> = {};
  const wiped: Record<string, number> = {};
  const errors: string[] = [];

  // Optional wipe in reverse dependency order
  if (mode === "replace") {
    for (const def of [...BACKUP_TABLES].reverse()) {
      try {
        const r = await delegate(def.key).deleteMany({});
        wiped[def.table] = r.count;
      } catch (err) {
        errors.push(
          `wipe ${def.table}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  for (const def of BACKUP_TABLES) {
    const rows = backup.tables[def.table];
    if (!Array.isArray(rows) || rows.length === 0) {
      imported[def.table] = 0;
      continue;
    }

    let ok = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH) as Record<string, unknown>[];
      const data = slice.map((r) => reviveRow(def, r));
      try {
        const r = await delegate(def.key).createMany({
          data,
          skipDuplicates: mode === "merge",
        });
        ok += r.count;
      } catch (err) {
        // Fallback: try one-by-one so one bad row doesn't kill the batch
        for (const row of data) {
          try {
            const r = await delegate(def.key).createMany({
              data: [row],
              skipDuplicates: true,
            });
            ok += r.count;
          } catch (e2) {
            errors.push(
              `${def.table}: ${e2 instanceof Error ? e2.message : String(e2)}`,
            );
          }
        }
        if (errors.length > 50) {
          errors.push("…truncated further errors");
          break;
        }
      }
    }
    imported[def.table] = ok;
  }

  return { mode, imported, wiped, errors };
}
