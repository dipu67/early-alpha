// Auth router — email/password login against AdminUser (bcrypt). The backend is
// key-trusted; role enforcement happens in the Next proxy. This just verifies
// credentials and returns the user's identity + role for the session.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { hashPassword, verifyPassword } from "../hash.js";

export const authRouter: Router = Router();

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginBody.parse(req.body);
    const user = await prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(401, "invalid_credentials");
    }
    res.json({ id: user.id.toString(), email: user.email, role: user.role });
  }),
);

const changePwBody = z.object({
  userId: z.string().min(1),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post(
  "/change-password",
  asyncHandler(async (req, res) => {
    const body = changePwBody.parse(req.body);
    const id = BigInt(body.userId);
    const user = await prisma.adminUser.findUnique({ where: { id } });
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new HttpError(401, "invalid_credentials");
    }
    await prisma.adminUser.update({
      where: { id },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });
    res.json({ ok: true });
  }),
);
