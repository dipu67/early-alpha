// Tags + lists admin router.
//
//   GET    /tags                -> project_tags lexicon (slug, label, keywords)
//   GET    /tags/:slug          -> one tag
//   POST   /tags                -> create tag (+ keywords)
//   PATCH  /tags/:slug          -> update label / enabled / keywords
//   DELETE /tags/:slug          -> delete tag
//   POST   /tags/seed           -> enqueue seed keywords from lexicon file
//   POST   /tags/backfill       -> enqueue re-classify accounts from lexicon
//   GET    /projects            -> tagged TwitterAccounts, filter by tag/search
//   POST   /projects/fetch-profiles -> getUsersByIds → fill null bios (+ re-tag)
//   POST   /projects/:id/fetch-profile -> same for one project
//   DELETE /projects/:id        -> remove project account from DB (+ list mirror)
//   GET    /lists               -> ProjectLists with member counts
//   POST   /lists               -> create list (slug + auth owner)
//   DELETE /lists/:slug         -> delete one list on Twitter + DB
//   GET    /lists/:slug/members -> members of one list
//   POST   /reclassify          -> enqueue reclassify (set tags + reconcile)
//   POST   /reconcile           -> enqueue reconcile-lists
//   POST   /lists/delete        -> enqueue bulk list-delete

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { paginationSchema, jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import { invalidateLexiconCache } from "../services/projectTagger.js";
import { fetchAndUpdateProjectProfiles } from "../services/projectProfile.js";
import {
  createProjectList,
  deleteProjectList,
  setAccountTags,
} from "../services/projectLists.js";

export const tagsListsRouter: Router = Router();

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case");

const keywordListSchema = z.array(z.string().min(1).max(200)).max(500);

function paramSlug(req: { params: { slug?: string | string[] } }): string {
  const raw = req.params.slug;
  return Array.isArray(raw) ? raw[0]! : raw!;
}

// ── Project tags / keyword lexicon ──

function serializeTag(t: {
  slug: string;
  label: string;
  enabled: boolean;
  isBuiltin: boolean;
  keywords: string[];
  regexKeywords: string[];
  handleTokens: string[];
  handleSuffixTokens: string[];
  createdAt: Date;
}) {
  return {
    slug: t.slug,
    label: t.label,
    enabled: t.enabled,
    isBuiltin: t.isBuiltin,
    keywords: t.keywords,
    regexKeywords: t.regexKeywords,
    handleTokens: t.handleTokens,
    handleSuffixTokens: t.handleSuffixTokens,
    keywordCount: t.keywords.length + t.regexKeywords.length,
    handleTokenCount: t.handleTokens.length + t.handleSuffixTokens.length,
    createdAt: t.createdAt,
  };
}

tagsListsRouter.get(
  "/tags",
  asyncHandler(async (_req, res) => {
    const tags = await prisma.projectTag.findMany({ orderBy: { slug: "asc" } });
    res.json({ items: jsonSafe(tags.map(serializeTag)) });
  }),
);

tagsListsRouter.get(
  "/tags/:slug",
  asyncHandler(async (req, res) => {
    const slug = paramSlug(req);
    const t = await prisma.projectTag.findUnique({ where: { slug } });
    if (!t) throw new HttpError(404, "tag_not_found");
    res.json({ item: jsonSafe(serializeTag(t)) });
  }),
);

const createTagBody = z.object({
  slug: slugSchema,
  label: z.string().min(1).max(80),
  enabled: z.boolean().optional().default(true),
  keywords: keywordListSchema.optional().default([]),
  regexKeywords: keywordListSchema.optional().default([]),
  handleTokens: keywordListSchema.optional().default([]),
  handleSuffixTokens: keywordListSchema.optional().default([]),
});

tagsListsRouter.post(
  "/tags",
  asyncHandler(async (req, res) => {
    const body = createTagBody.parse(req.body);
    const existing = await prisma.projectTag.findUnique({ where: { slug: body.slug } });
    if (existing) throw new HttpError(409, "tag_exists");

    const t = await prisma.projectTag.create({
      data: {
        slug: body.slug,
        label: body.label,
        enabled: body.enabled,
        isBuiltin: false,
        keywords: body.keywords,
        regexKeywords: body.regexKeywords,
        handleTokens: body.handleTokens,
        handleSuffixTokens: body.handleSuffixTokens,
      },
    });
    invalidateLexiconCache();
    res.status(201).json({ item: jsonSafe(serializeTag(t)) });
  }),
);

const patchTagBody = z
  .object({
    label: z.string().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    keywords: keywordListSchema.optional(),
    regexKeywords: keywordListSchema.optional(),
    handleTokens: keywordListSchema.optional(),
    handleSuffixTokens: keywordListSchema.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "empty_patch" });

tagsListsRouter.patch(
  "/tags/:slug",
  asyncHandler(async (req, res) => {
    const slug = paramSlug(req);
    const body = patchTagBody.parse(req.body);
    const existing = await prisma.projectTag.findUnique({ where: { slug } });
    if (!existing) throw new HttpError(404, "tag_not_found");

    const t = await prisma.projectTag.update({
      where: { slug },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.keywords !== undefined ? { keywords: body.keywords } : {}),
        ...(body.regexKeywords !== undefined ? { regexKeywords: body.regexKeywords } : {}),
        ...(body.handleTokens !== undefined ? { handleTokens: body.handleTokens } : {}),
        ...(body.handleSuffixTokens !== undefined
          ? { handleSuffixTokens: body.handleSuffixTokens }
          : {}),
      },
    });
    invalidateLexiconCache();
    res.json({ item: jsonSafe(serializeTag(t)) });
  }),
);

tagsListsRouter.delete(
  "/tags/:slug",
  asyncHandler(async (req, res) => {
    const slug = paramSlug(req);
    const existing = await prisma.projectTag.findUnique({ where: { slug } });
    if (!existing) throw new HttpError(404, "tag_not_found");

    await prisma.projectTag.delete({ where: { slug } });
    invalidateLexiconCache();
    res.json({ deleted: true, slug });
  }),
);

// ── Lexicon tools (same as npm run tag:seed-keywords / tag:backfill) ──

// Static paths before /tags/:slug — already past delete; post seed/backfill are fine.
tagsListsRouter.post(
  "/tags/seed",
  asyncHandler(async (_req, res) => {
    // Prefer sync seed when small; still enqueue so UI stays fast and worker logs.
    const result = await enqueueJob("tag-seed", {});
    res.status(202).json({ enqueued: true, ...result });
  }),
);

const backfillBody = z.object({
  onlyUnknown: z.boolean().optional().default(false),
  limit: z.number().int().positive().max(100_000).optional(),
});

tagsListsRouter.post(
  "/tags/backfill",
  asyncHandler(async (req, res) => {
    const body = backfillBody.parse(req.body ?? {});
    const result = await enqueueJob("tag-backfill", body);
    res.status(202).json({ enqueued: true, ...result });
  }),
);

const PROJECT_SORTS = [
  "latest", // first seen desc (newest detections)
  "oldest",
  "followers", // most followers
  "followers_asc",
  "username",
  "updated", // last profile/tag update
] as const;

const projectsQuery = paginationSchema.extend({
  tag: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(PROJECT_SORTS).optional().default("latest"),
  /** Only accounts with null/empty description (bio). */
  missingBio: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false")])
    .optional(),
});

function projectsOrderBy(
  sort: (typeof PROJECT_SORTS)[number],
):
  | { firstSeenAt: "desc" | "asc" }
  | { followersCount: { sort: "desc" | "asc"; nulls: "last" } }
  | { username: "asc" }
  | { updatedAt: "desc" } {
  switch (sort) {
    case "oldest":
      return { firstSeenAt: "asc" };
    case "followers":
      return { followersCount: { sort: "desc", nulls: "last" } };
    case "followers_asc":
      return { followersCount: { sort: "asc", nulls: "last" } };
    case "username":
      return { username: "asc" };
    case "updated":
      return { updatedAt: "desc" };
    case "latest":
    default:
      return { firstSeenAt: "desc" };
  }
}

tagsListsRouter.get(
  "/projects",
  asyncHandler(async (req, res) => {
    const q = projectsQuery.parse(req.query);
    const missingBio =
      q.missingBio === "1" || q.missingBio === "true"
        ? true
        : q.missingBio === "0" || q.missingBio === "false"
          ? false
          : null;

    const where = {
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.search
        ? {
            OR: [
              { username: { contains: q.search, mode: "insensitive" as const } },
              { name: { contains: q.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(missingBio
        ? { OR: [{ description: null }, { description: "" }] }
        : {}),
    };

    const [items, total, missingBioCount] = await Promise.all([
      prisma.twitterAccount.findMany({
        where,
        orderBy: projectsOrderBy(q.sort),
        take: q.limit,
        skip: q.offset,
        select: {
          id: true,
          username: true,
          name: true,
          description: true,
          tags: true,
          followersCount: true,
          isBlueVerified: true,
          listsSyncedAt: true,
          firstSeenAt: true,
          updatedAt: true,
        },
      }),
      prisma.twitterAccount.count({ where }),
      prisma.twitterAccount.count({
        where: { OR: [{ description: null }, { description: "" }] },
      }),
    ]);

    res.json({
      total,
      limit: q.limit,
      offset: q.offset,
      sort: q.sort,
      missingBioCount,
      items: jsonSafe(items),
    });
  }),
);

const fetchProfilesBody = z.object({
  ids: z.array(z.string().min(1)).max(200).optional(),
  /** Default true when no ids — only rows with null/empty bio. */
  missingBioOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  /** Re-run tag classifier after bio update (default true). */
  reclassify: z.boolean().optional(),
});

/** Bulk: getUsersByIds → update description/name/counts (+ optional re-tag). */
tagsListsRouter.post(
  "/projects/fetch-profiles",
  asyncHandler(async (req, res) => {
    const body = fetchProfilesBody.parse(req.body ?? {});
    const result = await fetchAndUpdateProjectProfiles({
      ...(body.ids ? { ids: body.ids } : {}),
      missingBioOnly: body.missingBioOnly ?? !(body.ids && body.ids.length > 0),
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
      reclassify: body.reclassify ?? true,
    });
    res.json({ ok: true, ...result });
  }),
);

/** Single project: getUsersByIds([id]) → fill bio. */
tagsListsRouter.post(
  "/projects/:id/fetch-profile",
  asyncHandler(async (req, res) => {
    const idRaw = req.params.id;
    const id = Array.isArray(idRaw) ? idRaw[0]! : idRaw!;
    const exists = await prisma.twitterAccount.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new HttpError(404, "project_not_found");

    const reclassify =
      req.body && typeof req.body === "object" && "reclassify" in req.body
        ? Boolean((req.body as { reclassify?: boolean }).reclassify)
        : true;

    const result = await fetchAndUpdateProjectProfiles({
      ids: [id],
      missingBioOnly: false,
      reclassify,
    });
    if (result.updated === 0) {
      throw new HttpError(
        502,
        result.errors[0] ?? "user_not_found_or_fetch_failed",
      );
    }
    res.json({ ok: true, ...result, item: result.items[0] ?? null });
  }),
);

// Remove a project (twitter_accounts row). Cascades list_members / alerts / follow edges.
// Best-effort: try remove from Twitter lists using each list's owner auth.
tagsListsRouter.delete(
  "/projects/:id",
  asyncHandler(async (req, res) => {
    const idRaw = req.params.id;
    const id = Array.isArray(idRaw) ? idRaw[0]! : idRaw!;
    const account = await prisma.twitterAccount.findUnique({
      where: { id },
      select: { id: true, username: true },
    });
    if (!account) throw new HttpError(404, "project_not_found");

    const memberships = await prisma.listMember.findMany({
      where: { accountId: id },
      include: {
        list: { select: { twitterListId: true, authAccountId: true, slug: true } },
      },
    });

    if (memberships.length > 0) {
      const { getListClient } = await import("../twitter/getClient.js");
      for (const m of memberships) {
        try {
          const { client } = await getListClient(m.list.authAccountId);
          await client.removeListMember(m.list.twitterListId, id);
        } catch (err) {
          console.warn(
            `[api] remove ${account.username} from list ${m.list.slug} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    await prisma.twitterAccount.delete({ where: { id } });
    res.json({ deleted: true, id, username: account.username });
  }),
);

tagsListsRouter.get(
  "/lists",
  asyncHandler(async (_req, res) => {
    const lists = await prisma.projectList.findMany({
      orderBy: { slug: "asc" },
      include: {
        _count: { select: { members: true } },
        authAccount: { select: { id: true, username: true } },
      },
    });
    res.json({
      items: jsonSafe(
        lists.map((l) => ({
          slug: l.slug,
          name: l.name,
          twitterListId: l.twitterListId,
          memberCount: l._count.members,
          lastPolledAt: l.lastPolledAt,
          lastTweetId: l.lastTweetId,
          authAccountId: l.authAccountId?.toString() ?? null,
          authUsername: l.authAccount?.username ?? null,
        })),
      ),
    });
  }),
);

const createListBody = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case"),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(100).optional(),
  /** Twitter auth-pool account that will own the list (required). */
  authAccountId: z.string().min(1),
});

tagsListsRouter.post(
  "/lists",
  asyncHandler(async (req, res) => {
    const body = createListBody.parse(req.body);
    let authAccountId: bigint;
    try {
      authAccountId = BigInt(body.authAccountId);
    } catch {
      throw new HttpError(400, "invalid_auth_account_id");
    }

    const auth = await prisma.twitterAuthAccount.findFirst({
      where: { id: authAccountId, isActive: true },
    });
    if (!auth) throw new HttpError(400, "auth_account_not_found_or_inactive");

    try {
      const item = await createProjectList({
        slug: body.slug,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        authAccountId,
      });
      res.status(201).json({ item: jsonSafe(item) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "list_slug_exists") throw new HttpError(409, "list_slug_exists");
      if (msg.includes("not found or inactive")) throw new HttpError(400, msg);
      throw new HttpError(502, msg);
    }
  }),
);

tagsListsRouter.get(
  "/lists/:slug/members",
  asyncHandler(async (req, res) => {
    const q = paginationSchema.parse(req.query);
    const slugRaw = req.params.slug;
    const slug = Array.isArray(slugRaw) ? slugRaw[0]! : slugRaw!;
    const [items, total] = await Promise.all([
      prisma.listMember.findMany({
        where: { listSlug: slug },
        orderBy: { addedAt: "desc" },
        take: q.limit,
        skip: q.offset,
        include: {
          account: {
            select: { id: true, username: true, name: true, tags: true, followersCount: true },
          },
        },
      }),
      prisma.listMember.count({ where: { listSlug: slug } }),
    ]);
    res.json({ total, limit: q.limit, offset: q.offset, items: jsonSafe(items) });
  }),
);

// ── Actions (enqueue) ──

const reclassifyBody = z.object({
  accountId: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
});

// Set tags immediately in DB (admin UI must see the change on refresh). List
// reconciliation is best-effort via the queue — Redis/worker issues must not
// roll back the tag write.
tagsListsRouter.post(
  "/reclassify",
  asyncHandler(async (req, res) => {
    const body = reclassifyBody.parse(req.body);
    const updated = await setAccountTags(body.accountId, body.tags, null);
    if (!updated) throw new HttpError(404, "account_not_found");

    let enqueued = false;
    let jobId: string | undefined;
    try {
      const result = await enqueueJob("reclassify", {
        accountId: body.accountId,
        tags: updated.tags,
      });
      enqueued = true;
      jobId = result.jobId;
    } catch (err) {
      console.warn(
        "[api] reclassify: tags saved but enqueue failed:",
        err instanceof Error ? err.message : err,
      );
    }

    res.status(200).json({
      ok: true,
      tags: updated.tags,
      enqueued,
      jobId: jobId ?? null,
    });
  }),
);

tagsListsRouter.post(
  "/reconcile",
  asyncHandler(async (_req, res) => {
    const result = await enqueueJob("reconcile-lists", {});
    res.status(202).json({ enqueued: true, ...result });
  }),
);

const deleteBody = z.object({ all: z.boolean().default(false) });

// Bulk wipe (async job) — keep before /lists/:slug so "delete" is not a slug.
tagsListsRouter.post(
  "/lists/delete",
  asyncHandler(async (req, res) => {
    const body = deleteBody.parse(req.body ?? {});
    const result = await enqueueJob("list-delete", body);
    res.status(202).json({ enqueued: true, ...result });
  }),
);

// Delete one list (Twitter + DB) immediately under its owner auth account.
tagsListsRouter.delete(
  "/lists/:slug",
  asyncHandler(async (req, res) => {
    const slugRaw = req.params.slug;
    const slug = Array.isArray(slugRaw) ? slugRaw[0]! : slugRaw!;
    try {
      const result = await deleteProjectList(slug);
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "list_not_found") throw new HttpError(404, "list_not_found");
      if (msg.includes("not found or inactive")) throw new HttpError(400, msg);
      throw new HttpError(502, msg);
    }
  }),
);
