import "dotenv/config";
import { Bot, GrammyError } from "grammy";
import type { UserData } from "../TwitterClient/types.js";


const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN as string);
const ALERT_CHAT_ID = process.env.ALERT_CHAT_ID as string;
const TOPIC_ID = process.env.TOPIC_ID as string;

// Two independent slug -> topic maps, one per event kind:
//   • SIGNAL_TOPIC_MAP — project *update* signals (mint/launch/TGE posts)
//   • EARLY_TOPIC_MAP   — newly *founded* projects (the 12h early digest)
// Both are JSON of slug -> thread id, e.g. {"nft":123,"gamefi":456}.
function parseTopicMap(raw: string | undefined, label: string): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, number | string>;
    const out: Record<string, number> = {};
    for (const [slug, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[slug] = n;
    }
    return out;
  } catch {
    console.warn(`[tg] ${label} is not valid JSON; ignoring`);
    return {};
  }
}

// ── Signal alerts (project updates) ──
// Resolution per slug: SIGNAL_TOPIC_MAP → SIGNAL_TOPIC_ID (shared) → TOPIC_ID.
const SIGNAL_TOPIC_ID = process.env.SIGNAL_TOPIC_ID;
const SIGNAL_TOPIC_MAP = parseTopicMap(process.env.SIGNAL_TOPIC_MAP, "SIGNAL_TOPIC_MAP");

/**
 * Resolve the Telegram topic (thread) id for an update *signal* of a tag slug.
 * Returns undefined when nothing is configured, so the caller falls back to the
 * default TOPIC_ID.
 */
export function topicForSlug(slug: string): number | undefined {
  if (slug in SIGNAL_TOPIC_MAP) return SIGNAL_TOPIC_MAP[slug];
  if (SIGNAL_TOPIC_ID) {
    const n = parseInt(SIGNAL_TOPIC_ID);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

// ── Early-project digest (newly founded projects) ──
// Its own map, independent of signal topics. A slug with no entry rolls into the
// general early-project topic below.
const EARLY_TOPIC_MAP = parseTopicMap(process.env.EARLY_TOPIC_MAP, "EARLY_TOPIC_MAP");
const EARLY_PROJECT_TOPIC_ID = process.env.EARLY_PROJECT_TOPIC_ID;

/** Per-tag topic for the early-project digest (EARLY_TOPIC_MAP only). */
export function earlyTopicForSlug(slug: string): number | undefined {
  return slug in EARLY_TOPIC_MAP ? EARLY_TOPIC_MAP[slug] : undefined;
}

/** General early-project topic for tags with no EARLY_TOPIC_MAP entry. */
export function earlyProjectTopic(): number | undefined {
  const raw = EARLY_PROJECT_TOPIC_ID ?? TOPIC_ID;
  if (!raw) return undefined;
  const n = parseInt(raw);
  return Number.isNaN(n) ? undefined : n;
}

// Telegram rate limits: ~30 msg/s globally, but only ~20 msg/min to a single
// group/channel. A burst of new-follow alerts easily trips this and Telegram
// replies 429 { retry_after }. We defend on two fronts:
//   1. Serialize all sends through one promise chain and keep a minimum gap
//      between them, so we never fan out faster than the group limit.
//   2. On a 429, wait the server-provided retry_after and try again.
const MIN_SEND_INTERVAL_MS = Number(process.env.ALERT_MIN_INTERVAL_MS ?? 3500);
const MAX_RETRIES = Number(process.env.ALERT_MAX_RETRIES ?? 5);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Single-lane queue: each scheduled send waits for the previous one, then for
// the throttle gap, so concurrent callers (the worker's per-follow loop) are
// naturally spaced out instead of hammering the API in parallel.
let chain: Promise<unknown> = Promise.resolve();
let lastSentAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = MIN_SEND_INTERVAL_MS - (Date.now() - lastSentAt);
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      lastSentAt = Date.now();
    }
  });
  // Keep the lane open even if this task rejects, so one failure doesn't wedge
  // every subsequent send.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Send one message, honoring Telegram's 429 retry_after up to MAX_RETRIES. */
async function sendMessageWithRetry(
  text: string,
  options: Record<string, unknown>,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await bot.api.sendMessage(ALERT_CHAT_ID, text, options);
      return;
    } catch (err) {
      if (
        err instanceof GrammyError &&
        err.error_code === 429 &&
        attempt < MAX_RETRIES
      ) {
        const retryAfter = err.parameters?.retry_after ?? 1;
        console.warn(
          `[tg] 429 rate limited, retrying in ${retryAfter}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        await sleep(retryAfter * 1000 + 500);
        continue;
      }
      throw err;
    }
  }
}

export async function sendTelegramAlert(
  msg: {text: string, user: UserData },
  parseMode: "MarkdownV2" | "HTML" = "MarkdownV2",
  threadId?: number,
): Promise<void> {
  // threadId (if given) overrides the default TOPIC_ID — used to route signal
  // alerts to per-type topics.
  const thread = threadId ?? (TOPIC_ID ? parseInt(TOPIC_ID) : undefined);
  const options =
    thread !== undefined && !Number.isNaN(thread)
      ? { parse_mode: parseMode, message_thread_id: thread }
      : { parse_mode: parseMode };

  await schedule(() =>
    sendMessageWithRetry(msg.text, {
      ...options,
      reply_markup: {
        inline_keyboard: [
          [{ text: msg.user?.name || "View Profile", url: `https://x.com/${msg.user?.username}` }],
        ],
      },
    }),
  );
}

export async function sendTelegramPlaintext(text: string): Promise<void> {
  await schedule(() => sendMessageWithRetry(text, {}));
}

/**
 * Send a message to a specific topic (thread). Used by the early-project digest.
 * No inline button; throttled and 429-safe like every other send.
 */
export async function sendTelegramTopic(
  text: string,
  threadId?: number,
  parseMode: "MarkdownV2" | "HTML" = "MarkdownV2",
): Promise<void> {
  const thread = threadId ?? (TOPIC_ID ? parseInt(TOPIC_ID) : undefined);
  const options =
    thread !== undefined && !Number.isNaN(thread)
      ? { parse_mode: parseMode, message_thread_id: thread }
      : { parse_mode: parseMode };
  await schedule(() => sendMessageWithRetry(text, options));
}
