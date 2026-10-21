import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { startNextServer } from "./process.js";

it("bounds readiness and quiesces an owned synthetic child that never becomes ready", async () => {
  const root = mkdtempSync(join(tmpdir(), "g1-next-lifecycle-"));
  try {
    for (const path of [
      "apps/web/.next",
      "apps/web/node_modules/next/dist/bin",
      "scripts/private-workspace-g1/next-serving",
    ])
      mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, "apps/web/.next/BUILD_ID"), "synthetic-lifecycle");
    writeFileSync(
      join(root, "apps/web/node_modules/next/dist/bin/next"),
      "setInterval(() => {}, 1000);\n",
    );
    copyFileSync(
      resolve("scripts/private-workspace-g1/next-serving/clock.mjs"),
      join(root, "scripts/private-workspace-g1/next-serving/clock.mjs"),
    );
    await expect(
      startNextServer({
        root,
        node: process.execPath,
        databaseUrl:
          "postgresql://oratlas_g1_public_probe:synthetic@127.0.0.1:55465/oratlas_g1_probe",
        output: join(root, "capture.json"),
        port: 32572,
        readyTimeoutMs: 150,
      }),
    ).rejects.toThrow("readiness deadline");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
