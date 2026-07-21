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
  /** Hint for UI: follow_snapshots explode size (each row holds full following id lists). */
  notes?: string[];
}> {
  const tables: { key: string; table: string; count: number }[] = [];
  let totalRows = 0;
  for (const def of BACKUP_TABLES) {
    const count = await delegate(def.key).count();
    tables.push({ key: def.key, table: def.table, count });
    totalRows += count;
  }
  const snap = tables.find((t) => t.table === "follow_snapshots");
  const notes: string[] = [];
  if (snap && snap.count > 50) {
    notes.push(
      `follow_snapshots has ${snap.count} rows (each can store thousands of user ids). ` +
        `Export defaults to latest snapshot per watch account only — use ?full=1 for every historical snapshot (can OOM).`,
    );
  }
  return { tables, totalRows, notes };
}

export type ExportDatabaseOpts = {
  /**
   * When false (default), only the **latest** follow_snapshot per watch list
   * is exported. Full history is huge (userIds[] per poll) and previously
   * crashed the API / killed the Node process.
   */
  fullSnapshots?: boolean;
};

const PAGE = 500;

/** Cursor field for paging; null → load whole table (small / composite PK). */
const PAGE_CURSOR: Partial<Record<BackupTableKey, string>> = {
  adminUser: "id",
  telegramBot: "id",
  twitterAuthAccount: "id",
  twitterAccount: "id",
  seedAccount: "id",
  trackingRun: "id",
  projectList: "id",
  searchQuery: "id",
  listMonitor: "id",
  grokConversation: "id",
  grokResearchPrompt: "id",
  postAlert: "tweetId",
  // followEdge: composite PK — no cursor
  alert: "id",
  searchHit: "id",
  grokMessage: "id",
  grokResearchRun: "id",
  telegramGroup: "id",
  telegramTopic: "id",
};

/**
 * Load a table in ordered pages so we never materialize a multi‑GB Prisma
 * result set in one round-trip.
 */
async function loadTablePaged(
  def: BackupTableDef,
): Promise<Record<string, unknown>[]> {
  const model = prisma as unknown as Record<
    string,
    {
      findMany: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
    }
  >;
  const d = model[def.key];
  if (!d?.findMany) {
    throw new Error(`backup: missing prisma model ${def.key}`);
  }

  const cursorField = PAGE_CURSOR[def.key];
  // Small / composite-key tables: one shot is fine.
  if (!cursorField) {
    const all = await d.findMany({});
    return all.map((r) => serializeRow(r));
  }

  const out: Record<string, unknown>[] = [];
  let cursorVal: string | number | bigint | null = null;

  for (;;) {
    const args: Record<string, unknown> = {
      take: PAGE,
      orderBy: { [cursorField]: "asc" },
    };
    if (cursorVal != null) {
      args.skip = 1;
      args.cursor = { [cursorField]: cursorVal };
    }

    let batch: Record<string, unknown>[];
    try {
      batch = await d.findMany(args);
    } catch (err) {
      // Fallback: no usable cursor (e.g. follow_edge uses composite unique).
      if (cursorVal == null) {
        console.warn(
          `[backup:export] paged ${def.table} failed, loading all:`,
          err instanceof Error ? err.message : err,
        );
        const all = await d.findMany({});
        return all.map((r) => serializeRow(r));
      }
      throw err;
    }

    if (batch.length === 0) break;
    for (const row of batch) out.push(serializeRow(row));

    const last = batch[batch.length - 1]!;
    const next = last[cursorField];
    if (next == null) break;
    cursorVal = next as string | number | bigint;
    if (batch.length < PAGE) break;
  }

  return out;
}

export async function exportDatabase(
  opts: ExportDatabaseOpts = {},
): Promise<DbBackupFile & { compact: boolean; warnings: string[] }> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  void opts;

  for (const def of BACKUP_TABLES) {
    const t0 = Date.now();
    const rows = await loadTablePaged(def);

    tables[def.table] = rows;
    counts[def.table] = rows.length;
    console.log(
      `[backup:export] ${def.table} rows=${rows.length} ms=${Date.now() - t0}`,
    );
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: "early-alpha",
    tables,
    counts,
    compact: true,
    warnings,
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

/** backupId (string) → live DB id */
type IdMap = Map<string, bigint>;

function asBigInt(v: unknown): bigint | null {
  if (v == null || v === "") return null;
  if (typeof v === "bigint") return v;
  try {
    return BigInt(String(v));
  } catch {
    return null;
  }
}

async function buildAuthAccountIdMap(
  backupRows: Record<string, unknown>[],
): Promise<IdMap> {
  const map: IdMap = new Map();
  if (backupRows.length === 0) return map;

  const live = await prisma.twitterAuthAccount.findMany({
    select: { id: true, username: true },
  });
  const byUsername = new Map(
    live.map((a) => [a.username.toLowerCase(), a.id] as const),
  );

  for (const row of backupRows) {
    const backupId = asBigInt(row.id);
    if (backupId == null) continue;
    const username =
      typeof row.username === "string" ? row.username.toLowerCase() : "";
    const liveId = username ? byUsername.get(username) : null;
    if (liveId != null) map.set(String(backupId), liveId);
  }
  return map;
}

async function buildSearchQueryIdMap(
  backupRows: Record<string, unknown>[],
): Promise<IdMap> {
  const map: IdMap = new Map();
  if (backupRows.length === 0) return map;

  // Match by (query, label) — best-effort; not unique but good enough for restore.
  const live = await prisma.searchQuery.findMany({
    select: { id: true, query: true, label: true },
  });
  const keyOf = (q: string, label: string | null) =>
    `${q}\0${label ?? ""}`;
  const byKey = new Map(
    live.map((r) => [keyOf(r.query, r.label), r.id] as const),
  );

  for (const row of backupRows) {
    const backupId = asBigInt(row.id);
    if (backupId == null) continue;
    const q = typeof row.query === "string" ? row.query : "";
    const label =
      row.label == null || row.label === ""
        ? null
        : String(row.label);
    const liveId = byKey.get(keyOf(q, label));
    if (liveId != null) map.set(String(backupId), liveId);
  }
  return map;
}

/**
 * Prepare a row for insert: revive types, remap FKs, and in merge mode drop
 * autoincrement PKs so we don't collide with existing serial ids.
 */
function prepareImportRow(
  def: BackupTableDef,
  raw: Record<string, unknown>,
  mode: BackupMode,
  maps: {
    authAccount: IdMap;
    searchQuery: IdMap;
  },
): { row: Record<string, unknown> | null; skipReason?: string } {
  const row = reviveRow(def, raw);

  // ── FK remaps ────────────────────────────────────────────────────────
  if (
    def.key === "projectList" ||
    def.key === "searchQuery" ||
    def.key === "listMonitor"
  ) {
    const old = asBigInt(row.authAccountId);
    if (old != null) {
      const mapped = maps.authAccount.get(String(old));
      if (mapped != null) row.authAccountId = mapped;
      else if (mode === "merge") row.authAccountId = null; // optional FK
    }
  }

  if (def.key === "searchHit") {
    const old = asBigInt(row.queryId);
    if (old == null) return { row: null, skipReason: "missing queryId" };
    const mapped = maps.searchQuery.get(String(old));
    if (mapped != null) row.queryId = mapped;
    else if (mode === "merge") {
      return {
        row: null,
        skipReason: `no search_query for backup id ${old}`,
      };
    }
  }

  // Merge: let Postgres assign new serial ids (avoids PK + FK id drift).
  if (mode === "merge" && def.bigints.includes("id") && "id" in row) {
    delete row.id;
  }

  return { row };
}

export async function importDatabase(
  backup: DbBackupFile,
  mode: BackupMode,
): Promise<{
  mode: BackupMode;
  imported: Record<string, number>;
  wiped: Record<string, number>;
  skipped: Record<string, number>;
  errors: string[];
}> {
  const imported: Record<string, number> = {};
  const wiped: Record<string, number> = {};
  const skipped: Record<string, number> = {};
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

  const maps = {
    authAccount: new Map<string, bigint>() as IdMap,
    searchQuery: new Map<string, bigint>() as IdMap,
  };

  for (const def of BACKUP_TABLES) {
    const rows = backup.tables[def.table];
    if (!Array.isArray(rows) || rows.length === 0) {
      imported[def.table] = 0;
      continue;
    }

    let ok = 0;
    let skip = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH) as Record<string, unknown>[];
      const prepared: Record<string, unknown>[] = [];

      for (const raw of slice) {
        const { row, skipReason } = prepareImportRow(def, raw, mode, maps);
        if (!row) {
          skip++;
          if (skipReason && errors.length < 40) {
            errors.push(`${def.table}: skipped — ${skipReason}`);
          }
          continue;
        }
        prepared.push(row);
      }

      if (prepared.length === 0) continue;

      try {
        const r = await delegate(def.key).createMany({
          data: prepared,
          skipDuplicates: mode === "merge",
        });
        ok += r.count;
      } catch {
        // Fallback: one-by-one so one bad row doesn't kill the batch
        for (const row of prepared) {
          try {
            const r = await delegate(def.key).createMany({
              data: [row],
              skipDuplicates: true,
            });
            ok += r.count;
          } catch (e2) {
            skip++;
            if (errors.length < 50) {
              const msg = e2 instanceof Error ? e2.message : String(e2);
              // Collapse noisy FK noise into one line pattern
              const short = msg.includes("Foreign key constraint")
                ? "foreign key constraint violated"
                : msg.slice(0, 180);
              errors.push(`${def.table}: ${short}`);
            }
          }
        }
        if (errors.length >= 50) {
          errors.push("…truncated further errors");
        }
      }
    }

    imported[def.table] = ok;
    if (skip > 0) skipped[def.table] = skip;

    // Refresh id maps after parent tables land
    if (def.key === "twitterAuthAccount") {
      maps.authAccount = await buildAuthAccountIdMap(
        rows as Record<string, unknown>[],
      );
    }
    if (def.key === "searchQuery") {
      maps.searchQuery = await buildSearchQueryIdMap(
        rows as Record<string, unknown>[],
      );
    }
  }

  return { mode, imported, wiped, skipped, errors };
}
