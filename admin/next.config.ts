import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Keep Turbopack rooted on admin/ so it doesn't walk the monorepo parent
  // (which confuses Tailwind content detection and emits bad CSS selectors).
  turbopack: {
    root,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["admin.dipu.app", "localhost:4000"],
    },
  },
  // Do NOT rewrite /api/* to the Express backend.
  // Admin is a BFF: /api/login, /api/logout, and /api/proxy/[...path] are
  // Next.js route handlers. A catch-all rewrite to Express wins over the
  // dynamic /api/proxy/[...path] handler (afterFiles rewrites run before
  // dynamic routes) and returns 401 because the browser has no API key.
};

export default nextConfig;
