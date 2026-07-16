// Config helpers over the shared `settings` table (mirror of the worker's
// services/appConfig.ts, backend side). JSON-encoded values; the worker reads
// the same keys with a ~5s cache, so admin edits here apply live.

import { prisma } from "./prisma.js";

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    const v = JSON.parse(row.value);
    return v === undefined ? fallback : (v as T);
  } catch {
    return row.value as unknown as T;
  }
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  const encoded = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: encoded },
    update: { value: encoded },
  });
}

export type AlertType =
  | "newFollow"
  | "signal"
  | "reclassify"
  | "earlyDigest"
  | "convergence"
  | "search"
  | "monitor"
  | "listMonitor"
  | "chainlist";

export const CONFIG_KEYS = {
  tgAlertChatId: "tg.alertChatId",
  tgDefaultTopicId: "tg.defaultTopicId",
  tgSignalTopicId: "tg.signalTopicId",
  tgSignalTopicMap: "tg.signalTopicMap",
  tgEarlyProjectTopicId: "tg.earlyProjectTopicId",
  tgEarlyTopicMap: "tg.earlyTopicMap",
  tgMinIntervalMs: "tg.minIntervalMs",
  tgMaxRetries: "tg.maxRetries",
  tgAdminIds: "tg.adminIds",
  tgGrokBotId: "tg.grokBotId",
} as const;

export const ALERT_TYPES: AlertType[] = [
  "newFollow",
  "signal",
  "reclassify",
  "earlyDigest",
  "convergence",
  "search",
  "monitor",
  "listMonitor",
  "chainlist",
];

export const alertEnabledKey = (t: AlertType) => `alert.enabled.${t}`;
export const alertBotKey = (t: AlertType) => `alert.bot.${t}`;
export const schedEveryKey = (k: string) => `sched.${k}.every`;
export const schedCronKey = (k: string) => `sched.${k}.cron`;
export const schedPausedKey = (k: string) => `sched.${k}.paused`;
