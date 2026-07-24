import "dotenv/config";
import { Bot, GrammyError } from "grammy";
import type { UserData } from "../TwitterClient/types.js";
import { prisma } from "../db/prisma.js";
import {
  getConfig,
  CONFIG_KEYS,
  alertEnabledKey,
  alertBotKey,
  alertTopicKey,
  type AlertType,
} from "../services/appConfig.js";

// Bot registry: one grammy Bot per token, cached. Tokens come from telegram_bots.
const botRegistry = new Map<string, Bot>();

function botForToken(token: string): Bot {
  let b = botRegistry.get(token);
  if (!b) {
    b = new Bot(token);
    botRegistry.set(token, b);
  }
  return b;
}

/**
 * Pick the bot for an alert type: assigned TelegramBot → default TelegramBot.
 * All config is DB-backed (settings + telegram_bots).
 */
async function resolveBot(type?: AlertType): Promise<Bot> {
  if (type) {
    const assignedId = await getConfig<string | null>(alertBotKey(type), null);
    if (assignedId) {
      try {
        const row = await prisma.telegramBot.findFirst({
          where: { id: BigInt(assignedId), isActive: true },
        });
        if (row) return botForToken(row.token);
      } catch {
        /* invalid id */
      }
    }
  }
  const def = await prisma.telegramBot.findFirst({
    where: { isDefault: true, isActive: true },
  });
  if (def) return botForToken(def.token);
  const any = await prisma.telegramBot.findFirst({
    where: { isActive: true },
    orderBy: { id: "asc" },
  });
  if (any) return botForToken(any.token);
  throw new Error("No active TelegramBot in database");
}

function parseTopicMap(raw: unknown): Record<string, number> {
  if (!raw) return {};
  const obj = typeof raw === "string" ? safeJson(raw) : raw;
  if (!obj || typeof obj !== "object") return {};
  const out: Record<string, number> = {};
  for (const [slug, v] of Object.entries(obj as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[slug] = n;
  }
  return out;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function toInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""));
  return Number.isNaN(n) ? undefined : n;
}

// ── Config-backed resolvers (all async now, DB-driven with env fallback) ──

async function alertChatId(): Promise<string> {
  const id = await getConfig<string | null>(CONFIG_KEYS.tgAlertChatId, null);
  if (!id?.trim()) throw new Error("tg.alertChatId not set — configure in admin Telegram");
  return id.trim();
}

async function defaultTopicId(): Promise<number | undefined> {
  const v = await getConfig<unknown>(CONFIG_KEYS.tgDefaultTopicId, null);
  return toInt(v);
}

/** Per-alert-type topic override (admin-set). Falls back to default topic. */
async function topicForAlertType(type?: AlertType): Promise<number | undefined> {
  if (type) {
    const v = await getConfig<number | null>(alertTopicKey(type), null);
    const n = toInt(v);
    if (n !== undefined) return n;
  }
  return defaultTopicId();
}

/** Topic for an update *signal* of a tag slug: map → shared signal topic → default. */
export async function topicForSlug(slug: string): Promise<number | undefined> {
  const map = parseTopicMap(await getConfig(CONFIG_KEYS.tgSignalTopicMap, null));
  if (slug in map) return map[slug];
  const shared = toInt(await getConfig(CONFIG_KEYS.tgSignalTopicId, null));
  if (shared !== undefined) return shared;
  return defaultTopicId();
}

/** Per-tag topic for the early-project digest (map only). */
export async function earlyTopicForSlug(slug: string): Promise<number | undefined> {
  const map = parseTopicMap(await getConfig(CONFIG_KEYS.tgEarlyTopicMap, null));
  return slug in map ? map[slug] : undefined;
}

/** General early-project topic for tags with no map entry. */
export async function earlyProjectTopic(): Promise<number | undefined> {
  const v = await getConfig<unknown>(CONFIG_KEYS.tgEarlyProjectTopicId, null);
  return toInt(v) ?? (await defaultTopicId());
}

/** Whether a given alert type is enabled (default: enabled). */
export async function isAlertEnabled(type: AlertType): Promise<boolean> {
  return getConfig<boolean>(alertEnabledKey(type), true);
}

// ── Throttle (config-backed) ──

async function throttle(): Promise<{ intervalMs: number; maxRetries: number }> {
  const intervalMs = toInt(await getConfig(CONFIG_KEYS.tgMinIntervalMs, null)) ?? 3500;
  const maxRetries = toInt(await getConfig(CONFIG_KEYS.tgMaxRetries, null)) ?? 5;
  return { intervalMs, maxRetries };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Single-lane queue: each scheduled send waits for the previous one, then for the
// throttle gap, so concurrent callers are spaced out instead of hammering the API.
let chain: Promise<unknown> = Promise.resolve();
let lastSentAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const { intervalMs } = await throttle();
    const wait = intervalMs - (Date.now() - lastSentAt);
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      lastSentAt = Date.now();
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Send one message to `chatId` via `bot`, honoring Telegram's 429 retry_after. */
async function sendMessageWithRetry(
  bot: Bot,
  chatId: string,
  text: string,
  options: Record<string, unknown>,
): Promise<void> {
  const { maxRetries } = await throttle();
  for (let attempt = 0; ; attempt++) {
    try {
      await bot.api.sendMessage(chatId, text, options);
      return;
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 429 && attempt < maxRetries) {
        const retryAfter = err.parameters?.retry_after ?? 1;
        console.warn(
          `[tg] 429 rate limited, retrying in ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})`,
        );
        await sleep(retryAfter * 1000 + 500);
        continue;
      }
      // "chat not found" / "bot was kicked" almost always means the selected bot
      // is not a member of this chat — a config problem, not a transient error.
      // Surface which bot + chat so it's diagnosable instead of a bare 400.
      if (err instanceof GrammyError && err.error_code === 400) {
        const botId = bot.token.split(":")[0];
        console.error(
          `[tg] send failed to chat ${chatId}${
            options.message_thread_id ? ` (topic ${options.message_thread_id})` : ""
          } via bot ${botId}: ${err.description}. ` +
            `Make sure bot ${botId} is a member/admin of that chat.`,
        );
      }
      throw err;
    }
  }
}

/**
 * Forum "General" topic is special: Telegram rejects `message_thread_id: 1`
 * with "message thread not found". To post in General, omit the thread id.
 * Custom topics use their real message_thread_id (≠ 1).
 */
export function normalizeForumThreadId(
  thread: number | null | undefined,
): number | undefined {
  if (thread == null) return undefined;
  const n = Number(thread);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n === 1) return undefined; // General
  return n;
}

function threadOptions(
  parseMode: "MarkdownV2" | "HTML",
  thread: number | undefined,
): Record<string, unknown> {
  const tid = normalizeForumThreadId(thread);
  return tid !== undefined
    ? { parse_mode: parseMode, message_thread_id: tid }
    : { parse_mode: parseMode };
}

export async function sendTelegramAlert(
  msg: { text: string; user: UserData },
  parseMode: "MarkdownV2" | "HTML" = "MarkdownV2",
  threadId?: number,
  alertType?: AlertType,
): Promise<void> {
  const chatId = await alertChatId();
  // Explicit thread wins; else per-alert topic; else global default.
  const thread = threadId ?? (await topicForAlertType(alertType));
  const bot = await resolveBot(alertType);
  await schedule(() =>
    sendMessageWithRetry(bot, chatId, msg.text, {
      ...threadOptions(parseMode, thread),
      reply_markup: {
        inline_keyboard: [
          [{ text: msg.user?.name || "View Profile", url: `https://x.com/${msg.user?.username}` }],
        ],
      },
    }),
  );
}

export async function sendTelegramPlaintext(text: string, parseMode: "MarkdownV2" | "HTML" = "MarkdownV2"): Promise<void> {
  const chatId = await alertChatId();
  const bot = await resolveBot();
  await schedule(() => sendMessageWithRetry(bot, chatId, text, {parse_mode: parseMode}));
}

/** Send a message to a specific topic (thread). Used by the early-project digest. */
export async function sendTelegramTopic(
  text: string,
  threadId?: number,
  parseMode: "MarkdownV2" | "HTML" = "MarkdownV2",
  alertType?: AlertType,
): Promise<void> {
  const chatId = await alertChatId();
  const thread = threadId ?? (await topicForAlertType(alertType));
  const bot = await resolveBot(alertType);
  await schedule(() => sendMessageWithRetry(bot, chatId, text, threadOptions(parseMode, thread)));
}

/**
 * Send a test message to verify Telegram config. Uses given overrides or the
 * configured chat/topic, sent from the default bot. Throws on hard failure.
 */
export async function sendTestAlert(chatId?: string, topicId?: number): Promise<void> {
  const target = chatId || (await alertChatId());
  const thread = topicId ?? (await defaultTopicId());
  const bot = await resolveBot();
  await schedule(() =>
    sendMessageWithRetry(
      bot,
      target,
      "✅ *Test alert* from early\\-alpha admin\\.",
      threadOptions("MarkdownV2", thread),
    ),
  );
}

/** Telegram soft limit for a single message body (~4k). Leave headroom for header. */
const RICH_CHUNK = 3500;

/**
 * Send a long research/markdown payload as Telegram **RichMessage**(s)
 * via grammy `api.sendRichMessage`, optionally into a forum topic.
 *
 * Falls back to plain `sendMessage` if rich messages are unavailable.
 */
export async function sendTelegramRichMarkdown(opts: {
  markdown: string;
  topicId?: number | null;
  chatId?: string | null;
  /** Optional alert-type bot routing (uses default bot if omitted). */
  alertType?: AlertType;
}): Promise<{ parts: number; chatId: string; topicId: number | undefined }> {
  const chatId = (opts.chatId && opts.chatId.trim()) || (await alertChatId());
  const thread =
    opts.topicId != null && Number.isFinite(Number(opts.topicId))
      ? Number(opts.topicId)
      : await defaultTopicId();
  const bot = await resolveBot(opts.alertType);
  const chunks = chunkMarkdown(opts.markdown, RICH_CHUNK);

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks[i]!;
    const suffix =
      chunks.length > 1 ? `\n\n_(part ${i + 1}/${chunks.length})_` : "";
    const markdown = part + suffix;
    await schedule(() =>
      sendRichWithRetry(bot, chatId, markdown, thread),
    );
  }

  return { parts: chunks.length, chatId, topicId: thread };
}

async function sendRichWithRetry(
  bot: Bot,
  chatId: string,
  markdown: string,
  thread: number | undefined,
): Promise<void> {
  const { maxRetries } = await throttle();
  const tid = normalizeForumThreadId(thread);
  const other: Record<string, unknown> = {};
  if (tid !== undefined) other.message_thread_id = tid;

  for (let attempt = 0; ; attempt++) {
    try {
      // Prefer Bot API rich messages (grammy sendRichMessage).
      await bot.api.sendRichMessage(chatId, { markdown }, other);
      return;
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 429 && attempt < maxRetries) {
        const retryAfter = err.parameters?.retry_after ?? 1;
        console.warn(
          `[tg] rich 429, retry in ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})`,
        );
        await sleep(retryAfter * 1000 + 500);
        continue;
      }
      // Fallback: plain text message (no parse mode — research text often breaks MDV2).
      if (
        err instanceof GrammyError &&
        (err.error_code === 400 || err.error_code === 404 || err.error_code === 501)
      ) {
        console.warn(
          `[tg] sendRichMessage failed (${err.description}); falling back to sendMessage`,
        );
        await sendMessageWithRetry(bot, chatId, markdown.slice(0, 4096), {
          ...(tid !== undefined ? { message_thread_id: tid } : {}),
        });
        return;
      }
      throw err;
    }
  }
}

/** Split markdown near newlines so we don't cut mid-table when possible. */
function chunkMarkdown(text: string, maxLen: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return ["_(empty)_"];
  if (trimmed.length <= maxLen) return [trimmed];

  const parts: string[] = [];
  let rest = trimmed;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n\n", maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.4) cut = maxLen;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}
