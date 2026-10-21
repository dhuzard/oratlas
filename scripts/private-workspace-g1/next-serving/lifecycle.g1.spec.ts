import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { captureNextServing, requestServingResponse } from "./capture.js";
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
      "console.log(process.env.DATABASE_URL); console.log(new URL(process.env.DATABASE_URL).password); setInterval(() => {}, 1000);\n",
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
    const log = readFileSync(join(root, "capture.json.server.log"), "utf8");
    expect(log).toContain("[redacted]");
    expect(log).not.toContain("synthetic");
    expect(log).not.toContain("oratlas_g1_public_probe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

it("refuses unbounded or invalid readiness budgets before spawning", async () => {
  for (const readyTimeoutMs of [Infinity, NaN, 0, -1, 30_001])
    await expect(
      startNextServer({
        root: "/unused",
        node: process.execPath,
        databaseUrl: "unused",
        output: "/unused",
        port: 32572,
        readyTimeoutMs,
      }),
    ).rejects.toThrow("Readiness timeout");
});

it("ends a continuously trickling response at an absolute deadline and closes its socket", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200);
    const timer = setInterval(() => response.write("x"), 10);
    response.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected loopback address");
  const start = performance.now();
  try {
    await expect(requestServingResponse(address.port, "/", undefined, start + 150)).rejects.toThrow(
      "Serving response deadline exceeded",
    );
    expect(performance.now() - start).toBeLessThan(2_000);
  } finally {
    await new Promise<void>((done, fail) =>
      server.close((error) => (error ? fail(error) : done())),
    );
  }
}, 5_000);

it("includes readiness and trickling bodies in the total capture budget, then stops the server", async () => {
  const root = mkdtempSync(join(tmpdir(), "g1-next-total-"));
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
      `
      const server = require('node:http').createServer((_req, res) => {
        res.writeHead(200); const timer = setInterval(() => res.write('x'), 10);
        res.on('close', () => clearInterval(timer));
      });
      server.listen(Number(process.argv.at(-1)), '127.0.0.1', () => console.log('Ready in synthetic'));
    `,
    );
    copyFileSync(
      resolve("scripts/private-workspace-g1/next-serving/clock.mjs"),
      join(root, "scripts/private-workspace-g1/next-serving/clock.mjs"),
    );
    const start = performance.now();
    await expect(
      captureNextServing({
        root,
        node: process.execPath,
        databaseUrl:
          "postgresql://oratlas_g1_public_probe:synthetic@127.0.0.1:55465/oratlas_g1_probe",
        output: join(root, "capture.json"),
        port: 32572,
        buildId: "synthetic-lifecycle",
        sign: () => "synthetic",
        captureTimeoutMs: 500,
      }),
    ).rejects.toThrow("deadline exceeded");
    expect(performance.now() - start).toBeLessThan(3_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
