// Auth account pool router — manage the Twitter scraping credentials.
// Tokens are ALWAYS masked in responses; they are never returned in full.
//
//   GET    /auth-accounts            -> pool status (masked), rate-limit state
//   POST   /auth-accounts            -> body: { authToken, ct0 } only
//                                       validates via TwitterClient.getCurrentUser
//                                       then upserts twitter_auth_accounts
//   PATCH  /auth-accounts/:id        -> activate / deactivate
//   DELETE /auth-accounts/:id        -> remove one credential
//   DELETE /auth-accounts            -> wipe entire pool (dead cookies etc.)

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
import { TwitterClient } from "../TwitterClient/index.js";

export const authPoolRouter: Router = Router();

/** Show only the last 4 chars of a secret. */
function mask(secret: string): string {
  if (secret.length <= 4) return "****";
  return `****${secret.slice(-4)}`;
}

authPoolRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const accounts = await prisma.twitterAuthAccount.findMany({
      orderBy: { id: "asc" },
    });
    const now = Date.now();
    res.json({
      items: jsonSafe(
        accounts.map((a) => ({
          id: a.id,
          username: a.username,
          authToken: mask(a.authToken),
          ct0: mask(a.ct0),
          isActive: a.isActive,
          rateLimited: a.rateLimitedUntil
            ? a.rateLimitedUntil.getTime() > now
            : false,
          rateLimitedUntil: a.rateLimitedUntil,
          lastUsedAt: a.lastUsedAt,
        })),
      ),
    });
  }),
);

/** Only cookies — id + username resolved from Twitter after validation. */
const addBody = z.object({
  authToken: z.string().min(10),
  ct0: z.string().min(10),
  isActive: z.boolean().optional().default(true),
});

authPoolRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = addBody.parse(req.body ?? {});
    const authToken = body.authToken.trim();
    const ct0 = body.ct0.trim();
    if (!authToken || !ct0) {
      throw new HttpError(400, "auth_token_and_ct0_required");
    }

    // Validate cookies with Twitter before writing to DB
    const client = new TwitterClient({
      cookies: { authToken, ct0 },
    });
    let me = await client.getCurrentUser();

    // settings.json often returns screen_name without user id — resolve via GraphQL
    if (
      me.success &&
      me.user?.username &&
      (!me.user.id || !/^\d+$/.test(me.user.id))
    ) {
      const byName = await client.getUserByScreenName(me.user.username);
      if (byName.success && byName.user?.id) {
        me = {
          success: true,
          user: {
            id: byName.user.id,
            username: byName.user.username,
            name: byName.user.name || byName.user.username,
          },
        };
      }
    }

    if (!me.success || !me.user?.id || !me.user.username) {
      throw new HttpError(
        400,
        me.error
          ? `invalid_cookies: ${me.error.slice(0, 180)}`
          : "invalid_cookies: getCurrentUser failed",
      );
    }

    const id = parseBigId(me.user.id);
    const username = me.user.username.replace(/^@/, "").toLowerCase();

    const row = await prisma.twitterAuthAccount.upsert({
      where: { id },
      create: {
        id,
        username,
        authToken,
        ct0,
        isActive: body.isActive ?? true,
        rateLimitedUntil: null,
      },
      update: {
        username,
        authToken,
        ct0,
        isActive: body.isActive ?? true,
        // Fresh cookies clear rate-limit / dead-auth pause
        rateLimitedUntil: null,
      },
    });

    res.status(201).json({
      id: row.id.toString(),
      username: row.username,
      isActive: row.isActive,
      name: me.user.name ?? row.username,
      validated: true,
    });
  }),
);

/** Wipe entire auth pool (e.g. all cookies expired with Twitter code 32). */
authPoolRouter.delete(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await prisma.twitterAuthAccount.deleteMany({});
    res.json({ ok: true, deleted: result.count });
  }),
);

const patchBody = z.object({ isActive: z.boolean() });

authPoolRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const body = patchBody.parse(req.body);
    // Activating clears soft auth-pause so the account can be tried again.
    const data = body.isActive
      ? { isActive: true, rateLimitedUntil: null as Date | null }
      : { isActive: false };
    const row = await prisma.twitterAuthAccount
      .update({ where: { id }, data })
      .catch(() => null);
    if (!row) throw new HttpError(404, "auth account not found");
    res.json({
      id: row.id.toString(),
      username: row.username,
      isActive: row.isActive,
      rateLimitedUntil: row.rateLimitedUntil,
    });
  }),
);

authPoolRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const row = await prisma.twitterAuthAccount
      .delete({ where: { id } })
      .catch(() => null);
    if (!row) throw new HttpError(404, "auth account not found");
    res.json({ ok: true, id: row.id.toString(), username: row.username });
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
