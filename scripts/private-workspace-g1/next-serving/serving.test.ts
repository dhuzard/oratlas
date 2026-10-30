import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { captureHttp, G1_FIXED_CLOCK } from "../capture.js";
import { NO_SESSION } from "../principals.js";
import { nextServingEnvironment } from "./environment.js";
import { servingDifferences, type ServingCapture } from "./capture.js";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
const database = "postgresql://oratlas_g1_public_probe:synthetic@127.0.0.1:55465/oratlas_g1_probe";
const directory = () => {
  const root = mkdtempSync(join(tmpdir(), "oratlas-serving-"));
  temporary.push(root);
  return root;
};

it("uses a closed serving environment rather than copying parent credentials", () => {
  const root = directory();
  const env = nextServingEnvironment(database, root, join(root, "capture.json"));
  expect(Object.keys(env).sort()).toEqual(
    [
      "DATABASE_URL",
      "G1_NEXT_CAPTURE_OUT",
      "NEXT_PUBLIC_BASE_URL",
      "NEXT_TELEMETRY_DISABLED",
      "NODE_ENV",
      "NODE_OPTIONS",
      "RATE_LIMIT_MAX",
      "RATE_LIMIT_WINDOW_MS",
      "SESSION_SECRET",
    ].sort(),
  );
  expect(env.NODE_ENV).toBe("production");
  expect(env.NEXT_TELEMETRY_DISABLED).toBe("1");
  expect(() =>
    nextServingEnvironment(
      database.replace("oratlas_g1_public_probe", "bootstrap"),
      root,
      join(root, "capture.json"),
    ),
  ).toThrow();
});

it("refuses dotenv files that Next would otherwise load after environment validation", () => {
  const root = directory();
  mkdirSync(join(root, "apps/web"), { recursive: true });
  writeFileSync(join(root, "apps/web/.env.production.local"), "GITHUB_TOKEN=synthetic\n");
  expect(() => nextServingEnvironment(database, root, join(root, "capture.json"))).toThrow(
    /dotenv/u,
  );
});

it("freezes Date only while retaining explicit dates and real UUID entropy and refusing outbound HTTP", () => {
  const result = execFileSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(resolve("scripts/private-workspace-g1/next-serving/clock.mjs")).href,
      "-e",
      `
    const assert = require('node:assert/strict');
    const crypto = require('node:crypto');
    assert.equal(new Date().toISOString(), '${G1_FIXED_CLOCK}');
    assert.equal(Date.now(), Date.parse('${G1_FIXED_CLOCK}'));
    assert.equal(new Date('2000-01-01T00:00:00Z').getUTCFullYear(), 2000);
    assert.notEqual(crypto.randomUUID(), crypto.randomUUID());
    assert.throws(() => require('node:https').get('https://example.org/'));
    process.stdout.write('ok');
  `,
    ],
    { env: { NODE_ENV: "test" }, encoding: "utf8" },
  );
  expect(result).toBe("ok");
});

it("never normalizes body bytes or CSP/link nonces, and permits only the existing header allowlist", async () => {
  const request = {
    id: "metadata",
    method: "GET" as const,
    path: "/robots.txt",
    headers: {},
    body: null,
    principal: "anonymous" as const,
    sessionCase: "none" as const,
    session: NO_SESSION,
    cookieSha256: null,
  };
  const record = await captureHttp(
    request,
    new Response("exact bytes", {
      headers: { date: "first", "content-security-policy": "nonce-first" },
    }),
  );
  const first: ServingCapture = {
    protocol: "oratlas.g1.next-http/0.1",
    clock: G1_FIXED_CLOCK,
    buildId: "synthetic-build",
    records: [record],
  };
  const changedDate: ServingCapture = {
    ...first,
    records: [
      {
        ...record,
        headers: [
          ["content-security-policy", "nonce-first"],
          ["content-type", "text/plain;charset=UTF-8"],
          ["date", "second"],
        ],
      },
    ],
  };
  expect(servingDifferences(first, changedDate)).toEqual([]);
  const changedBody: ServingCapture = {
    ...first,
    records: [{ ...record, bodyBase64: Buffer.from("changed bytes").toString("base64") }],
  };
  expect(servingDifferences(first, changedBody)).toContain("metadata: body/status");
  const changedPolicy: ServingCapture = {
    ...first,
    records: [{ ...record, headers: [["content-security-policy", "nonce-second"]] }],
  };
  expect(servingDifferences(first, changedPolicy)).toContain("metadata: headers/cookies");
});
