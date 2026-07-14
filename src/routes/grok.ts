// Grok bot conversations + research admin API.
//
// Conversations:
//   GET/POST/DELETE /grok/conversations...
// Research:
//   GET    /grok/prompts
//   POST   /grok/prompts
//   PATCH  /grok/prompts/:id
//   DELETE /grok/prompts/:id
//   POST   /grok/research/preview   -> render template with projects
//   GET    /grok/research/projects  -> projects by tag for picker
//   POST   /grok/research/run       -> call Grok, store run
//   GET    /grok/research/runs
//   GET    /grok/research/runs/:id
//   DELETE /grok/research/runs/:id

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { paginationSchema, jsonSafe } from "../http.js";
import { getTwitterClient } from "../twitter/getClient.js";
import {
  ensureBuiltinPrompts,
  loadProjectsByIds,
  loadProjectsByTag,
  renderResearchPrompt,
  runGrokResearch,
} from "../services/grokResearch.js";
import { sendTelegramRichMarkdown } from "../tg/sendAlert.js";

export const grokRouter: Router = Router();

const listQuery = paginationSchema.extend({
  chatId: z.string().optional(),
  active: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
});

function parseBigId(raw: string | string[] | undefined): bigint {
  const s = Array.isArray(raw) ? raw[0] : raw;
  try {
    return BigInt(s ?? "");
  } catch {
    throw new HttpError(400, `invalid id: ${String(s)}`);
  }
}

async function tryDeleteOnX(grokConversationId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const { client } = await getTwitterClient();
    const res = await client.deleteGrokConversation(grokConversationId);
    return res.success
      ? { ok: true }
      : { ok: false, error: res.error ?? "x_delete_failed" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

grokRouter.get(
  "/conversations",
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const where = {
      ...(q.chatId ? { telegramChatId: q.chatId } : {}),
      ...(q.active === undefined ? {} : { isActive: q.active }),
    };

    const [items, total] = await Promise.all([
      prisma.grokConversation.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: q.limit,
        skip: q.offset,
        include: {
          _count: { select: { messages: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { role: true, content: true, createdAt: true },
          },
        },
      }),
      prisma.grokConversation.count({ where }),
    ]);

    res.json({
      total,
      limit: q.limit,
      offset: q.offset,
      items: jsonSafe(
        items.map((c) => {
          const last = c.messages[0] ?? null;
          return {
            id: c.id,
            grokConversationId: c.grokConversationId,
            telegramChatId: c.telegramChatId,
            chatType: c.chatType,
            title: c.title,
            isActive: c.isActive,
            createdByUserId: c.createdByUserId,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            lastMessageAt: c.lastMessageAt,
            messageCount: c._count.messages,
            preview: last
              ? {
                  role: last.role,
                  content:
                    last.content.length > 160
                      ? `${last.content.slice(0, 157)}…`
                      : last.content,
                  createdAt: last.createdAt,
                }
              : null,
          };
        }),
      ),
    });
  }),
);

grokRouter.get(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const limit = z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit ?? 100);

    const row = await prisma.grokConversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          take: limit,
        },
        _count: { select: { messages: true } },
      },
    });
    if (!row) throw new HttpError(404, "conversation_not_found");

    res.json(
      jsonSafe({
        id: row.id,
        grokConversationId: row.grokConversationId,
        telegramChatId: row.telegramChatId,
        chatType: row.chatType,
        title: row.title,
        isActive: row.isActive,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastMessageAt: row.lastMessageAt,
        messageCount: row._count.messages,
        messages: row.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          telegramUserId: m.telegramUserId,
          telegramMessageId: m.telegramMessageId,
          createdAt: m.createdAt,
        })),
      }),
    );
  }),
);

grokRouter.post(
  "/conversations/:id/activate",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const row = await prisma.grokConversation.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, "conversation_not_found");

    await prisma.grokConversation.updateMany({
      where: { telegramChatId: row.telegramChatId, isActive: true },
      data: { isActive: false },
    });
    const updated = await prisma.grokConversation.update({
      where: { id },
      data: { isActive: true },
    });
    res.json(jsonSafe(updated));
  }),
);

const deleteQuery = z.object({
  onX: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

grokRouter.delete(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const { onX } = deleteQuery.parse(req.query);
    const row = await prisma.grokConversation.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, "conversation_not_found");

    let x: { ok: boolean; error?: string } | null = null;
    if (onX) {
      x = await tryDeleteOnX(row.grokConversationId);
    }

    await prisma.grokConversation.delete({ where: { id } });
    res.json(
      jsonSafe({
        deleted: true,
        id: row.id,
        grokConversationId: row.grokConversationId,
        xDeleted: x?.ok ?? null,
        xError: x && !x.ok ? x.error : null,
      }),
    );
  }),
);

const bulkDeleteQuery = z.object({
  chatId: z.string().optional(),
  onX: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

grokRouter.delete(
  "/conversations",
  asyncHandler(async (req, res) => {
    const q = bulkDeleteQuery.parse(req.query);
    const where = q.chatId ? { telegramChatId: q.chatId } : {};
    const rows = await prisma.grokConversation.findMany({
      where,
      select: { id: true, grokConversationId: true },
    });

    let xOk = 0;
    if (q.onX) {
      for (const row of rows) {
        const r = await tryDeleteOnX(row.grokConversationId);
        if (r.ok) xOk += 1;
      }
    }

    const result = await prisma.grokConversation.deleteMany({ where });

    res.json({
      deleted: result.count,
      xDeleted: q.onX ? xOk : null,
    });
  }),
);

// ── Research prompts ──────────────────────────────────────────────────

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

grokRouter.get(
  "/prompts",
  asyncHandler(async (_req, res) => {
    await ensureBuiltinPrompts();
    const items = await prisma.grokResearchPrompt.findMany({
      orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
    });
    res.json({ items: jsonSafe(items) });
  }),
);

/** Force-seed / refresh all built-in special prompts into the DB (Tools button). */
grokRouter.post(
  "/prompts/seed",
  asyncHandler(async (_req, res) => {
    const result = await ensureBuiltinPrompts();
    const items = await prisma.grokResearchPrompt.findMany({
      orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
    });
    res.json(
      jsonSafe({
        ok: true,
        upserted: result.upserted,
        slugs: result.slugs,
        items,
      }),
    );
  }),
);

const promptBody = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64).optional(),
  description: z.string().max(500).optional().nullable(),
  template: z.string().min(20).max(50_000),
  defaultTag: z.string().max(64).optional().nullable(),
});

/**
 * Upsert a custom prompt by slug (preferred for UI "Save").
 * Never overwrites isBuiltin=true rows — use a new slug or seed tool for builtins.
 */
grokRouter.post(
  "/prompts/upsert",
  asyncHandler(async (req, res) => {
    const body = promptBody.parse(req.body);
    const slug = slugify(body.slug || body.name);
    if (!slug) throw new HttpError(400, "invalid_slug");

    const existing = await prisma.grokResearchPrompt.findUnique({ where: { slug } });
    if (existing?.isBuiltin) {
      throw new HttpError(
        409,
        "builtin_slug — pick another name, or copy (e.g. add “my-” prefix)",
      );
    }

    const row = await prisma.grokResearchPrompt.upsert({
      where: { slug },
      create: {
        slug,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        template: body.template,
        defaultTag: body.defaultTag?.trim().toLowerCase() || null,
        isBuiltin: false,
      },
      update: {
        name: body.name.trim(),
        description: body.description?.trim() || null,
        template: body.template,
        defaultTag: body.defaultTag?.trim().toLowerCase() || null,
      },
    });
    res.status(existing ? 200 : 201).json(jsonSafe(row));
  }),
);

grokRouter.post(
  "/prompts",
  asyncHandler(async (req, res) => {
    const body = promptBody.parse(req.body);
    const slug = slugify(body.slug || body.name);
    if (!slug) throw new HttpError(400, "invalid_slug");

    const existing = await prisma.grokResearchPrompt.findUnique({ where: { slug } });
    if (existing) throw new HttpError(409, "slug_exists");

    const row = await prisma.grokResearchPrompt.create({
      data: {
        slug,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        template: body.template,
        defaultTag: body.defaultTag?.trim().toLowerCase() || null,
        isBuiltin: false,
      },
    });
    res.status(201).json(jsonSafe(row));
  }),
);

grokRouter.patch(
  "/prompts/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const body = promptBody.partial().parse(req.body ?? {});
    const existing = await prisma.grokResearchPrompt.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "prompt_not_found");
    if (existing.isBuiltin && body.template !== undefined) {
      // Allow renaming description only? Safer: block template overwrite of builtins via PATCH.
      throw new HttpError(
        400,
        "cannot_edit_builtin — save as a new name (Save prompt) or re-seed builtins via Tools",
      );
    }

    const row = await prisma.grokResearchPrompt.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined
          ? { description: body.description?.trim() || null }
          : {}),
        ...(body.template !== undefined ? { template: body.template } : {}),
        ...(body.defaultTag !== undefined
          ? { defaultTag: body.defaultTag?.trim().toLowerCase() || null }
          : {}),
      },
    });
    res.json(jsonSafe(row));
  }),
);

grokRouter.delete(
  "/prompts/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const existing = await prisma.grokResearchPrompt.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "prompt_not_found");
    if (existing.isBuiltin) throw new HttpError(400, "cannot_delete_builtin");
    await prisma.grokResearchPrompt.delete({ where: { id } });
    res.json({ deleted: true, id: id.toString() });
  }),
);

// ── Research projects picker + preview + run ──────────────────────────

const projectsQuery = z.object({
  tag: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(40),
  search: z.string().optional(),
});

grokRouter.get(
  "/research/projects",
  asyncHandler(async (req, res) => {
    const q = projectsQuery.parse(req.query);
    let items = await loadProjectsByTag(q.tag, q.limit);
    if (q.search?.trim()) {
      const s = q.search.trim().toLowerCase();
      items = items.filter(
        (p) =>
          p.username.toLowerCase().includes(s) ||
          p.name.toLowerCase().includes(s),
      );
    }
    res.json({
      tag: q.tag,
      total: items.length,
      items: jsonSafe(items),
    });
  }),
);

const previewBody = z.object({
  template: z.string().min(1),
  tag: z.string().optional().default(""),
  projectIds: z.array(z.string().min(1)).min(1).max(80),
});

grokRouter.post(
  "/research/preview",
  asyncHandler(async (req, res) => {
    const body = previewBody.parse(req.body);
    const projects = await loadProjectsByIds(body.projectIds);
    if (projects.length === 0) throw new HttpError(400, "no_projects");
    const rendered = renderResearchPrompt(body.template, {
      tag: body.tag,
      projects,
    });
    res.json({
      rendered,
      projectCount: projects.length,
      handles: projects.map((p) => p.username),
    });
  }),
);

const runBody = z.object({
  promptId: z.string().optional().nullable(),
  template: z.string().min(20).max(50_000),
  tag: z.string().optional().default(""),
  projectIds: z.array(z.string().min(1)).min(1).max(40),
  title: z.string().max(200).optional().nullable(),
  /** If true, also upsert the template as a saved prompt (name required). */
  savePrompt: z
    .object({
      name: z.string().min(1).max(120),
      slug: z.string().optional(),
      description: z.string().max(500).optional().nullable(),
      defaultTag: z.string().max(64).optional().nullable(),
    })
    .optional()
    .nullable(),
});

grokRouter.post(
  "/research/run",
  asyncHandler(async (req, res) => {
    const body = runBody.parse(req.body);

    let promptId: bigint | null =
      body.promptId && body.promptId !== ""
        ? (() => {
            try {
              return BigInt(body.promptId!);
            } catch {
              throw new HttpError(400, "invalid_prompt_id");
            }
          })()
        : null;

    // Optionally save / update a custom prompt before running
    if (body.savePrompt) {
      const slug = slugify(body.savePrompt.slug || body.savePrompt.name);
      if (!slug) throw new HttpError(400, "invalid_slug");
      const saved = await prisma.grokResearchPrompt.upsert({
        where: { slug },
        create: {
          slug,
          name: body.savePrompt.name.trim(),
          description: body.savePrompt.description?.trim() || null,
          template: body.template,
          defaultTag:
            body.savePrompt.defaultTag?.trim().toLowerCase() ||
            body.tag.trim().toLowerCase() ||
            null,
          isBuiltin: false,
        },
        update: {
          name: body.savePrompt.name.trim(),
          description: body.savePrompt.description?.trim() || null,
          template: body.template,
          defaultTag:
            body.savePrompt.defaultTag?.trim().toLowerCase() ||
            body.tag.trim().toLowerCase() ||
            null,
        },
      });
      promptId = saved.id;
    }

    const result = await runGrokResearch({
      promptId,
      template: body.template,
      tag: body.tag,
      projectIds: body.projectIds,
      title: body.title ?? null,
    });

    const status = result.status === "success" ? 200 : 502;
    res.status(status).json(
      jsonSafe({
        runId: result.runId,
        status: result.status,
        response: result.response,
        error: result.error,
        renderedPrompt: result.renderedPrompt,
        grokConversationId: result.grokConversationId,
        promptId: promptId?.toString() ?? null,
      }),
    );
  }),
);

grokRouter.get(
  "/research/runs",
  asyncHandler(async (req, res) => {
    const q = paginationSchema.extend({ tag: z.string().optional() }).parse(req.query);
    const where = q.tag ? { tag: q.tag } : {};
    const [items, total] = await Promise.all([
      prisma.grokResearchRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: q.limit,
        skip: q.offset,
        select: {
          id: true,
          promptId: true,
          title: true,
          tag: true,
          projectIds: true,
          projectHandles: true,
          status: true,
          error: true,
          grokConversationId: true,
          createdAt: true,
          completedAt: true,
          prompt: { select: { name: true, slug: true } },
        },
      }),
      prisma.grokResearchRun.count({ where }),
    ]);
    res.json({
      total,
      limit: q.limit,
      offset: q.offset,
      items: jsonSafe(
        items.map((r) => ({
          ...r,
          projectCount: r.projectIds.length,
          promptName: r.prompt?.name ?? null,
          promptSlug: r.prompt?.slug ?? null,
          prompt: undefined,
        })),
      ),
    });
  }),
);

grokRouter.get(
  "/research/runs/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const row = await prisma.grokResearchRun.findUnique({
      where: { id },
      include: { prompt: { select: { id: true, name: true, slug: true } } },
    });
    if (!row) throw new HttpError(404, "run_not_found");
    res.json(jsonSafe(row));
  }),
);

grokRouter.delete(
  "/research/runs/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const existing = await prisma.grokResearchRun.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "run_not_found");
    await prisma.grokResearchRun.delete({ where: { id } });
    res.json({ deleted: true, id: id.toString() });
  }),
);

const sendTelegramBody = z.object({
  /** Forum topic / message_thread_id. Falls back to default topic if omitted. */
  topicId: z.coerce.number().int().optional().nullable(),
  /** Override alert chat; default = configured ALERT_CHAT_ID / settings. */
  chatId: z.string().min(1).optional().nullable(),
  /** Also include the rendered prompt (default: response only). */
  includePrompt: z.boolean().optional().default(false),
});

/**
 * Push a research run to Telegram as RichMessage (grammy sendRichMessage),
 * optionally into a forum topic.
 */
grokRouter.post(
  "/research/runs/:id/send-telegram",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const body = sendTelegramBody.parse(req.body ?? {});
    const run = await prisma.grokResearchRun.findUnique({ where: { id } });
    if (!run) throw new HttpError(404, "run_not_found");
    if (run.status !== "success" || !run.response) {
      throw new HttpError(400, "run_not_ready");
    }

    const handles =
      run.projectHandles.length > 0
        ? run.projectHandles.map((h) => `@${h}`).join(" · ")
        : "—";
    const header = [
      `# 🧪 Grok research`,
      ``,
      `**${run.title ?? `Run #${run.id}`}**`,
      run.tag ? `Tag: \`${run.tag}\`` : null,
      `Projects (${run.projectHandles.length}): ${handles}`,
      ``,
      `---`,
      ``,
    ]
      .filter((l) => l !== null)
      .join("\n");

    const bodyMd = body.includePrompt
      ? `${header}${run.response}\n\n---\n\n### Prompt sent\n\n\`\`\`\n${run.renderedPrompt.slice(0, 2500)}\n\`\`\``
      : `${header}${run.response}`;

    try {
      const result = await sendTelegramRichMarkdown({
        markdown: bodyMd,
        topicId: body.topicId ?? null,
        chatId: body.chatId ?? null,
      });
      res.json({
        ok: true,
        runId: id.toString(),
        parts: result.parts,
        chatId: result.chatId,
        topicId: result.topicId ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[grok] send-telegram failed:", message);
      throw new HttpError(502, `telegram_send_failed: ${message}`);
    }
  }),
);
