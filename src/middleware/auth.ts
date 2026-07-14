// API-key auth — every route requires the shared secret, sent as either
//   Authorization: Bearer <key>   or   x-api-key: <key>
// Compared in constant time so the check can't be timing-probed.

import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function extractKey(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const apiKey = req.header("x-api-key");
  return apiKey?.trim() || undefined;
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = extractKey(req);
  if (!key || !safeEqual(key, env.adminApiKey)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
