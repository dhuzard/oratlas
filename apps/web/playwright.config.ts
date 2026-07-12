import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { resolveE2EDatabaseUrl } from "./src/lib/e2e-database-url";

const here = dirname(fileURLToPath(import.meta.url));

// Prefer an explicitly configured browser, then a pre-installed Chromium (as in
// this sandbox), otherwise fall back to Playwright's managed browser (CI).
const PRESET_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM || (existsSync(PRESET_CHROMIUM) ? PRESET_CHROMIUM : undefined);
const PORT = process.env.E2E_PORT ?? "3100";
// Absolute SQLite path so it resolves regardless of the server's working dir.
const DB = resolveE2EDatabaseUrl(
  {
    E2E_DATABASE_URL: process.env.E2E_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  },
  `file:${join(here, "..", "..", "packages", "db", "prisma", "dev.db")}`,
);

/**
 * Essential end-to-end tests (spec §21, §22). The web server is started against
 * the seeded SQLite database with mock auth enabled. No external network calls.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
      },
    },
  ],
  // Dev server so the development-only mock sign-in (AUTH_MOCK=1) is available;
  // it is refused under NODE_ENV=production by design.
  webServer: {
    command: `pnpm dev -p ${PORT}`,
    port: Number(PORT),
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: DB,
      SESSION_SECRET: "e2e-session-secret",
      AUTH_MOCK: "1",
    },
  },
});
