// Users router — CRUD over AdminUser. Passwords are always hashed; hashes are
// never returned. Role enforcement (admin-only) is applied by the Next proxy.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { hashPassword } from "../hash.js";

export const usersRouter: Router = Router();

const ROLES = ["admin", "editor", "viewer"] as const;

function view(u: { id: bigint; email: string; role: string; isActive: boolean; createdAt: Date }) {
  return {
    id: u.id.toString(),
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
  };
}

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await prisma.adminUser.findMany({ orderBy: { id: "asc" } });
    res.json({ items: users.map(view) });
  }),
);

const createBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES).default("viewer"),
});

usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createBody.parse(req.body);
    const existing = await prisma.adminUser.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    if (existing) throw new HttpError(409, "email_exists");
    const user = await prisma.adminUser.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
        role: body.role,
      },
    });
    res.status(201).json(view(user));
  }),
);

const patchBody = z.object({
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

usersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const body = patchBody.parse(req.body);
    const data: Record<string, unknown> = {};
    if (body.role !== undefined) data.role = body.role;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.password !== undefined) data.passwordHash = await hashPassword(body.password);
    const user = await prisma.adminUser.update({ where: { id }, data }).catch(() => null);
    if (!user) throw new HttpError(404, "user_not_found");
    res.json(view(user));
  }),
);

usersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseBigId(req.params.id);
    const deleted = await prisma.adminUser.delete({ where: { id } }).catch(() => null);
    if (!deleted) throw new HttpError(404, "user_not_found");
    res.json({ ok: true });
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
