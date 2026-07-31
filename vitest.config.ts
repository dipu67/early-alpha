import { defineConfig } from "vitest/config";

// Without this config vitest falls back to its default include glob, which does
// not exclude `admin/` — any test added there would get pulled into the backend
// run. Scope it to the backend explicitly.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
