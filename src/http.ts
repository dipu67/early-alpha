// Shared helpers for routes: pagination parsing and making Prisma rows
// JSON-safe (BigInt and Date don't serialize natively).

import { z } from "zod";

/** ?limit= & ?offset= with sane caps. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

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
