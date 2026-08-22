import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma } from "../generated/prisma/client.js";

const adapter = new PrismaPg(process.env.DATABASE_URL as string);

export const prisma = new PrismaClient({ adapter });
export const { sql } = Prisma;

/**
 * After restore/import with explicit serial ids, Postgres sequences often lag
 * behind MAX(id) → next create hits Unique constraint on `id`.
 * Resync so nextval() > MAX(id).
 *
 * `table` must be a trusted identifier (our schema maps only).
 */
export async function resyncSerialSequence(
  table: string,
  idColumn = "id",
): Promise<void> {
  // Identifier-only (no user input)
  if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(idColumn)) {
    throw new Error(`resyncSerialSequence: invalid identifier ${table}.${idColumn}`);
  }
  await prisma.$executeRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('${table}', '${idColumn}'),
      COALESCE((SELECT MAX("${idColumn}") FROM "${table}"), 1),
      (SELECT EXISTS (SELECT 1 FROM "${table}"))
    )
  `);
}

/** Resync BIGSERIAL/SERIAL id sequences for known autoincrement tables. */
export async function resyncAllSerialSequences(): Promise<void> {
  const tables = [
    "tracking_runs",
    "seed_accounts",
    "admin_users",
    "telegram_bots",
    "twitter_auth_accounts",
    "project_lists",
    "search_queries",
    "list_monitors",
    "alerts",
    "search_hits",
    "account_metric_snapshots",
    "auth_follows",
    "signal_scans",
    "signal_rules",
    "project_monitors",
    "project_monitor_tag_rules",
    "github_repo_monitors",
    "github_repo_commits",
    "grok_conversations",
    "grok_messages",
    "grok_research_prompts",
    "grok_research_runs",
    "telegram_groups",
    "telegram_topics",
  ];
  for (const t of tables) {
    try {
      await resyncSerialSequence(t);
    } catch {
      // Table or sequence may not exist yet — ignore
    }
  }
}
