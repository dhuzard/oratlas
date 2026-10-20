import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Dedicated config for the real-PostgreSQL G1 suites. It deliberately does not extend the root
// config: only `*.g1.spec.ts` files are discovered here, and the root `pnpm test` (which includes
// `scripts/**/*.test.ts`) never discovers them, so offline runs cannot contact a database.
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");

export default defineConfig({
  root: repositoryRoot,
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: /^@\//u, replacement: `${resolve(repositoryRoot, "apps/web/src")}/` },
      // Only the `server-only` marker is replaced (it throws outside an RSC bundle).
      { find: /^server-only$/u, replacement: resolve(here, "fixtures/server-only-stub.ts") },
    ],
  },
  test: {
    include: ["scripts/private-workspace-g1/**/*.g1.spec.ts"],
    // Installs node:async_hooks AsyncLocalStorage on globalThis before any Next module loads, so
    // Next's request/work storages are real (next-request-context.ts verifies this).
    setupFiles: [resolve(here, "setup-async-local-storage.ts")],
    environment: "node",
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
