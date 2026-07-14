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
};

export default nextConfig;
