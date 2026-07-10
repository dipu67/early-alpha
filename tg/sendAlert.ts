import "dotenv/config";
import { Bot, GrammyError } from "grammy";
import type { UserData } from "../TwitterClient/types.js";


const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN as string);
const ALERT_CHAT_ID = process.env.ALERT_CHAT_ID as string;
const TOPIC_ID = process.env.TOPIC_ID as string;

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
): Promise<void> {
  const options = TOPIC_ID
    ? { parse_mode: parseMode, message_thread_id: parseInt(TOPIC_ID) }
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
