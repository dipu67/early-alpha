// appConfig — typed runtime configuration backed by the `settings` table, with a
// short in-process cache so the worker picks up admin changes (made via the
// backend API) within a few seconds and without a restart.
//
// Values are JSON-encoded strings. Every getter takes a fallback (usually the
// env value or a hard default) used when the key is unset or unparseable.

import { prisma } from "../db/prisma.js";

const TTL_MS = 5000;

interface Cached {
  value: unknown;
  at: number;
}
const cache = new Map<string, Cached>();

/** Config keys used across the system (documented in one place). */
export const CONFIG_KEYS = {
  tgAlertChatId: "tg.alertChatId",
  tgDefaultTopicId: "tg.defaultTopicId",
  tgSignalTopicId: "tg.signalTopicId",
  tgSignalTopicMap: "tg.signalTopicMap",
  tgEarlyProjectTopicId: "tg.earlyProjectTopicId",
  tgEarlyTopicMap: "tg.earlyTopicMap",
  tgMinIntervalMs: "tg.minIntervalMs",
  tgMaxRetries: "tg.maxRetries",
  /** JSON array or comma-separated Telegram user ids for bot admin commands */
  tgAdminIds: "tg.adminIds",
  /** TelegramBot.id (string) for the Grok bot process */
  tgGrokBotId: "tg.grokBotId",
} as const;

/** Alert types that can be individually enabled/disabled. */
export type AlertType =
  | "newFollow"
  | "signal"
  | "reclassify"
  | "earlyDigest"
  | "convergence"
  | "search"
  | "monitor"
  | "listMonitor";

/** All alert types, for iteration (API config listing, routing, etc.). */
export const ALERT_TYPES: AlertType[] = [
  "newFollow",
  "signal",
  "reclassify",
  "earlyDigest",
  "convergence",
  "search",
  "monitor",
  "listMonitor",
];

export function alertEnabledKey(type: AlertType): string {
  return `alert.enabled.${type}`;
}

/** Setting key holding the TelegramBot id assigned to send this alert type. */
export function alertBotKey(type: AlertType): string {
  return `alert.bot.${type}`;
}

/** Setting key holding the forum topic id for this alert type (null = use default). */
export function alertTopicKey(type: AlertType): string {
  return `alert.topic.${type}`;
}

export function schedEveryKey(jobKey: string): string {
  return `sched.${jobKey}.every`;
}
export function schedCronKey(jobKey: string): string {
  return `sched.${jobKey}.cron`;
}
export function schedPausedKey(jobKey: string): string {
  return `sched.${jobKey}.paused`;
}

/**
 * Read a config value (JSON-decoded), or `fallback` if unset/invalid. Cached for
 * TTL_MS. Never throws — DB errors fall back too.
 */
export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.value === undefined ? fallback : (hit.value as T);
  }
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    let value: unknown = undefined;
    if (row) {
      try {
        value = JSON.parse(row.value);
      } catch {
        value = row.value; // tolerate plain strings
      }
    }
    cache.set(key, { value, at: Date.now() });
    return value === undefined ? fallback : (value as T);
  } catch {
    return fallback;
  }
}

/** Write a config value (JSON-encoded) and refresh the cache. */
export async function setConfig(key: string, value: unknown): Promise<void> {
  const encoded = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: encoded },
    update: { value: encoded },
  });
  cache.set(key, { value, at: Date.now() });
}

/** Drop the cache (used right after a known write from another path). */
export function invalidateConfigCache(): void {
  cache.clear();
}
