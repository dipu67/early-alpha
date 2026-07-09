import { Bot } from "grammy";
import "dotenv/config";
import { getTwitterClient } from "../twitter/getClient.js";
import { readFile, writeFile } from "node:fs/promises";

export const grokBot = new Bot(process.env.GROK_BOT_TOKEN as string);
const ADMIN_ID = process.env.ADMIN_IDS;
const GROK_SUFFIX =
  "\n\nPlease provide a concise and helpful response. markdown formatting is preferred.";

const { client: Grok } = await getTwitterClient();
const conversationIdFilePath = new URL(
  "./conversationId.json",
  import.meta.url,
);
let conversationIdData: { private: string[]; group: string[] };
try {
  conversationIdData = JSON.parse(
    await readFile(conversationIdFilePath, "utf-8"),
  );
} catch {
  conversationIdData = { private: [], group: [] };
  await writeFile(
    conversationIdFilePath,
    JSON.stringify(conversationIdData),
    "utf-8",
  );
}
let botUsername: string | undefined;

grokBot.api.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "newchat", description: "Start a new conversation with Grok" },
  {
    command: "resetchat",
    description: "Reset the current conversation with Grok",
  },
  { command: "resetallchat", description: "Reset all conversations with Grok" },
  { command: "help", description: "Show help message" },
]);

grokBot.command("start", (ctx) =>
  ctx.reply(
    "Hello! I'm your Grok bot. Mention me in a group chat or send me a message to start a conversation.",
  ),
);
grokBot.command("help", (ctx) => {
  const helpMessage = `
Available commands:
/start - Start the bot
/newchat - Start a new conversation with Grok
/resetchat - Reset the current conversation with Grok
/resetallchat - Reset all conversations with Grok
/help - Show help message
`;
  ctx.reply(helpMessage);
});

function storeConversationId(conversationId: string, chatType: string) {
  if (chatType === "private") {
    conversationIdData.private.push(conversationId);
  } else if (chatType === "group" || chatType === "supergroup") {
    conversationIdData.group.push(conversationId);
  }
  return writeFile(
    conversationIdFilePath,
    JSON.stringify(conversationIdData),
    "utf-8",
  );
}

grokBot.command("newchat", async (ctx) => {
  if (ctx.from?.id !== Number(ADMIN_ID)) {
    return ctx.reply("Sorry, this command is only available to the admin.");
  }

  try {
    const res = await Grok.createGrokConversation();

    if (res.success) {
      await storeConversationId(String(res.conversationId), ctx.chat.type);
      return ctx.reply(
        `Started a new conversation with Grok. Conversation ID: ${res.conversationId}`,
        {
          reply_parameters: { message_id: Number(ctx.message?.message_id) },
        },
      );
    }

    return ctx.reply("Sorry, I couldn't start a new conversation right now.", {
      reply_parameters: { message_id: Number(ctx.message?.message_id) },
    });
  } catch (error) {
    console.error("Grok error:", error);
    return ctx.reply("Something went wrong. Try again later.", {
      reply_parameters: { message_id: Number(ctx.message?.message_id) },
    });
  }
});

grokBot.on("message", async (ctx) => {
  const isAdmin = ctx.from?.id === Number(ADMIN_ID);
  const rawText = ctx.message.text;
  if (!rawText) return;

  const replyMessage = ctx.message.reply_to_message?.text ?? "";
  const conversationId =
    ctx.chat.type === "private"
      ? conversationIdData.private.at(-1)
      : conversationIdData.group.at(-1);

  if (ctx.chat.type === "private" && !isAdmin) {
    return ctx.reply(
      "Sorry, this bot is private and only accessible to the admin.",
    );
  }

  if (ctx.chat.type === "private" && isAdmin) {
    try {
      ctx.replyWithChatAction("typing");
      const message = rawText + replyMessage + GROK_SUFFIX;
      const request = conversationId
        ? { message, conversationId: String(conversationId) }
        : { message };

      const res = await Grok.sendGrokMessage(request);
      if (res.success && res.message) {
        return ctx.replyWithRichMessage(
          { markdown: res.message },
          {
            reply_parameters: { message_id: ctx.message.message_id },
          },
        );
      }

      return ctx.reply(res.error || "Something went wrong. Try again later.", {
        reply_parameters: { message_id: ctx.message.message_id },
      });
    } catch (error) {
      console.error("Grok error:", error);
      return ctx.reply("Something went wrong. Try again later.", {
        reply_parameters: { message_id: ctx.message.message_id },
      });
    }
  }

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

  const prompt = rawText
    .replace(new RegExp(`@${botUsername}`, "gi"), "")
    .trim();
  if (!prompt) {
    return ctx.reply("Send me a message after mentioning me.", {
      reply_parameters: { message_id: ctx.message.message_id },
      parse_mode: "MarkdownV2",
    });
  }

  try {
    ctx.replyWithChatAction("typing");

    const res = await Grok.sendGrokMessage({
      message: prompt + replyMessage + GROK_SUFFIX,
      conversationId: String(conversationId),
    });

    if (res.success && res.message) {
      return ctx.replyWithRichMessage(
        { markdown: res.message },
        {
          reply_parameters: { message_id: ctx.message.message_id },
        },
      );
    }

    return ctx.reply("Sorry, I couldn't get a response right now.", {
      reply_parameters: { message_id: ctx.message.message_id },
    });
  } catch (error) {
    console.error("Grok error:", error);
    return ctx.reply("Something went wrong. Try again later.", {
      reply_parameters: { message_id: ctx.message.message_id },
    });
  }
});

