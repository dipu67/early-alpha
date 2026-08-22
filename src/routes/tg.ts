// Telegram config router — read/write alert routing + throttle, toggle alert
// types, and send a test message. Values live in the shared settings table and
// the worker reads them live (~5s cache). The bot token stays in env.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import {
  getConfig,
  setConfig,
  CONFIG_KEYS,
  ALERT_TYPES,
  alertEnabledKey,
  alertBotKey,
  alertTopicKey,
  type AlertType,
} from "../services/appConfig.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
import * as groupAdmin from "../tg/groupAdmin.js";

export const tgRouter: Router = Router();

// ── Telegram bots (DB-stored tokens, per-alert routing) ──

function maskToken(token: string): string {
  // token looks like "123456789:AA...". Show the bot id part + last 4.
  const colon = token.indexOf(":");
  const idPart = colon > 0 ? token.slice(0, colon) : "";
  return `${idPart}:****${token.slice(-4)}`;
}

/** Call Telegram getMe to validate a token and fetch the bot's name/username. */
async function telegramGetMe(token: string): Promise<{ name: string; username: string | null } | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as {
      ok?: boolean;
      result?: { first_name?: string; username?: string };
    };
    if (!res.ok || !data.ok || !data.result) return null;
    return { name: data.result.first_name ?? "bot", username: data.result.username ?? null };
  } catch {
    return null;
  }
}

function botView(b: {
  id: bigint;
  name: string;
  username: string | null;
  token: string;
  isDefault: boolean;
  isActive: boolean;
}) {
  return {
    id: b.id.toString(),
    name: b.name,
    username: b.username,
    token: maskToken(b.token),
    isDefault: b.isDefault,
    isActive: b.isActive,
  };
}

tgRouter.get(
  "/bots",
  asyncHandler(async (_req, res) => {
    const bots = await prisma.telegramBot.findMany({ orderBy: { id: "asc" } });
    const assignments: Record<string, string | null> = {};
    const topicAssignments: Record<string, number | null> = {};
    await Promise.all(
      ALERT_TYPES.map(async (t) => {
        assignments[t] = await getConfig<string | null>(alertBotKey(t), null);
        topicAssignments[t] = await getConfig<number | null>(alertTopicKey(t), null);
      }),
    );
    const grokBotId = await getConfig<string | null>(CONFIG_KEYS.tgGrokBotId, null);
    res.json({
      items: bots.map(botView),
      assignments,
      topicAssignments,
      grokBotId,
    });
  }),
);

tgRouter.post(
  "/bots",
  asyncHandler(async (req, res) => {
    const body = z.object({ token: z.string().min(20) }).parse(req.body);
    const info = await telegramGetMe(body.token);
    if (!info) throw new HttpError(400, "invalid_token");

    const count = await prisma.telegramBot.count();
    const bot = await prisma.telegramBot.upsert({
      where: { token: body.token },
      create: {
        token: body.token,
        name: info.name,
        username: info.username,
        isDefault: count === 0, // first bot becomes default
      },
      update: { name: info.name, username: info.username },
    });
    res.status(201).json(botView(bot));
  }),
);

const patchBotBody = z.object({
  isActive: z.boolean().optional(),
  makeDefault: z.boolean().optional(),
  /** Mark this bot as the Grok chat process (settings tg.grokBotId). */
  useAsGrok: z.boolean().optional(),
});

tgRouter.patch(
  "/bots/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const body = patchBotBody.parse(req.body);

    if (body.makeDefault) {
      // Exactly one default: clear others, set this.
      await prisma.telegramBot.updateMany({ data: { isDefault: false } });
      await prisma.telegramBot.update({ where: { id }, data: { isDefault: true, isActive: true } });
    }
    if (body.isActive !== undefined) {
      await prisma.telegramBot.update({ where: { id }, data: { isActive: body.isActive } });
    }
    if (body.useAsGrok === true) {
      // Ensure active so resolveGrokBotToken can load it
      await prisma.telegramBot.update({
        where: { id },
        data: { isActive: true },
      });
      await setConfig(CONFIG_KEYS.tgGrokBotId, id.toString());
    } else if (body.useAsGrok === false) {
      const current = await getConfig<string | null>(CONFIG_KEYS.tgGrokBotId, null);
      if (current === id.toString()) {
        await setConfig(CONFIG_KEYS.tgGrokBotId, null);
      }
    }
    const bot = await prisma.telegramBot.findUnique({ where: { id } });
    if (!bot) throw new HttpError(404, "bot_not_found");
    const grokBotId = await getConfig<string | null>(CONFIG_KEYS.tgGrokBotId, null);
    res.json({ ...botView(bot), grokBotId });
  }),
);

tgRouter.delete(
  "/bots/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const bot = await prisma.telegramBot.findUnique({ where: { id } });
    if (!bot) throw new HttpError(404, "bot_not_found");

    // Clear any per-type assignments pointing at this bot → they fall back to default/env.
    for (const t of ALERT_TYPES) {
      const assigned = await getConfig<string | null>(alertBotKey(t), null);
      if (assigned === id.toString()) await setConfig(alertBotKey(t), null);
    }
    const grokId = await getConfig<string | null>(CONFIG_KEYS.tgGrokBotId, null);
    if (grokId === id.toString()) {
      await setConfig(CONFIG_KEYS.tgGrokBotId, null);
    }
    await prisma.telegramBot.delete({ where: { id } });

    // If we removed the default, promote the next active bot (if any).
    if (bot.isDefault) {
      const next = await prisma.telegramBot.findFirst({ where: { isActive: true }, orderBy: { id: "asc" } });
      if (next) await prisma.telegramBot.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    res.json({ ok: true });
  }),
);

const assignBody = z
  .object({
    type: z.enum(ALERT_TYPES as [AlertType, ...AlertType[]]),
    botId: z.string().nullable().optional(),
    /** Forum topic / message_thread_id for this alert type. null clears override. */
    topicId: z.number().int().nullable().optional(),
  })
  .refine((b) => b.botId !== undefined || b.topicId !== undefined, {
    message: "provide botId and/or topicId",
  });

tgRouter.put(
  "/assignments",
  asyncHandler(async (req, res) => {
    const { type, botId, topicId } = assignBody.parse(req.body);
    if (botId !== undefined) await setConfig(alertBotKey(type), botId);
    if (topicId !== undefined) await setConfig(alertTopicKey(type), topicId);
    res.json({
      ok: true,
      type,
      botId: botId !== undefined ? botId : undefined,
      topicId: topicId !== undefined ? topicId : undefined,
    });
  }),
);

function parseBigId(raw: string | string[] | undefined): bigint {
  const s = Array.isArray(raw) ? raw[0] : raw;
  try {
    return BigInt(s ?? "");
  } catch {
    throw new HttpError(400, `invalid id: ${String(s)}`);
  }
}


tgRouter.get(
  "/config",
  asyncHandler(async (_req, res) => {
    const [
      alertChatId,
      defaultTopicId,
      signalTopicId,
      signalTopicMap,

      minIntervalMs,
      maxRetries,
      adminIdsRaw,
    ] = await Promise.all([
      getConfig<string | null>(CONFIG_KEYS.tgAlertChatId, null),
      getConfig<number | null>(CONFIG_KEYS.tgDefaultTopicId, null),
      getConfig<number | null>(CONFIG_KEYS.tgSignalTopicId, null),
      getConfig<Record<string, number>>(CONFIG_KEYS.tgSignalTopicMap, {}),

      getConfig<number | null>(CONFIG_KEYS.tgMinIntervalMs, null),
      getConfig<number | null>(CONFIG_KEYS.tgMaxRetries, null),
      getConfig<unknown>(CONFIG_KEYS.tgAdminIds, null),
    ]);

    const adminIdsRawVal = await getConfig<unknown>(CONFIG_KEYS.tgAdminIds, null);
    const adminIds: string[] = [];
    if (Array.isArray(adminIdsRawVal)) {
      for (const x of adminIdsRawVal as unknown[]) {
        const s = String(x).trim();
        if (s) adminIds.push(s);
      }
    } else if (typeof adminIdsRawVal === "string" && adminIdsRawVal.trim()) {
      for (const part of (adminIdsRawVal as string).split(/[,\s]+/)) {
        if (part.trim()) adminIds.push(part.trim());
      }
    }

    const alerts: Record<string, boolean> = {};
    await Promise.all(
      ALERT_TYPES.map(async (t) => {
        alerts[t] = await getConfig<boolean>(alertEnabledKey(t), true);
      }),
    );

    res.json({
      config: {
        alertChatId,
        defaultTopicId,
        signalTopicId,
        signalTopicMap,

        minIntervalMs,
        maxRetries,
        adminIds,
      },
      alerts,
    });
  }),
);

const configBody = z.object({
  alertChatId: z.string().nullable().optional(),
  defaultTopicId: z.number().int().nullable().optional(),
  signalTopicId: z.number().int().nullable().optional(),
  signalTopicMap: z.record(z.string(), z.number().int()).optional(),

  minIntervalMs: z.number().int().min(500).nullable().optional(),
  maxRetries: z.number().int().min(0).max(20).nullable().optional(),
  /** Telegram user ids for bot admin commands (array or null to clear). */
  adminIds: z.array(z.string()).nullable().optional(),
});

const KEY_MAP: Record<string, string> = {
  alertChatId: CONFIG_KEYS.tgAlertChatId,
  defaultTopicId: CONFIG_KEYS.tgDefaultTopicId,
  signalTopicId: CONFIG_KEYS.tgSignalTopicId,
  signalTopicMap: CONFIG_KEYS.tgSignalTopicMap,

  minIntervalMs: CONFIG_KEYS.tgMinIntervalMs,
  maxRetries: CONFIG_KEYS.tgMaxRetries,
  adminIds: CONFIG_KEYS.tgAdminIds,
};

tgRouter.put(
  "/config",
  asyncHandler(async (req, res) => {
    const body = configBody.parse(req.body);
    for (const [field, key] of Object.entries(KEY_MAP)) {
      if (field in body) {
        await setConfig(key, (body as Record<string, unknown>)[field]);
      }
    }
    res.json({ ok: true });
  }),
);

const alertParam = z.enum(ALERT_TYPES as [AlertType, ...AlertType[]]);

tgRouter.patch(
  "/alerts/:type",
  asyncHandler(async (req, res) => {
    const type = alertParam.parse(Array.isArray(req.params.type) ? req.params.type[0] : req.params.type);
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    await setConfig(alertEnabledKey(type), body.enabled);
    res.json({ ok: true, type, enabled: body.enabled });
  }),
);

const testBody = z.object({
  chatId: z.string().optional(),
  topicId: z.number().int().optional(),
  botId: z.string().optional(),
});

tgRouter.post(
  "/test",
  asyncHandler(async (req, res) => {
    const body = testBody.parse(req.body ?? {});

    // Token from the chosen bot, else the default DB bot.
    let token: string | undefined;
    if (body.botId) {
      const bot = await prisma.telegramBot.findUnique({ where: { id: BigInt(body.botId) } });
      token = bot?.token;
    }
    if (!token) {
      const def = await prisma.telegramBot.findFirst({ where: { isDefault: true, isActive: true } });
      token = def?.token;
    }
    if (!token) {
      const any = await prisma.telegramBot.findFirst({
        where: { isActive: true },
        orderBy: { id: "asc" },
      });
      token = any?.token;
    }
    if (!token) throw new HttpError(500, "no bot token available — add a TelegramBot in admin");

    const chatId = body.chatId ?? (await getConfig<string | null>(CONFIG_KEYS.tgAlertChatId, null));
    if (!chatId) throw new HttpError(400, "no chat id configured — set alert chat in Telegram settings");
    const rawTopic =
      body.topicId ?? (await getConfig<number | null>(CONFIG_KEYS.tgDefaultTopicId, null)) ?? undefined;
    // General forum topic is id 1 — Telegram rejects message_thread_id: 1
    const topicId =
      rawTopic != null && Number(rawTopic) !== 1 && Number(rawTopic) > 0
        ? Number(rawTopic)
        : undefined;

    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: "✅ *Test alert* from early\\-alpha admin\\.",
      parse_mode: "MarkdownV2",
    };
    if (topicId !== undefined) payload.message_thread_id = topicId;

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await tgRes.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!tgRes.ok || !data.ok) {
      throw new HttpError(502, `telegram: ${data.description ?? tgRes.status}`);
    }
    res.json({ ok: true });
  }),
);

// ── Group / forum topic management (grammy) ───────────────────────────

function parseBig(raw: string | string[] | undefined): bigint {
  const s = Array.isArray(raw) ? raw[0] : raw;
  try {
    return BigInt(s ?? "");
  } catch {
    throw new HttpError(400, `invalid id: ${String(s)}`);
  }
}

function topicView(t: {
  id: bigint;
  messageThreadId: number;
  name: string;
  iconColor: number | null;
  iconCustomEmojiId: string | null;
  isClosed: boolean;
  isHidden: boolean;
  isGeneral: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: t.id.toString(),
    messageThreadId: t.messageThreadId,
    name: t.name,
    iconColor: t.iconColor,
    iconCustomEmojiId: t.iconCustomEmojiId,
    isClosed: t.isClosed,
    isHidden: t.isHidden,
    isGeneral: t.isGeneral,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function groupView(
  g: Awaited<ReturnType<typeof groupAdmin.listGroups>>[number] | NonNullable<Awaited<ReturnType<typeof groupAdmin.getGroup>>>,
) {
  const topics = "topics" in g && Array.isArray(g.topics) ? g.topics.map(topicView) : [];
  return {
    id: g.id.toString(),
    chatId: g.chatId,
    title: g.title,
    type: g.type,
    isForum: g.isForum,
    username: g.username,
    botDbId: g.botDbId?.toString() ?? null,
    notes: g.notes,
    topicCount: "_count" in g && g._count ? g._count.topics : topics.length,
    topics,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

tgRouter.get(
  "/groups",
  asyncHandler(async (_req, res) => {
    const items = await groupAdmin.listGroups();
    res.json({ items: jsonSafe(items.map(groupView)) });
  }),
);

tgRouter.post(
  "/groups",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        chatId: z.union([z.string(), z.number()]),
        botDbId: z.string().optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
      })
      .parse(req.body);
    const botDbId =
      body.botDbId != null && body.botDbId !== ""
        ? BigInt(body.botDbId)
        : null;
    try {
      const group = await groupAdmin.ensureGroupFromChatId(body.chatId, {
        botDbId,
        notes: body.notes ?? null,
      });
      const full = await groupAdmin.getGroup(group.id);
      res.status(201).json(jsonSafe(groupView(full!)));
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : String(err));
    }
  }),
);

tgRouter.get(
  "/groups/:id",
  asyncHandler(async (req, res) => {
    const id = parseBig(req.params.id);
    const group = await groupAdmin.getGroup(id);
    if (!group) throw new HttpError(404, "group_not_found");
    res.json(jsonSafe(groupView(group)));
  }),
);

tgRouter.get(
  "/groups/:id/info",
  asyncHandler(async (req, res) => {
    const id = parseBig(req.params.id);
    try {
      const info = await groupAdmin.getChatInfo(id);
      res.json(
        jsonSafe({
          group: groupView(info.group as never),
          chat: info.chat,
          admins: info.admins,
        }),
      );
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : String(err));
    }
  }),
);

tgRouter.patch(
  "/groups/:id",
  asyncHandler(async (req, res) => {
    const id = parseBig(req.params.id);
    const body = z
      .object({
        title: z.string().min(1).max(128).optional(),
        description: z.string().max(255).optional(),
        notes: z.string().max(500).optional().nullable(),
        botDbId: z.string().optional().nullable(),
      })
      .parse(req.body ?? {});

    try {
      if (body.title) await groupAdmin.setGroupTitle(id, body.title);
      if (body.description !== undefined) {
        await groupAdmin.setGroupDescription(id, body.description);
      }
      if (body.notes !== undefined || body.botDbId !== undefined) {
        await prisma.telegramGroup.update({
          where: { id },
          data: {
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
            ...(body.botDbId !== undefined
              ? {
                  botDbId:
                    body.botDbId && body.botDbId !== ""
                      ? BigInt(body.botDbId)
                      : null,
                }
              : {}),
          },
        });
      }
      const group = await groupAdmin.getGroup(id);
      res.json(jsonSafe(groupView(group!)));
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : String(err));
    }
  }),
);

tgRouter.delete(
  "/groups/:id",
  asyncHandler(async (req, res) => {
    const id = parseBig(req.params.id);
    // Catalog only — does not leave the Telegram chat
    await groupAdmin.deleteGroupRecord(id);
    res.json({ deleted: true, id: id.toString() });
  }),
);

tgRouter.get(
  "/groups/:id/topics",
  asyncHandler(async (req, res) => {
    const id = parseBig(req.params.id);
    const group = await groupAdmin.getGroup(id);
    if (!group) throw new HttpError(404, "group_not_found");
    res.json({ items: jsonSafe(group.topics.map(topicView)) });
  }),
);

tgRouter.post(
  "/groups/:id/topics",
  asyncHandler(async (req, res) => {
    const id = parseBig(req.params.id);
    const body = z
      .object({
        name: z.string().min(1).max(128),
        iconColor: z.number().int().optional(),
        iconCustomEmojiId: z.string().optional(),
      })
      .parse(req.body);
    try {
      const opts: { iconColor?: number; iconCustomEmojiId?: string } = {};
      if (body.iconColor != null) opts.iconColor = body.iconColor;
      if (body.iconCustomEmojiId) opts.iconCustomEmojiId = body.iconCustomEmojiId;
      const topic = await groupAdmin.createTopic(id, body.name, opts);
      res.status(201).json(jsonSafe(topicView(topic)));
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : String(err));
    }
  }),
);

/** Register an existing topic id (from /group_info) into the catalog. */
tgRouter.post(
  "/groups/:id/topics/register",
  asyncHandler(async (req, res) => {
    const id = parseBig(req.params.id);
    const body = z
      .object({
        messageThreadId: z.coerce.number().int().positive(),
        name: z.string().min(1).max(128),
      })
      .parse(req.body);
    const topic = await groupAdmin.registerTopic(
      id,
      body.messageThreadId,
      body.name,
    );
    res.status(201).json(jsonSafe(topicView(topic)));
  }),
);

tgRouter.patch(
  "/groups/:id/topics/:threadId",
  asyncHandler(async (req, res) => {
    const id = parseBig(req.params.id);
    const threadId = z.coerce.number().int().parse(req.params.threadId);
    const body = z
      .object({
        name: z.string().min(1).max(128).optional(),
        iconCustomEmojiId: z.string().nullable().optional(),
        action: z
          .enum(["close", "reopen", "hide", "unhide", "unpin_all"])
          .optional(),
      })
      .parse(req.body ?? {});

    try {
      if (body.action === "close") {
        const t = await groupAdmin.closeTopic(id, threadId);
        res.json(jsonSafe(topicView(t)));
        return;
      }
      if (body.action === "reopen") {
        const t = await groupAdmin.reopenTopic(id, threadId);
        res.json(jsonSafe(topicView(t)));
        return;
      }
      if (body.action === "hide") {
        const t = await groupAdmin.hideGeneralTopic(id);
        res.json(jsonSafe(topicView(t)));
        return;
      }
      if (body.action === "unhide") {
        const t = await groupAdmin.unhideGeneralTopic(id);
        res.json(jsonSafe(topicView(t)));
        return;
      }
      if (body.action === "unpin_all") {
        await groupAdmin.unpinAllInTopic(id, threadId);
        res.json({ ok: true });
        return;
      }
      const patch: { name?: string; iconCustomEmojiId?: string | null } = {};
      if (body.name != null) patch.name = body.name;
      if (body.iconCustomEmojiId !== undefined) {
        patch.iconCustomEmojiId = body.iconCustomEmojiId;
      }
      const t = await groupAdmin.editTopic(id, threadId, patch);
      res.json(jsonSafe(topicView(t)));
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : String(err));
    }
  }),
);

tgRouter.delete(
  "/groups/:id/topics/:threadId",
  asyncHandler(async (req, res) => {
    const id = parseBig(req.params.id);
    const threadId = z.coerce.number().int().parse(req.params.threadId);
    try {
      const r = await groupAdmin.deleteTopic(id, threadId);
      res.json(r);
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : String(err));
    }
  }),
);

tgRouter.post(
  "/groups/:id/topics/:threadId/send",
  asyncHandler(async (req, res) => {
    const id = parseBig(req.params.id);
    const threadId = z.coerce.number().int().parse(req.params.threadId);
    const body = z.object({ text: z.string().min(1).max(4000) }).parse(req.body);
    try {
      await groupAdmin.sendToTopic(id, threadId, body.text);
      res.json({ ok: true });
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : String(err));
    }
  }),
);
