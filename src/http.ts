// Shared helpers for routes: pagination parsing, "since" windows, and making
// Prisma rows JSON-safe (BigInt and Date don't serialize natively).

import { z } from "zod";

/** ?limit= & ?offset= with sane caps. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Parse a "since" value: an ISO date, or a shorthand like "24h", "7d", "30m".
 * Returns a Date, or undefined if not provided/parseable.
 */
export function parseSince(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const m = /^(\d+)\s*([mhd])$/.exec(raw.trim());
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const ms = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return new Date(Date.now() - n * ms);
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Recursively convert BigInt -> string so `res.json()` never throws on the
 * BigInt ids these models use. Dates are left to JSON's native ISO encoding.
 */
export function jsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]),
    );
  }
  return value;
}
