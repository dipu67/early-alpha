// Resolve Telegram bot tokens and admin ids from the database only
// (telegram_bots + settings). No TELEGRAM_BOT_TOKEN / GROK_BOT_TOKEN / ADMIN_IDS env.

import { prisma } from "../db/prisma.js";
import { CONFIG_KEYS, getConfig } from "../services/appConfig.js";

/** Default active TelegramBot token (isDefault, else first active). */
export async function resolveDefaultBotToken(): Promise<string> {
  const def = await prisma.telegramBot.findFirst({
    where: { isDefault: true, isActive: true },
  });
  if (def?.token) return def.token;

  const any = await prisma.telegramBot.findFirst({
    where: { isActive: true },
    orderBy: { id: "asc" },
  });
  if (any?.token) return any.token;

  throw new Error(
    "No active TelegramBot in database — add a bot in admin → Telegram",
  );
}

/**
 * Grok bot token: settings tg.grokBotId → bot name/username contains "grok"
 * → non-default active bot → error (do not fall back to default; would fight getUpdates).
 */
export async function resolveGrokBotToken(): Promise<string> {
  const configuredId = await getConfig<string | null>(CONFIG_KEYS.tgGrokBotId, null);
  if (configuredId) {
    try {
      const row = await prisma.telegramBot.findFirst({
        where: { id: BigInt(configuredId), isActive: true },
      });
      if (row?.token) return row.token;
    } catch {
      /* invalid id */
    }
  }

  const byName = await prisma.telegramBot.findFirst({
    where: {
      isActive: true,
      OR: [
        { name: { contains: "grok", mode: "insensitive" } },
        { username: { contains: "grok", mode: "insensitive" } },
      ],
    },
  });
  if (byName?.token) return byName.token;

  const other = await prisma.telegramBot.findFirst({
    where: { isActive: true, isDefault: false },
    orderBy: { id: "asc" },
  });
  if (other?.token) return other.token;

  throw new Error(
    "No Grok TelegramBot in database — add a bot named Grok (or set tg.grokBotId in settings)",
  );
}

/** Admin Telegram user ids from settings `tg.adminIds` (JSON array or comma string). */
export async function getAdminIdSet(): Promise<Set<string>> {
  const raw = await getConfig<unknown>(CONFIG_KEYS.tgAdminIds, null);
  const ids = new Set<string>();
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const s = String(x).trim();
      if (s) ids.add(s);
    }
  } else if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(/[,\s]+/)) {
      if (part.trim()) ids.add(part.trim());
    }
  }
  return ids;
}

export async function isTelegramAdmin(userId: number | undefined): Promise<boolean> {
  if (userId == null) return false;
  const set = await getAdminIdSet();
  if (set.size === 0) return false;
  return set.has(String(userId));
}
