// Live Twitter list management — all ops go through TwitterClient, not ProjectList DB.
//
//   GET    /twitter-lists                         inventory via getMyLists (all auths)
//   POST   /twitter-lists                         createList under auth
//   DELETE /twitter-lists/:listId                 deleteList under auth
//   GET    /twitter-lists/:listId/members         getListMembers (paginated)
//   POST   /twitter-lists/:listId/members         addListMember
//   DELETE /twitter-lists/:listId/members/:userId removeListMember

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
import { getListClient, markRateLimited } from "../twitter/getClient.js";
import { scanAllAuthLists } from "../services/authListsScan.js";
import { isListDailyAddLimitError } from "../services/projectLists.js";
import { markRateLimitedUntil, nextUtcDayReset } from "../twitter/getClient.js";

export const twitterListsRouter: Router = Router();

function parseAuthId(raw: unknown): bigint {
  if (raw == null || raw === "") throw new HttpError(400, "auth_account_id_required");
  try {
    return BigInt(String(raw));
  } catch {
    throw new HttpError(400, "invalid_auth_account_id");
  }
}

/** GET / — live getMyLists across auth pool. */
twitterListsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        activeOnly: z
          .enum(["true", "false", "1", "0"])
          .optional()
          .transform((v) => v !== "false" && v !== "0"),
      })
      .parse(req.query);

    const result = await scanAllAuthLists({
      activeOnly: q.activeOnly ?? true,
      count: 100,
    });

    // Flat table rows: one row per (auth, list)
    const items = result.items.flatMap((auth) =>
      auth.lists.map((l) => ({
        listId: l.id,
        name: l.name,
        description: l.description ?? null,
        memberCount: l.memberCount ?? null,
        subscriberCount: l.subscriberCount ?? null,
        isPrivate: l.isPrivate ?? false,
        authAccountId: auth.authAccountId,
        authUsername: auth.username,
        authOk: auth.ok,
        authError: auth.error ?? null,
        projectSlug: l.projectSlug,
        listUrl: `https://x.com/i/lists/${l.id}`,
      })),
    );

    res.json(
      jsonSafe({
        scannedAt: result.scannedAt,
        authCount: result.authCount,
        listCount: result.listCount,
        items,
        byAuth: result.items,
      }),
    );
  }),
);

const createBody = z.object({
  authAccountId: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(100).optional(),
  isPrivate: z.boolean().optional().default(false),
});

/** POST / — createList on Twitter under chosen auth. */
twitterListsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createBody.parse(req.body);
    const authAccountId = parseAuthId(body.authAccountId);

    const { client, accountId, username } = await getListClient(authAccountId);
    const result = await client.createList(
      body.name.trim(),
      (body.description ?? "").trim(),
      body.isPrivate ?? false,
    );
    if (result.rateLimit && result.rateLimit.remaining === 0) {
      await markRateLimited(accountId, result.rateLimit.reset);
    }
    if (!result.success || !result.list) {
      throw new HttpError(502, result.error ?? "createList_failed");
    }

    res.status(201).json(
      jsonSafe({
        ok: true,
        item: {
          listId: result.list.id,
          name: result.list.name,
          description: result.list.description ?? null,
          memberCount: result.list.memberCount ?? 0,
          isPrivate: result.list.isPrivate ?? false,
          authAccountId: accountId.toString(),
          authUsername: username,
          listUrl: `https://x.com/i/lists/${result.list.id}`,
        },
      }),
    );
  }),
);

/** DELETE /:listId — deleteList on Twitter (must pass owner auth). */
twitterListsRouter.delete(
  "/:listId",
  asyncHandler(async (req, res) => {
    const listId = String(req.params.listId ?? "");
    if (!/^\d{5,30}$/.test(listId)) throw new HttpError(400, "invalid_list_id");

    const authAccountId = parseAuthId(
      req.query.authAccountId ?? (req.body as { authAccountId?: string })?.authAccountId,
    );

    const { client, accountId } = await getListClient(authAccountId);
    const result = await client.deleteList(listId);
    if (result.rateLimit && result.rateLimit.remaining === 0) {
      await markRateLimited(accountId, result.rateLimit.reset);
    }
    if (!result.success) {
      const err = (result.error ?? "").toLowerCase();
      const gone =
        err.includes("not found") ||
        err.includes("does not exist") ||
        err.includes("couldn't find");
      if (!gone) throw new HttpError(502, result.error ?? "deleteList_failed");
    }

    // Best-effort: drop ProjectList mirror if present (worker uses that table).
    await prisma.projectList
      .deleteMany({ where: { twitterListId: listId } })
      .catch(() => undefined);

    res.json({
      ok: true,
      listId,
      twitterDeleted: result.success,
    });
  }),
);

/** GET /:listId/members — getListMembers via Twitter. */
twitterListsRouter.get(
  "/:listId/members",
  asyncHandler(async (req, res) => {
    const listId = String(req.params.listId ?? "");
    if (!/^\d{5,30}$/.test(listId)) throw new HttpError(400, "invalid_list_id");

    const q = z
      .object({
        authAccountId: z.string().min(1),
        count: z.coerce.number().int().min(1).max(100).optional().default(40),
        cursor: z.string().optional(),
      })
      .parse(req.query);

    const authAccountId = parseAuthId(q.authAccountId);
    const { client, accountId } = await getListClient(authAccountId);

    const result = await client.getListMembers(listId, q.count, {
      ...(q.cursor ? { cursor: q.cursor } : {}),
    });
    if (result.rateLimit && result.rateLimit.remaining === 0) {
      await markRateLimited(accountId, result.rateLimit.reset);
    }
    if (!result.success) {
      throw new HttpError(502, result.error ?? "getListMembers_failed");
    }

    const users = result.users ?? [];
    res.json(
      jsonSafe({
        listId,
        count: users.length,
        nextCursor: result.nextCursor ?? null,
        items: users.map((u) => ({
          userId: u.id,
          username: u.username,
          name: u.name,
          description: u.description ?? null,
          followersCount: u.followersCount ?? null,
          followingCount: u.followingCount ?? null,
          isBlueVerified: u.isBlueVerified ?? null,
          profileImageUrl: u.profileImageUrl ?? null,
        })),
      }),
    );
  }),
);

const addMemberBody = z
  .object({
    authAccountId: z.string().min(1),
    username: z.string().min(1).max(40).optional(),
    userId: z.string().min(1).max(40).optional(),
  })
  .refine((b) => Boolean(b.username?.trim() || b.userId?.trim()), {
    message: "username_or_user_id_required",
  });

/** POST /:listId/members — resolve user + addListMember. */
twitterListsRouter.post(
  "/:listId/members",
  asyncHandler(async (req, res) => {
    const listId = String(req.params.listId ?? "");
    if (!/^\d{5,30}$/.test(listId)) throw new HttpError(400, "invalid_list_id");

    const body = addMemberBody.parse(req.body ?? {});
    const authAccountId = parseAuthId(body.authAccountId);
    const { client, accountId } = await getListClient(authAccountId);

    let userId = body.userId?.trim() ?? "";
    let username = body.username?.trim().replace(/^@/, "") ?? "";
    let name = username;

    if (username) {
      const ures = await client.getUserByScreenName(username);
      if (ures.rateLimit && ures.rateLimit.remaining === 0) {
        await markRateLimited(accountId, ures.rateLimit.reset);
      }
      if (!ures.success || !ures.user) {
        throw new HttpError(404, ures.error ?? "user_not_found");
      }
      userId = ures.user.id;
      username = ures.user.username;
      name = ures.user.name ?? username;
    }

    if (!userId) throw new HttpError(400, "username_or_user_id_required");

    const result = await client.addListMember(listId, userId);
    if (result.rateLimit && result.rateLimit.remaining === 0) {
      await markRateLimited(accountId, result.rateLimit.reset);
    }
    if (!result.success) {
      if (isListDailyAddLimitError(result.error)) {
        await markRateLimitedUntil(accountId, nextUtcDayReset());
        throw new HttpError(429, "list_daily_add_limit");
      }
      throw new HttpError(502, result.error ?? "addListMember_failed");
    }

    res.status(201).json({
      ok: true,
      listId,
      userId,
      username: username || userId,
      name: name || username || userId,
    });
  }),
);

/** DELETE /:listId/members/:userId — removeListMember. */
twitterListsRouter.delete(
  "/:listId/members/:userId",
  asyncHandler(async (req, res) => {
    const listId = String(req.params.listId ?? "");
    const userId = String(req.params.userId ?? "");
    if (!/^\d{5,30}$/.test(listId)) throw new HttpError(400, "invalid_list_id");
    if (!userId) throw new HttpError(400, "invalid_user_id");

    const authAccountId = parseAuthId(
      req.query.authAccountId ?? (req.body as { authAccountId?: string })?.authAccountId,
    );

    const { client, accountId } = await getListClient(authAccountId);
    const result = await client.removeListMember(listId, userId);
    if (result.rateLimit && result.rateLimit.remaining === 0) {
      await markRateLimited(accountId, result.rateLimit.reset);
    }
    if (!result.success) {
      const err = (result.error ?? "").toLowerCase();
      const gone =
        err.includes("not found") ||
        err.includes("not a member") ||
        err.includes("does not exist");
      if (!gone) throw new HttpError(502, result.error ?? "removeListMember_failed");
    }

    // Best-effort local mirror cleanup
    await prisma.listMember
      .deleteMany({ where: { accountId: userId, list: { twitterListId: listId } } })
      .catch(() => undefined);

    res.json({ ok: true, listId, userId, twitterRemoved: result.success });
  }),
);
