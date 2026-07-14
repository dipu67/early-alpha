// Environment config — loaded once, validated at startup so a missing var fails
// fast instead of at first request.

import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  /** Postgres connection — the SAME database early-alpha uses. */
  databaseUrl: required("DATABASE_URL"),
  /** Redis connection — the SAME instance BullMQ uses. */
  redisUrl: required("REDIS_URL"),
  /** Shared secret required on every request (x-api-key or Bearer). */
  adminApiKey: required("ADMIN_API_KEY"),
  /** Port to listen on. */
  port: Number(process.env.PORT ?? 4000),
} as const;
