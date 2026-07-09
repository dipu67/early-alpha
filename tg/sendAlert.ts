import "dotenv/config";
import { Bot } from "grammy";
import type { UserData } from "../TwitterClient/types.js";


const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN as string);
const ALERT_CHAT_ID = process.env.ALERT_CHAT_ID as string;
const TOPIC_ID = process.env.TOPIC_ID as string;
export async function sendTelegramAlert(
  msg: {text: string, user: UserData },
  parseMode: "MarkdownV2" | "HTML" = "MarkdownV2",
): Promise<void> {
  const options = TOPIC_ID
    ? { parse_mode: parseMode, message_thread_id: parseInt(TOPIC_ID) }
    : { parse_mode: parseMode };

  await bot.api.sendMessage(ALERT_CHAT_ID, msg.text, { ...options ,reply_markup: { inline_keyboard: [[{ text: msg.user?.name || "View Profile", url: `https://x.com/${msg.user?.username}` }]] }});
}

export async function sendTelegramPlaintext(text: string): Promise<void> {
  await bot.api.sendMessage(ALERT_CHAT_ID, text);
}
