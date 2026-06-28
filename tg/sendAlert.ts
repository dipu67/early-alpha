import "dotenv/config";
import { Bot } from "grammy";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN as string);
const ALERT_CHAT_ID = process.env.ALERT_CHAT_ID as string;

export async function sendTelegramAlert(
  text: string,
  parseMode: "MarkdownV2" | "HTML" = "MarkdownV2",
): Promise<void> {
  await bot.api.sendMessage(ALERT_CHAT_ID, text, { parse_mode: parseMode });
}

export async function sendTelegramPlaintext(text: string): Promise<void> {
  await bot.api.sendMessage(ALERT_CHAT_ID, text);
}
