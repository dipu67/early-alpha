import { Bot } from "grammy";
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { getTwitterClient, markRateLimited } from "../twitter/getClient.js";
import { addWatchJob, removeWatchJob } from "../services/queue.js";
import type { UserData } from "../TwitterClient/TwitterClient.js";
import {TwitterClient} from "../TwitterClient/TwitterClient.js";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN as string);

const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

function isAdmin(userId: number | undefined): boolean {
  if (!userId) return false;
  return ADMIN_IDS.has(String(userId));
}

bot.api.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "chat_id", description: "Get your chat ID" },
  { command: "watch", description: "Add a Twitter account to watch list" },
  { command: "unwatch", description: "Remove from watch list" },
  { command: "list", description: "Show all watched accounts" },
  { command: "addauth", description: "Add a Twitter auth account" },
  { command: "group_info", description: "Get group chat ID and title" },
  { command: "help", description: "Show help message" },
]);

bot.command("start", (ctx) => ctx.reply("Hello! I'm your follow tracker bot."));
bot.command("chat_id", (ctx) => ctx.reply(`Your ID is: ${ctx.from?.id}`));

bot.command("group_info", (ctx) => {
  

  const chatId = ctx.chat.id;
  const chatTitle = ctx.chat.title ?? "Unknown";
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    return ctx.reply("This command can only be used in a group chat.");
  }
  if (ctx.message?.is_topic_message) {
   const topicId = ctx.message.message_thread_id;
   return ctx.reply(`Group Name: ${chatTitle}\nGroup ID: ${chatId}\nTopic ID: ${topicId}`); 
  }
  
  return ctx.reply(`Group Name: ${chatTitle}\nGroup ID: ${chatId}`);
});
bot.command("help", (ctx) => {
  const helpMessage = `
Available commands:
/start - Start the bot
/chat_id - Get your chat ID
/watch @username - Add a Twitter account to watch list
/unwatch @username - Remove from watch list
/list - Show all watched accounts
/addauth <auth_token> <ct0> [label] - Add a Twitter auth account
/help - Show this help message
  `;
  ctx.reply(helpMessage);
});

bot.command("watch", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) {
    return ctx.reply("You are not authorized to use this command.");
  }

  const text = ctx.message?.text ?? "";
  const parts = text.split(/\s+/);
  const rawUsername = parts[1];

  if (!rawUsername) {
    return ctx.reply("Usage: /watch @username");
  }

  const screenName = rawUsername.replace(/^@/, "");

  if (!/^[A-Za-z0-9_]{1,15}$/.test(screenName)) {
    return ctx.reply("Invalid Twitter username.");
  }

  try {
    const existing = await prisma.watchList.findUnique({
      where: { username: screenName.toLowerCase() },
    });

    if (existing?.isActive) {
      return ctx.reply(`@${screenName} is already being watched.`);
    }

    await ctx.reply(`Fetching profile for @${screenName}...`);

    const { client, accountId } = await getTwitterClient();
    const result = await client.getUserByScreenName(screenName);

    if (result.rateLimit && result.rateLimit.remaining === 0) {
      await markRateLimited(accountId, result.rateLimit.reset);
    }

    if (!result.success || !result.user) {
      return ctx.reply(`Failed to fetch @${screenName}: ${result.error ?? "User not found"}`);
    }

    const user: UserData = result.user;
    console.log(user.id)

    const watchEntry = existing
      ? await prisma.watchList.update({
          where: { id: existing.id },
          data: { isActive: true, twitterUserId: user.id },
        })
      : await prisma.watchList.create({
          data: {
            twitterUserId: user.id,
            username: user.username.toLowerCase(),
            addedBy: ctx.from?.id?.toString() ?? null,
          },
        });

    await prisma.twitterAccount.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        username: user.username,
        name: user.name,
        description: user.description ?? null,
        followersCount: user.followersCount ?? null,
        followingCount: user.followingCount ?? null,
        isBlueVerified: user.isBlueVerified ?? null,
        profileImageUrl: user.profileImageUrl ?? null,
        createdAt: user.createdAt ? new Date(user.createdAt) : null,
      },
      update: {
        username: user.username,
        name: user.name,
        description: user.description ?? null,
        followersCount: user.followersCount ?? null,
        followingCount: user.followingCount ?? null,
        isBlueVerified: user.isBlueVerified ?? null,
        profileImageUrl: user.profileImageUrl ?? null,
      },
    });


    await addWatchJob(watchEntry.id, user.username);

    const summary = [
      `✅ Now watching @${user.username}`,
      ``,
      `Name: ${user.name}`,
      `Followers: ${user.followersCount?.toLocaleString() ?? "N/A"}`,
      `Following: ${user.followingCount?.toLocaleString() ?? "N/A"}`,
      ``,
      `Will check for new follows every 15 minutes.`,
    ].join("\n");

    return ctx.reply(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.reply(`Error: ${message}`);
  }
});

bot.command("unwatch", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) {
    return ctx.reply("You are not authorized to use this command.");
  }

  const text = ctx.message?.text ?? "";
  const parts = text.split(/\s+/);
  const rawUsername = parts[1];

  if (!rawUsername) {
    return ctx.reply("Usage: /unwatch @username");
  }

  const screenName = rawUsername.replace(/^@/, "").toLowerCase();

  try {
    const entry = await prisma.watchList.findUnique({
      where: { username: screenName },
    });

    if (!entry || !entry.isActive) {
      return ctx.reply(`@${screenName} is not being watched.`);
    }

    await prisma.watchList.update({
      where: { id: entry.id },
      data: { isActive: false },
    });

    await removeWatchJob(entry.id);

    return ctx.reply(`✅ Stopped watching @${screenName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.reply(`Error: ${message}`);
  }
});

bot.command("list", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) {
    return ctx.reply("You are not authorized to use this command.");
  }

  try {
    const entries = await prisma.watchList.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });

    if (entries.length === 0) {
      return ctx.reply("No accounts being watched. Use /watch @username to add one.");
    }

    const lines = [`📋 Watch List (${entries.length} accounts)`, ``];
    for (const entry of entries) {
      lines.push(`• @${entry.username}`);
    }

    return ctx.reply(lines.join("\n"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.reply(`Error: ${message}`);
  }
});

bot.command("addauth", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) {
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
      create: { authToken, ct0, username: currentUserResult.user.username, id : BigInt(currentUserResult.user?.id), isActive: true },
      update: { ct0, username: currentUserResult.user.username, isActive: true, rateLimitedUntil: null },
    });

    return ctx.reply(
      `✅ Auth account added  \nusername: ${account.username ?? "none"} \nid: ${account.id}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.reply(`Error: ${message}`);
  }
});

export { bot };
