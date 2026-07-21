import { Bot } from "grammy";
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { getTwitterClient, markRateLimited } from "../twitter/getClient.js";
import type { UserData } from "../TwitterClient/types.js";
import { TwitterClient } from "../TwitterClient/TwitterClient.js";
import { classifyAccount } from "../services/projectTagger.js";
import * as groupAdmin from "./groupAdmin.js";
import { isTelegramAdmin, resolveDefaultBotToken } from "./resolveBots.js";

/** Set by startMainBot() — token loaded from telegram_bots. */
export let bot: Bot;

async function isAdmin(userId: number | undefined): Promise<boolean> {
  return isTelegramAdmin(userId);
}

function wireMainBot(bot: Bot): void {
bot.api.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "chat_id", description: "Get your chat ID" },
  { command: "seed", description: "Add a seed account (smart-follow graph)" },
  { command: "unseed", description: "Deactivate a seed account" },
  { command: "seeds", description: "List active seed accounts" },
  { command: "watch", description: "Alias for /seed" },
  { command: "unwatch", description: "Alias for /unseed" },
  { command: "list", description: "Alias for /seeds" },
  { command: "addauth", description: "Add a Twitter auth account" },
  { command: "group_info", description: "Get group chat ID and title" },
  { command: "register_group", description: "Register this group in admin catalog" },
  { command: "topics", description: "List known forum topics" },
  { command: "newtopic", description: "Create forum topic: /newtopic Name" },
  { command: "renametopic", description: "Rename topic: /renametopic New name" },
  { command: "closetopic", description: "Close current topic" },
  { command: "reopentopic", description: "Reopen current topic" },
  { command: "deltopic", description: "Delete current topic" },
  { command: "help", description: "Show help message" },
]);

bot.command("start", (ctx) => ctx.reply("Hello! I'm your follow tracker bot."));
bot.command("chat_id", (ctx) => ctx.reply(`Your ID is: ${ctx.from?.id}`));

bot.command("group_info", async (ctx) => {
  const chatId = ctx.chat.id;
  const chatTitle = ctx.chat.title ?? "Unknown";
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    return ctx.reply("This command can only be used in a group chat.");
  }
  try {
    await groupAdmin.ensureGroupFromChatId(chatId);
  } catch {
    /* still print ids */
  }
  if (ctx.message?.is_topic_message && ctx.message.message_thread_id) {
    const topicId = ctx.message.message_thread_id;
    try {
      const group = await groupAdmin.getGroupByChatId(String(chatId));
      if (group) {
        await groupAdmin.registerTopic(
          group.id,
          topicId,
          `Topic ${topicId}`,
        );
      }
    } catch {
      /* catalog best-effort */
    }
    return ctx.reply(
      `Group Name: ${chatTitle}\nGroup ID: ${chatId}\nTopic ID: ${topicId}\n(catalog updated)`,
    );
  }

  return ctx.reply(`Group Name: ${chatTitle}\nGroup ID: ${chatId}`);
});
bot.command("help", (ctx) => {
  const helpMessage = `
Available commands:
/start - Start the bot
/chat_id - Get your chat ID
/seed @username [category] - Add seed (default category CT)
/unseed @username - Deactivate seed
/seeds - List active seeds
(/watch /unwatch /list are aliases)
/addauth <auth_token> <ct0> [label] - Add a Twitter auth account
/group_info - Group + topic IDs
/register_group - Save this group for admin UI
/topics - List known forum topics
/newtopic Name - Create forum topic
/renametopic New name - Rename current topic
/closetopic | /reopentopic | /deltopic - Manage current topic
/help - Show this help message
  `;
  ctx.reply(helpMessage);
});

async function addSeedFromTelegram(
  // grammy CommandContext is wide; keep ops surface minimal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  rawUsername: string | undefined,
  categoryRaw?: string,
): Promise<void> {
  if (!(await isAdmin(ctx.from?.id as number | undefined))) {
    await ctx.reply("You are not authorized to use this command.");
    return;
  }
  if (!rawUsername) {
    await ctx.reply("Usage: /seed @username [category]");
    return;
  }
  const screenName = rawUsername.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(screenName)) {
    await ctx.reply("Invalid Twitter username.");
    return;
  }
  const category = (categoryRaw?.trim() || "CT").slice(0, 64);

  try {
    const existing = await prisma.seedAccount.findUnique({
      where: { username: screenName.toLowerCase() },
    });
    if (existing?.active) {
      await ctx.reply(`@${screenName} is already an active seed.`);
      return;
    }

    await ctx.reply(`Fetching profile for @${screenName}...`);
    const { client, accountId } = await getTwitterClient();
    const result = await client.getUserByScreenName(screenName);
    if (result.rateLimit && result.rateLimit.remaining === 0) {
      await markRateLimited(accountId, result.rateLimit.reset);
    }
    if (!result.success || !result.user) {
      await ctx.reply(
        `Failed to fetch @${screenName}: ${result.error ?? "User not found"}`,
      );
      return;
    }

    const user: UserData = result.user;
    const tags = await classifyAccount(user);
    await prisma.twitterAccount.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        username: user.username,
        name: user.name,
        description: user.description ?? null,
        tags,
        followersCount: user.followersCount ?? null,
        followingCount: user.followingCount ?? null,
        isBlueVerified: user.isBlueVerified ?? null,
        profileImageUrl: user.profileImageUrl ?? null,
        createdAt: user.createdAt ? new Date(user.createdAt) : null,
        followersAtDetect: user.followersCount ?? null,
      },
      update: {
        username: user.username,
        name: user.name,
        description: user.description ?? null,
        tags,
        followersCount: user.followersCount ?? null,
        followingCount: user.followingCount ?? null,
        isBlueVerified: user.isBlueVerified ?? null,
        profileImageUrl: user.profileImageUrl ?? null,
      },
    });

    await prisma.seedAccount.upsert({
      where: { username: user.username.toLowerCase() },
      create: {
        twitterId: user.id,
        username: user.username.toLowerCase(),
        category,
        label: null,
        active: true,
      },
      update: {
        twitterId: user.id,
        category,
        active: true,
      },
    });

    await ctx.reply(
      [
        `✅ Seed active @${user.username}`,
        `Category: ${category}`,
        `Name: ${user.name}`,
        `Followers: ${user.followersCount?.toLocaleString() ?? "N/A"}`,
        ``,
        `Following graph is tracked by seed-tracker (see Seeds in admin).`,
      ].join("\n"),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.reply(`Error: ${message}`);
  }
}

bot.command("seed", async (ctx) => {
  const parts = (ctx.message?.text ?? "").split(/\s+/);
  await addSeedFromTelegram(ctx, parts[1], parts[2]);
});
bot.command("watch", async (ctx) => {
  const parts = (ctx.message?.text ?? "").split(/\s+/);
  await addSeedFromTelegram(ctx, parts[1], parts[2] ?? "CT");
});

bot.command("unseed", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) {
    return ctx.reply("You are not authorized to use this command.");
  }
  const rawUsername = (ctx.message?.text ?? "").split(/\s+/)[1];
  if (!rawUsername) return ctx.reply("Usage: /unseed @username");
  const screenName = rawUsername.replace(/^@/, "").toLowerCase();
  try {
    const entry = await prisma.seedAccount.findUnique({
      where: { username: screenName },
    });
    if (!entry || !entry.active) {
      return ctx.reply(`@${screenName} is not an active seed.`);
    }
    await prisma.seedAccount.update({
      where: { id: entry.id },
      data: { active: false },
    });
    return ctx.reply(`✅ Seed deactivated @${screenName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.reply(`Error: ${message}`);
  }
});
bot.command("unwatch", async (ctx) => {
  // alias
  const text = ctx.message?.text?.replace(/^\/unwatch/, "/unseed") ?? "/unseed";
  // reuse unseed logic
  const rawUsername = text.split(/\s+/)[1];
  if (!(await isAdmin(ctx.from?.id))) {
    return ctx.reply("You are not authorized to use this command.");
  }
  if (!rawUsername) return ctx.reply("Usage: /unseed @username");
  const screenName = rawUsername.replace(/^@/, "").toLowerCase();
  try {
    const entry = await prisma.seedAccount.findUnique({
      where: { username: screenName },
    });
    if (!entry || !entry.active) {
      return ctx.reply(`@${screenName} is not an active seed.`);
    }
    await prisma.seedAccount.update({
      where: { id: entry.id },
      data: { active: false },
    });
    return ctx.reply(`✅ Seed deactivated @${screenName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.reply(`Error: ${message}`);
  }
});

bot.command("seeds", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) {
    return ctx.reply("You are not authorized to use this command.");
  }
  try {
    const entries = await prisma.seedAccount.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { username: "asc" }],
    });
    if (entries.length === 0) {
      return ctx.reply("No active seeds. Use /seed @username [category].");
    }
    const lines = [`🌱 Seeds (${entries.length})`, ``];
    for (const e of entries) {
      lines.push(`• @${e.username} · ${e.category}`);
    }
    return ctx.reply(lines.join("\n"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.reply(`Error: ${message}`);
  }
});
bot.command("list", async (ctx) => {
  // alias → seeds
  if (!(await isAdmin(ctx.from?.id))) {
    return ctx.reply("You are not authorized to use this command.");
  }
  try {
    const entries = await prisma.seedAccount.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { username: "asc" }],
    });
    if (entries.length === 0) {
      return ctx.reply("No active seeds. Use /seed @username [category].");
    }
    const lines = [`🌱 Seeds (${entries.length})`, ``];
    for (const e of entries) {
      lines.push(`• @${e.username} · ${e.category}`);
    }
    return ctx.reply(lines.join("\n"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.reply(`Error: ${message}`);
  }
});

bot.command("addauth", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) {
    return ctx.reply("You are not authorized to use this command.");
  }

  const text = ctx.message?.text ?? "";
  const parts = text.split(/\s+/);
  const authToken = parts[1];
  const ct0 = parts[2];

  if (!authToken || !ct0) {
    return ctx.reply("Usage: /addauth <auth_token> <ct0> [label]");
  }

  try {
    const client = new TwitterClient({ cookies: { authToken, ct0 } });
    const currentUserResult = await client.getCurrentUser();

    if (!currentUserResult.success || !currentUserResult.user) {
      return ctx.reply("Failed to validate the provided auth token and ct0.");
    }

    const account = await prisma.twitterAuthAccount.upsert({
      where: { authToken },
      create: {
        authToken,
        ct0,
        username: currentUserResult.user.username,
        id: BigInt(currentUserResult.user?.id),
        isActive: true,
      },
      update: {
        ct0,
        username: currentUserResult.user.username,
        isActive: true,
        rateLimitedUntil: null,
      },
    });

    return ctx.reply(
      `✅ Auth account added  \nusername: ${account.username ?? "none"} \nid: ${account.id}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.reply(`Error: ${message}`);
  }
});

// ── Forum / group management commands ─────────────────────────────────

bot.command("register_group", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) return ctx.reply("Admin only.");
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    return ctx.reply("Use this command inside the group.");
  }
  try {
    const group = await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    return ctx.reply(
      `✅ Group registered for admin UI.\nID: ${group.chatId}\nTitle: ${group.title ?? "—"}\nForum: ${group.isForum ? "yes" : "no"}`,
    );
  } catch (err) {
    return ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command("topics", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) return ctx.reply("Admin only.");
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    return ctx.reply("Use in a group.");
  }
  try {
    await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    const group = await groupAdmin.getGroupByChatId(String(ctx.chat.id));
    const topics = group?.topics ?? [];
    if (topics.length === 0) {
      return ctx.reply(
        "No topics in catalog yet. Create with /newtopic Name or open a topic and use /group_info then register from admin.",
      );
    }
    const lines = topics.map(
      (t) =>
        `• ${t.name} — thread \`${t.messageThreadId}\`${t.isClosed ? " (closed)" : ""}${t.isGeneral ? " [General]" : ""}`,
    );
    return ctx.reply(`Topics (${topics.length}):\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    return ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command("newtopic", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) return ctx.reply("Admin only.");
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    return ctx.reply("Use in a forum supergroup.");
  }
  const name = (ctx.message?.text ?? "").replace(/^\/newtopic(@\w+)?\s*/i, "").trim();
  if (!name) return ctx.reply("Usage: /newtopic Topic name");
  try {
    const group = await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    const topic = await groupAdmin.createTopic(group.id, name);
    return ctx.reply(
      `✅ Topic created: *${topic.name}*\nthread id: \`${topic.messageThreadId}\``,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    return ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command("renametopic", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) return ctx.reply("Admin only.");
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) return ctx.reply("Run this inside a topic.");
  const name = (ctx.message?.text ?? "").replace(/^\/renametopic(@\w+)?\s*/i, "").trim();
  if (!name) return ctx.reply("Usage: /renametopic New name");
  try {
    const group = await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    await groupAdmin.registerTopic(group.id, threadId, name);
    await groupAdmin.editTopic(group.id, threadId, { name });
    return ctx.reply(`✅ Renamed topic to: ${name}`);
  } catch (err) {
    return ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command("closetopic", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) return ctx.reply("Admin only.");
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) return ctx.reply("Run this inside a topic.");
  try {
    const group = await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    await groupAdmin.closeTopic(group.id, threadId);
    return ctx.reply("✅ Topic closed.");
  } catch (err) {
    return ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command("reopentopic", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) return ctx.reply("Admin only.");
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) return ctx.reply("Run this inside a topic.");
  try {
    const group = await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    await groupAdmin.reopenTopic(group.id, threadId);
    return ctx.reply("✅ Topic reopened.");
  } catch (err) {
    return ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command("deltopic", async (ctx) => {
  if (!(await isAdmin(ctx.from?.id))) return ctx.reply("Admin only.");
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) return ctx.reply("Run this inside a topic.");
  try {
    const group = await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    await groupAdmin.deleteTopic(group.id, threadId);
    return ctx.reply("✅ Topic deleted.");
  } catch (err) {
    return ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ── Detect forum topic create / edit / close (grammy service messages) ─
// Telegram Bot API has no "list topics". We learn topics from:
//   1) forum_topic_created service message (human or other client creates topic)
//   2) our own /newtopic + admin API create (also writes DB)
//   3) first message in an unknown thread_id (fallback discovery)

async function onForumTopicCreated(
  chatId: number,
  messageThreadId: number,
  created: {
    name: string;
    icon_color?: number;
    icon_custom_emoji_id?: string;
    is_name_implicit?: true;
  },
  notifyChat?: { reply: (t: string) => Promise<unknown> },
): Promise<void> {
  const payload: {
    chatId: number;
    messageThreadId: number;
    name: string;
    iconColor?: number;
    iconCustomEmojiId?: string;
  } = {
    chatId,
    messageThreadId,
    name: created.name || `Topic ${messageThreadId}`,
  };
  if (created.icon_color != null) payload.iconColor = created.icon_color;
  if (created.icon_custom_emoji_id) {
    payload.iconCustomEmojiId = created.icon_custom_emoji_id;
  }

  const row = await groupAdmin.upsertTopicFromEvent(payload);
  console.log(
    `[bot] topic created detected chat=${chatId} thread=${messageThreadId} name="${row.name}" db#${row.id}`,
  );

  // Optional ack in-group so you can see detection live
  if (notifyChat) {
    try {
      await notifyChat.reply(
        `📌 New topic detected\n` +
          `Name: ${row.name}\n` +
          `Thread id: \`${row.messageThreadId}\`\n` +
          `(saved to admin catalog)`,
      );
    } catch {
      /* no rights to post — still saved */
    }
  }
}

/** Primary: official service message when a topic is created. */
bot.on("message:forum_topic_created", async (ctx) => {
  const msg = ctx.message;
  const created = msg.forum_topic_created;
  const threadId = msg.message_thread_id;
  if (!created || threadId == null) {
    console.warn("[bot] forum_topic_created without payload/thread", {
      hasCreated: !!created,
      threadId,
    });
    return;
  }
  try {
    await onForumTopicCreated(ctx.chat.id, threadId, created, {
      reply: (t) =>
        // General (1): do not pass message_thread_id
        threadId === 1
          ? ctx.reply(t)
          : ctx.reply(t, { message_thread_id: threadId }),
    });
  } catch (err) {
    console.error("[bot] forum_topic_created sync failed:", err);
  }
});

bot.on("message:forum_topic_edited", async (ctx) => {
  const msg = ctx.message;
  const edited = msg.forum_topic_edited;
  if (!edited || msg.message_thread_id == null) return;
  try {
    const payload: {
      chatId: number;
      messageThreadId: number;
      name: string;
      iconCustomEmojiId?: string;
    } = {
      chatId: ctx.chat.id,
      messageThreadId: msg.message_thread_id,
      name: edited.name || `Topic ${msg.message_thread_id}`,
    };
    if (edited.icon_custom_emoji_id) {
      payload.iconCustomEmojiId = edited.icon_custom_emoji_id;
    }
    const row = await groupAdmin.upsertTopicFromEvent(payload);
    console.log(
      `[bot] topic edited chat=${ctx.chat.id} thread=${row.messageThreadId} name="${row.name}"`,
    );
  } catch (err) {
    console.error("[bot] forum_topic_edited sync failed:", err);
  }
});

bot.on("message:forum_topic_closed", async (ctx) => {
  const threadId = ctx.message?.message_thread_id;
  if (threadId == null) return;
  try {
    const group = await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    await prisma.telegramTopic.upsert({
      where: {
        groupId_messageThreadId: {
          groupId: group.id,
          messageThreadId: threadId,
        },
      },
      create: {
        groupId: group.id,
        messageThreadId: threadId,
        name: `Topic ${threadId}`,
        isClosed: true,
        isGeneral: threadId === 1,
      },
      update: { isClosed: true },
    });
    console.log(`[bot] topic closed chat=${ctx.chat.id} thread=${threadId}`);
  } catch (err) {
    console.warn("[bot] forum_topic_closed:", err);
  }
});

bot.on("message:forum_topic_reopened", async (ctx) => {
  const threadId = ctx.message?.message_thread_id;
  if (threadId == null) return;
  try {
    const group = await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    await prisma.telegramTopic.updateMany({
      where: { groupId: group.id, messageThreadId: threadId },
      data: { isClosed: false },
    });
    console.log(`[bot] topic reopened chat=${ctx.chat.id} thread=${threadId}`);
  } catch (err) {
    console.warn("[bot] forum_topic_reopened:", err);
  }
});

bot.on("message:general_forum_topic_hidden", async (ctx) => {
  try {
    const group = await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    await prisma.telegramTopic.updateMany({
      where: { groupId: group.id, messageThreadId: 1 },
      data: { isHidden: true, isClosed: true },
    });
  } catch {
    /* ignore */
  }
});

bot.on("message:general_forum_topic_unhidden", async (ctx) => {
  try {
    const group = await groupAdmin.ensureGroupFromChatId(ctx.chat.id);
    await prisma.telegramTopic.updateMany({
      where: { groupId: group.id, messageThreadId: 1 },
      data: { isHidden: false },
    });
  } catch {
    /* ignore */
  }
});

/**
 * Fallback: first real message in a forum thread we have never seen.
 * Covers cases where the create service message was missed (bot offline, etc.).
 */
bot.on("message", async (ctx, next) => {
  try {
    const msg = ctx.message;
    if (!msg || ctx.chat.type !== "supergroup") return next();
    // Skip pure service payloads already handled above
    if (
      msg.forum_topic_created ||
      msg.forum_topic_edited ||
      msg.forum_topic_closed ||
      msg.forum_topic_reopened
    ) {
      return next();
    }
    const threadId = msg.message_thread_id;
    if (threadId == null || !msg.is_topic_message) return next();

    const group = await groupAdmin.getGroupByChatId(String(ctx.chat.id));
    if (!group) return next(); // only auto-discover for registered groups

    const known = group.topics.some((t) => t.messageThreadId === threadId);
    if (known) return next();

    const row = await groupAdmin.registerTopic(
      group.id,
      threadId,
      `Topic ${threadId}`,
    );
    console.log(
      `[bot] topic discovered via message chat=${ctx.chat.id} thread=${threadId} db#${row.id}`,
    );
  } catch (err) {
    console.warn("[bot] topic auto-discover failed:", err);
  }
  return next();
});

bot.on("message:new_chat_members", async (ctx) => {
  const newMembers = ctx.message?.new_chat_members ?? [];
  for (const member of newMembers) {
    if (member.is_bot) continue;
    const name = member.username ? `@${member.username}` : member.first_name;
    await ctx.reply(
      `🐺 Welcome to A24 Hunter, ${name}!\n` +
        `\n` +
        `We track real-time follows from top crypto influencers to spot alpha before it goes mainstream.\n` +
        `\n` +
        `🔔 Alerts fire the moment a new follow is detected\n` +
        `\n` +
        `Stay sharp. The alpha is in the follows.`,
    );
  }
});
} // end wireMainBot

/** Load default TelegramBot token from DB and start polling. */
export async function startMainBot(): Promise<void> {
  const token = await resolveDefaultBotToken();
  bot = new Bot(token);
  wireMainBot(bot);
  await bot.start();
}
