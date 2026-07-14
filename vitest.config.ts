import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(process.cwd(), "apps/web/src") },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
  },
});
