// Telegram group / forum-topic administration via grammy Bot API.
// Topics are catalogued in Postgres (Bot API cannot list all topics).

import { Bot, GrammyError } from "grammy";
import { prisma } from "../db/prisma.js";
import { resolveDefaultBotToken } from "./resolveBots.js";

const botCache = new Map<string, Bot>();

function botForToken(token: string): Bot {
  let b = botCache.get(token);
  if (!b) {
    b = new Bot(token);
    botCache.set(token, b);
  }
  return b;
}

/** Resolve grammy Bot for a managed group (DB bot only). */
export async function resolveGroupBot(botDbId?: bigint | null): Promise<Bot> {
  if (botDbId != null) {
    const row = await prisma.telegramBot.findFirst({
      where: { id: botDbId, isActive: true },
    });
    if (row) return botForToken(row.token);
  }
  const def = await prisma.telegramBot.findFirst({
    where: { isDefault: true, isActive: true },
  });
  if (def) return botForToken(def.token);
  return botForToken(await resolveDefaultBotToken());
}

function mapGrammyError(err: unknown): Error {
  if (err instanceof GrammyError) {
    return new Error(`telegram_api: ${err.description} (${err.error_code})`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function ensureGroupFromChatId(
  chatId: string | number,
  opts?: { botDbId?: bigint | null; notes?: string | null },
) {
  const bot = await resolveGroupBot(opts?.botDbId);
  let chat;
  try {
    chat = await bot.api.getChat(chatId);
  } catch (err) {
    throw mapGrammyError(err);
  }

  const type =
    chat.type === "supergroup" || chat.type === "group" || chat.type === "channel"
      ? chat.type
      : "supergroup";
  const isForum =
    "is_forum" in chat ? Boolean((chat as { is_forum?: boolean }).is_forum) : false;
  const title = "title" in chat ? (chat.title ?? null) : null;
  const username = "username" in chat ? (chat.username ?? null) : null;

  const group = await prisma.telegramGroup.upsert({
    where: { chatId: String(chatId) },
    create: {
      chatId: String(chatId),
      title,
      type,
      isForum,
      username,
      botDbId: opts?.botDbId ?? null,
      notes: opts?.notes ?? null,
    },
    update: {
      title,
      type,
      isForum,
      username,
      ...(opts?.botDbId !== undefined ? { botDbId: opts.botDbId } : {}),
      ...(opts?.notes !== undefined ? { notes: opts.notes } : {}),
    },
  });

  // Ensure General topic exists in catalog for forums
  if (isForum) {
    await prisma.telegramTopic.upsert({
      where: {
        groupId_messageThreadId: { groupId: group.id, messageThreadId: 1 },
      },
      create: {
        groupId: group.id,
        messageThreadId: 1,
        name: "General",
        isGeneral: true,
      },
      update: { isGeneral: true },
    });
  }

  return group;
}

export async function listGroups() {
  return prisma.telegramGroup.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      topics: { orderBy: { messageThreadId: "asc" } },
      _count: { select: { topics: true } },
    },
  });
}

export async function getGroup(id: bigint) {
  return prisma.telegramGroup.findUnique({
    where: { id },
    include: {
      topics: { orderBy: { messageThreadId: "asc" } },
    },
  });
}

export async function getGroupByChatId(chatId: string) {
  return prisma.telegramGroup.findUnique({
    where: { chatId: String(chatId) },
    include: { topics: { orderBy: { messageThreadId: "asc" } } },
  });
}

export async function deleteGroupRecord(id: bigint) {
  return prisma.telegramGroup.delete({ where: { id } });
}

export async function createTopic(
  groupId: bigint,
  name: string,
  opts?: { iconColor?: number | null; iconCustomEmojiId?: string | null },
) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    const topic =
      opts?.iconColor != null || opts?.iconCustomEmojiId
        ? await bot.api.createForumTopic(group.chatId, name, {
            icon_color: opts.iconColor ?? undefined,
            icon_custom_emoji_id: opts.iconCustomEmojiId ?? undefined,
          } as Parameters<typeof bot.api.createForumTopic>[2])
        : await bot.api.createForumTopic(group.chatId, name);
    const row = await prisma.telegramTopic.upsert({
      where: {
        groupId_messageThreadId: {
          groupId: group.id,
          messageThreadId: topic.message_thread_id,
        },
      },
      create: {
        groupId: group.id,
        messageThreadId: topic.message_thread_id,
        name: topic.name,
        iconColor: topic.icon_color ?? null,
        iconCustomEmojiId: topic.icon_custom_emoji_id ?? null,
      },
      update: {
        name: topic.name,
        iconColor: topic.icon_color ?? null,
        iconCustomEmojiId: topic.icon_custom_emoji_id ?? null,
        isClosed: false,
      },
    });
    return row;
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function editTopic(
  groupId: bigint,
  messageThreadId: number,
  patch: { name?: string | null; iconCustomEmojiId?: string | null },
) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    if (messageThreadId === 1 && patch.name) {
      await bot.api.editGeneralForumTopic(group.chatId, patch.name);
    } else {
      await bot.api.editForumTopic(group.chatId, messageThreadId, {
        ...(patch.name != null ? { name: patch.name } : {}),
        ...(patch.iconCustomEmojiId !== undefined
          ? { icon_custom_emoji_id: patch.iconCustomEmojiId ?? "" }
          : {}),
      } as Parameters<typeof bot.api.editForumTopic>[2]);
    }
    const data: { name?: string; iconCustomEmojiId?: string | null } = {};
    if (patch.name != null) data.name = patch.name;
    if (patch.iconCustomEmojiId !== undefined) data.iconCustomEmojiId = patch.iconCustomEmojiId;
    return prisma.telegramTopic.update({
      where: {
        groupId_messageThreadId: { groupId, messageThreadId },
      },
      data,
    });
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function closeTopic(groupId: bigint, messageThreadId: number) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    if (messageThreadId === 1) await bot.api.closeGeneralForumTopic(group.chatId);
    else await bot.api.closeForumTopic(group.chatId, messageThreadId);
    return prisma.telegramTopic.update({
      where: { groupId_messageThreadId: { groupId, messageThreadId } },
      data: { isClosed: true },
    });
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function reopenTopic(groupId: bigint, messageThreadId: number) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    if (messageThreadId === 1) await bot.api.reopenGeneralForumTopic(group.chatId);
    else await bot.api.reopenForumTopic(group.chatId, messageThreadId);
    return prisma.telegramTopic.update({
      where: { groupId_messageThreadId: { groupId, messageThreadId } },
      data: { isClosed: false, isHidden: false },
    });
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function hideGeneralTopic(groupId: bigint) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    await bot.api.hideGeneralForumTopic(group.chatId);
    return prisma.telegramTopic.update({
      where: { groupId_messageThreadId: { groupId, messageThreadId: 1 } },
      data: { isHidden: true, isClosed: true },
    });
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function unhideGeneralTopic(groupId: bigint) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    await bot.api.unhideGeneralForumTopic(group.chatId);
    return prisma.telegramTopic.update({
      where: { groupId_messageThreadId: { groupId, messageThreadId: 1 } },
      data: { isHidden: false },
    });
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function deleteTopic(groupId: bigint, messageThreadId: number) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  if (messageThreadId === 1) {
    throw new Error("cannot_delete_general_topic");
  }
  const bot = await resolveGroupBot(group.botDbId);
  try {
    await bot.api.deleteForumTopic(group.chatId, messageThreadId);
    await prisma.telegramTopic.delete({
      where: { groupId_messageThreadId: { groupId, messageThreadId } },
    });
    return { deleted: true, messageThreadId };
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function unpinAllInTopic(groupId: bigint, messageThreadId: number) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    if (messageThreadId === 1) {
      await bot.api.unpinAllGeneralForumTopicMessages(group.chatId);
    } else {
      await bot.api.unpinAllForumTopicMessages(group.chatId, messageThreadId);
    }
    return { ok: true };
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function setGroupTitle(groupId: bigint, title: string) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    await bot.api.setChatTitle(group.chatId, title);
    return prisma.telegramGroup.update({
      where: { id: groupId },
      data: { title },
    });
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function setGroupDescription(groupId: bigint, description: string) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    await bot.api.setChatDescription(group.chatId, description);
    return { ok: true };
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function getChatInfo(groupId: bigint) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    const chat = await bot.api.getChat(group.chatId);
    let admins: unknown[] = [];
    try {
      admins = await bot.api.getChatAdministrators(group.chatId);
    } catch {
      /* bot may lack rights */
    }
    return { chat, admins, group };
  } catch (err) {
    throw mapGrammyError(err);
  }
}

export async function sendToTopic(
  groupId: bigint,
  messageThreadId: number,
  text: string,
) {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const bot = await resolveGroupBot(group.botDbId);
  try {
    // General forum topic (id 1): Bot API requires omitting message_thread_id.
    // Passing 1 → "Bad Request: message thread not found".
    const isGeneral =
      messageThreadId === 1 ||
      (
        await prisma.telegramTopic.findUnique({
          where: {
            groupId_messageThreadId: { groupId, messageThreadId },
          },
          select: { isGeneral: true },
        })
      )?.isGeneral === true;

    if (isGeneral) {
      await bot.api.sendMessage(group.chatId, text);
    } else {
      await bot.api.sendMessage(group.chatId, text, {
        message_thread_id: messageThreadId,
      });
    }
    return { ok: true };
  } catch (err) {
    throw mapGrammyError(err);
  }
}

/** Upsert topic from live Telegram events (forum_topic_created/edited). */
export async function upsertTopicFromEvent(opts: {
  chatId: string | number;
  messageThreadId: number;
  name: string;
  iconColor?: number | null;
  iconCustomEmojiId?: string | null;
  isClosed?: boolean | null;
}) {
  const group = await ensureGroupFromChatId(opts.chatId);
  const update: {
    name: string;
    iconColor?: number | null;
    iconCustomEmojiId?: string | null;
    isClosed?: boolean;
  } = { name: opts.name };
  if (opts.iconColor !== undefined) update.iconColor = opts.iconColor;
  if (opts.iconCustomEmojiId !== undefined) {
    update.iconCustomEmojiId = opts.iconCustomEmojiId;
  }
  if (opts.isClosed != null) update.isClosed = opts.isClosed;

  return prisma.telegramTopic.upsert({
    where: {
      groupId_messageThreadId: {
        groupId: group.id,
        messageThreadId: opts.messageThreadId,
      },
    },
    create: {
      groupId: group.id,
      messageThreadId: opts.messageThreadId,
      name: opts.name,
      iconColor: opts.iconColor ?? null,
      iconCustomEmojiId: opts.iconCustomEmojiId ?? null,
      isClosed: opts.isClosed ?? false,
      isGeneral: opts.messageThreadId === 1,
    },
    update,
  });
}

/** Manually register a topic id without calling create (discovered via /group_info). */
export async function registerTopic(
  groupId: bigint,
  messageThreadId: number,
  name: string,
) {
  return prisma.telegramTopic.upsert({
    where: {
      groupId_messageThreadId: { groupId, messageThreadId },
    },
    create: {
      groupId,
      messageThreadId,
      name,
      isGeneral: messageThreadId === 1,
    },
    update: { name },
  });
}
