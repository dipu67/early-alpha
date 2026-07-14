import { Bot, type Context } from "grammy";
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { prisma } from "../db/prisma.js";
import { getTwitterClient } from "../twitter/getClient.js";
import type { TwitterClient } from "../TwitterClient/TwitterClient.js";
import { isTelegramAdmin, resolveGrokBotToken } from "./resolveBots.js";

/** Set by startGrokBot() — token from telegram_bots (DB). */
export let grokBot: Bot;

const GROK_SUFFIX =
  "\n\nPlease provide a concise and helpful response. markdown formatting is preferred.";

let botUsername: string | undefined;
let grokClient: TwitterClient | null = null;
let migratedJson = false;

async function isAdmin(userId: number | undefined): Promise<boolean> {
  return isTelegramAdmin(userId);
}

async function getGrokClient(): Promise<TwitterClient> {
  if (grokClient) return grokClient;
  const { client } = await getTwitterClient();
  grokClient = client;
  return client;
}

function chatType(ctx: Context): string {
  return ctx.chat?.type ?? "private";
}

function telegramChatId(ctx: Context): string {
  return String(ctx.chat!.id);
}

/** One-time import of old conversationId.json into DB (if present). */
async function migrateJsonIfNeeded(): Promise<void> {
  if (migratedJson) return;
  migratedJson = true;
  try {
    const path = new URL("./conversationId.json", import.meta.url);
    const raw = JSON.parse(await readFile(path, "utf-8")) as {
      private?: string[];
      group?: string[];
    };
    const privateIds = raw.private ?? [];
    const groupIds = raw.group ?? [];
    if (privateIds.length === 0 && groupIds.length === 0) return;

    for (const gid of privateIds) {
      await prisma.grokConversation.upsert({
        where: { grokConversationId: String(gid) },
        create: {
          grokConversationId: String(gid),
          telegramChatId: "legacy-private",
          chatType: "private",
          title: "Migrated (private)",
          isActive: false,
        },
        update: {},
      });
    }
    for (const gid of groupIds) {
      await prisma.grokConversation.upsert({
        where: { grokConversationId: String(gid) },
        create: {
          grokConversationId: String(gid),
          telegramChatId: "legacy-group",
          chatType: "group",
          title: "Migrated (group)",
          isActive: false,
        },
        update: {},
      });
    }
    console.log(
      `[grok-bot] migrated ${privateIds.length + groupIds.length} ids from conversationId.json`,
    );
  } catch {
    // file missing or already gone — fine
  }
}

async function getActiveConversation(chatId: string) {
  return prisma.grokConversation.findFirst({
    where: { telegramChatId: chatId, isActive: true },
    orderBy: { updatedAt: "desc" },
  });
}

async function deactivateAllForChat(chatId: string) {
  await prisma.grokConversation.updateMany({
    where: { telegramChatId: chatId, isActive: true },
    data: { isActive: false },
  });
}

async function createConversation(opts: {
  chatId: string;
  chatType: string;
  userId?: string | null;
  title?: string | null;
}) {
  const client = await getGrokClient();
  const res = await client.createGrokConversation();
  if (!res.success || !res.conversationId) {
    throw new Error(res.error ?? "Failed to create Grok conversation");
  }

  await deactivateAllForChat(opts.chatId);

  return prisma.grokConversation.create({
    data: {
      grokConversationId: String(res.conversationId),
      telegramChatId: opts.chatId,
      chatType: opts.chatType,
      title: opts.title ?? null,
      isActive: true,
      createdByUserId: opts.userId ?? null,
    },
  });
}

async function ensureActiveConversation(opts: {
  chatId: string;
  chatType: string;
  userId?: string | null;
}) {
  const existing = await getActiveConversation(opts.chatId);
  if (existing) return existing;
  return createConversation(opts);
}

async function saveMessage(opts: {
  conversationDbId: bigint;
  role: "user" | "assistant";
  content: string;
  telegramUserId?: string | null;
  telegramMessageId?: number | null;
}) {
  await prisma.grokMessage.create({
    data: {
      conversationDbId: opts.conversationDbId,
      role: opts.role,
      content: opts.content,
      telegramUserId: opts.telegramUserId ?? null,
      telegramMessageId:
        opts.telegramMessageId != null ? BigInt(opts.telegramMessageId) : null,
    },
  });
  await prisma.grokConversation.update({
    where: { id: opts.conversationDbId },
    data: { lastMessageAt: new Date() },
  });
}

async function deleteConversationRow(
  row: { id: bigint; grokConversationId: string },
  alsoOnX: boolean,
): Promise<{ xDeleted: boolean; xError?: string }> {
  let xDeleted = false;
  let xError: string | undefined;
  if (alsoOnX) {
    try {
      const client = await getGrokClient();
      const res = await client.deleteGrokConversation(row.grokConversationId);
      xDeleted = res.success;
      if (!res.success) xError = res.error ?? "unknown";
    } catch (err) {
      xError = err instanceof Error ? err.message : String(err);
    }
  }
  await prisma.grokMessage.deleteMany({ where: { conversationDbId: row.id } });
  await prisma.grokConversation.delete({ where: { id: row.id } });
  return xError !== undefined ? { xDeleted, xError } : { xDeleted };
}

function parseIndexOrId(raw: string | undefined): { n?: number; id?: bigint } {
  if (!raw) return {};
  const t = raw.trim();
  if (/^\d+$/.test(t) && t.length < 15) {
    // short numbers are list index (1-based); long ones treated as db id
    const n = Number(t);
    if (n > 0 && n < 10_000) return { n };
    try {
      return { id: BigInt(t) };
    } catch {
      return {};
    }
  }
  return {};
}

async function resolveConversationForChat(
  chatId: string,
  raw: string | undefined,
) {
  const list = await prisma.grokConversation.findMany({
    where: { telegramChatId: chatId },
    orderBy: { createdAt: "desc" },
  });
  if (list.length === 0) return null;

  const { n, id } = parseIndexOrId(raw);
  if (id != null) {
    return list.find((c) => c.id === id) ?? null;
  }
  if (n != null) {
    return list[n - 1] ?? null;
  }
  return list.find((c) => c.isActive) ?? list[0] ?? null;
}

// ── Commands ──────────────────────────────────────────────────────────

function wireGrokBot(grokBot: Bot): void {
void grokBot.api.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "newchat", description: "Start a new Grok conversation" },
  { command: "listchats", description: "List conversations for this chat" },
  { command: "usechat", description: "Switch active conversation: /usechat 1" },
  { command: "delchat", description: "Delete conversation: /delchat [n]" },
  { command: "resetchat", description: "Replace current conversation with a new one" },
  { command: "resetallchat", description: "Delete all conversations in this chat" },
  { command: "history", description: "Show recent messages: /history [n]" },
  { command: "help", description: "Show help" },
]);

grokBot.command("start", async (ctx) => {
  await migrateJsonIfNeeded();
  return ctx.reply(
    "Hello! I'm your Grok bot.\n\n" +
      "• DM (admin only): just send a message\n" +
      "• Group: mention me\n\n" +
      "Conversations are stored in the database. Use /help for management commands.",
  );
});

grokBot.command("help", (ctx) => {
  const helpMessage = `
Available commands:
/start — intro
/newchat — start a new Grok conversation (becomes active)
/listchats — list conversations for this Telegram chat
/usechat <n|id> — switch active conversation
/delchat [n|id] — delete current (or listed) conversation from DB (+ try X delete)
/resetchat — delete current + open a fresh conversation
/resetallchat — delete ALL conversations in this Telegram chat
/history [n] — last n messages from DB (default 10)
/help — this message

Admin-only in private chat. Groups: mention the bot to talk.
`.trim();
  return ctx.reply(helpMessage);
});

grokBot.command("newchat", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) {
    return ctx.reply("Sorry, this command is only available to admins.");
  }
  try {
    await migrateJsonIfNeeded();
    const row = await createConversation({
      chatId: telegramChatId(ctx),
      chatType: chatType(ctx),
      userId: ctx.from?.id != null ? String(ctx.from.id) : null,
      title: `Chat ${new Date().toISOString().slice(0, 16)}`,
    });
    return ctx.reply(
      `Started a new conversation.\n` +
        `DB #${row.id} · Grok ${row.grokConversationId}`,
      { reply_parameters: { message_id: Number(ctx.message?.message_id) } },
    );
  } catch (error) {
    console.error("[grok-bot] newchat:", error);
    return ctx.reply(
      `Failed: ${error instanceof Error ? error.message : String(error)}`,
      { reply_parameters: { message_id: Number(ctx.message?.message_id) } },
    );
  }
});

grokBot.command("listchats", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id)) && ctx.chat?.type === "private") {
    return ctx.reply("Admin only.");
  }
  await migrateJsonIfNeeded();
  const chatId = telegramChatId(ctx);
  const rows = await prisma.grokConversation.findMany({
    where: { telegramChatId: chatId },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { _count: { select: { messages: true } } },
  });
  if (rows.length === 0) {
    return ctx.reply("No conversations for this chat. Use /newchat.");
  }
  const lines = rows.map((r, i) => {
    const active = r.isActive ? " ●" : "";
    const msgs = r._count.messages;
    const title = r.title ? ` — ${r.title}` : "";
    return `${i + 1}. #${r.id}${active}${title}\n   grok:${r.grokConversationId.slice(0, 12)}… · ${msgs} msgs`;
  });
  return ctx.reply(`Conversations (${rows.length}):\n\n${lines.join("\n")}`);
});

grokBot.command("usechat", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) {
    return ctx.reply("Admin only.");
  }
  const arg = ctx.message?.text?.split(/\s+/)[1];
  if (!arg) {
    return ctx.reply("Usage: /usechat <n|id>  (see /listchats)");
  }
  const chatId = telegramChatId(ctx);
  const row = await resolveConversationForChat(chatId, arg);
  if (!row) return ctx.reply("Conversation not found for this chat.");

  await deactivateAllForChat(chatId);
  await prisma.grokConversation.update({
    where: { id: row.id },
    data: { isActive: true },
  });
  return ctx.reply(`Active conversation is now #${row.id} (${row.grokConversationId}).`);
});

grokBot.command("delchat", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) {
    return ctx.reply("Admin only.");
  }
  const arg = ctx.message?.text?.split(/\s+/)[1];
  const chatId = telegramChatId(ctx);
  const row = await resolveConversationForChat(chatId, arg);
  if (!row) return ctx.reply("Nothing to delete. Use /listchats.");

  const wasActive = row.isActive;
  const result = await deleteConversationRow(row, true);

  if (wasActive) {
    // Promote most recent remaining as active
    const next = await prisma.grokConversation.findFirst({
      where: { telegramChatId: chatId },
      orderBy: { updatedAt: "desc" },
    });
    if (next) {
      await prisma.grokConversation.update({
        where: { id: next.id },
        data: { isActive: true },
      });
    }
  }

  const xNote = result.xDeleted
    ? "Also deleted on X."
    : result.xError
      ? `DB removed; X delete failed: ${result.xError}`
      : "DB removed.";
  return ctx.reply(`Deleted conversation #${row.id}. ${xNote}`);
});

grokBot.command("resetchat", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) {
    return ctx.reply("Admin only.");
  }
  try {
    const chatId = telegramChatId(ctx);
    const current = await getActiveConversation(chatId);
    if (current) {
      await deleteConversationRow(current, true);
    }
    const row = await createConversation({
      chatId,
      chatType: chatType(ctx),
      userId: ctx.from?.id != null ? String(ctx.from.id) : null,
      title: `Reset ${new Date().toISOString().slice(0, 16)}`,
    });
    return ctx.reply(
      `Reset. New conversation #${row.id} · ${row.grokConversationId}`,
      { reply_parameters: { message_id: Number(ctx.message?.message_id) } },
    );
  } catch (error) {
    console.error("[grok-bot] resetchat:", error);
    return ctx.reply(
      `Failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

grokBot.command("resetallchat", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) {
    return ctx.reply("Admin only.");
  }
  const chatId = telegramChatId(ctx);
  const rows = await prisma.grokConversation.findMany({
    where: { telegramChatId: chatId },
  });
  if (rows.length === 0) return ctx.reply("No conversations to delete.");

  let xOk = 0;
  for (const row of rows) {
    const r = await deleteConversationRow(row, true);
    if (r.xDeleted) xOk += 1;
  }
  return ctx.reply(
    `Deleted ${rows.length} conversation(s) from DB (${xOk} also removed on X).`,
  );
});

grokBot.command("history", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id)) && ctx.chat?.type === "private") {
    return ctx.reply("Admin only.");
  }
  const nRaw = ctx.message?.text?.split(/\s+/)[1];
  const n = Math.min(Math.max(Number(nRaw) || 10, 1), 40);
  const chatId = telegramChatId(ctx);
  const conv = await getActiveConversation(chatId);
  if (!conv) return ctx.reply("No active conversation. Use /newchat.");

  const messages = await prisma.grokMessage.findMany({
    where: { conversationDbId: conv.id },
    orderBy: { createdAt: "desc" },
    take: n,
  });
  if (messages.length === 0) {
    return ctx.reply(`Active #${conv.id} has no stored messages yet.`);
  }

  const chronological = [...messages].reverse();
  const body = chronological
    .map((m) => {
      const who = m.role === "user" ? "You" : "Grok";
      const text =
        m.content.length > 280 ? `${m.content.slice(0, 277)}…` : m.content;
      return `*${who}:* ${text}`;
    })
    .join("\n\n");

  const header = `History for #${conv.id} (last ${chronological.length}):\n\n`;
  const full = header + body;
  // Telegram 4096 limit
  return ctx.reply(full.length > 4000 ? `${full.slice(0, 3990)}…` : full);
});

// ── Message handler ───────────────────────────────────────────────────

async function askGrok(
  ctx: Context,
  prompt: string,
): Promise<void> {
  const chatId = telegramChatId(ctx);
  const conv = await ensureActiveConversation({
    chatId,
    chatType: chatType(ctx),
    userId: ctx.from?.id != null ? String(ctx.from.id) : null,
  });

  const userContent = prompt + GROK_SUFFIX;
  await saveMessage({
    conversationDbId: conv.id,
    role: "user",
    content: prompt,
    telegramUserId: ctx.from?.id != null ? String(ctx.from.id) : null,
    telegramMessageId: ctx.message?.message_id ?? null,
  });

  await ctx.replyWithChatAction("typing");
  const client = await getGrokClient();
  const res = await client.sendGrokMessage({
    message: userContent,
    conversationId: conv.grokConversationId,
  });

  if (res.success && res.message) {
    await saveMessage({
      conversationDbId: conv.id,
      role: "assistant",
      content: res.message,
    });
    // Prefer rich markdown when available
    try {
      await ctx.replyWithRichMessage(
        { markdown: res.message },
        {
          reply_parameters: { message_id: ctx.message!.message_id },
        },
      );
      return;
    } catch {
      await ctx.reply(res.message, {
        reply_parameters: { message_id: ctx.message!.message_id },
      });
      return;
    }
  }

  await ctx.reply(res.error || "Something went wrong. Try again later.", {
    reply_parameters: { message_id: ctx.message!.message_id },
  });
}

grokBot.on("message", async (ctx) => {
  const rawText = ctx.message.text;
  if (!rawText) return;

  // Commands are handled above; ignore slash messages here
  if (rawText.startsWith("/")) return;

  await migrateJsonIfNeeded();

  const isAdminUser = await isAdmin(ctx.from?.id);
  const replyMessage = ctx.message.reply_to_message?.text
    ? `\n\n[In reply to]: ${ctx.message.reply_to_message.text}`
    : "";

  if (ctx.chat.type === "private") {
    if (!isAdminUser) {
      return ctx.reply(
        "Sorry, this bot is private and only accessible to admins.",
      );
    }
    try {
      await askGrok(ctx, rawText + replyMessage);
    } catch (error) {
      console.error("[grok-bot] private message:", error);
      return ctx.reply(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        { reply_parameters: { message_id: ctx.message.message_id } },
      );
    }
    return;
  }

  // Groups / supergroups — require mention
  if (!botUsername) {
    botUsername = ctx.me.username;
  }

  const mentioned = ctx.message.entities?.some(
    (e) =>
      e.type === "mention" &&
      rawText.slice(e.offset, e.offset + e.length).toLowerCase() ===
        `@${botUsername!.toLowerCase()}`,
  );
  if (!mentioned) return;

  const prompt =
    rawText.replace(new RegExp(`@${botUsername}`, "gi"), "").trim() +
    replyMessage;
  if (!prompt.trim()) {
    return ctx.reply("Send me a message after mentioning me.", {
      reply_parameters: { message_id: ctx.message.message_id },
    });
  }

  try {
    await askGrok(ctx, prompt);
  } catch (error) {
    console.error("[grok-bot] group message:", error);
    return ctx.reply("Something went wrong. Try again later.", {
      reply_parameters: { message_id: ctx.message.message_id },
    });
  }
});
} // end wireGrokBot

/** Load Grok TelegramBot token from DB and start polling. */
export async function startGrokBot(): Promise<void> {
  const token = await resolveGrokBotToken();
  grokBot = new Bot(token);
  wireGrokBot(grokBot);
  await grokBot.start();
}
