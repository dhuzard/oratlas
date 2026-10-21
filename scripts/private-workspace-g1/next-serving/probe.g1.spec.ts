import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { createSessionToken } from "../../../apps/web/src/lib/session-token";
import { captureNextServing, servingDifferences } from "./capture.js";

// Explicit opt-in prototype: not part of existing G1 orchestrator, no DB setup or mutation here.
it("proves exact metadata serving and records blocked HTML variance without changing body bytes", async () => {
  const urlFile = process.env.G1_NEXT_PROBE_URL_FILE;
  const output = process.env.G1_NEXT_PROBE_OUTPUT;
  if (!urlFile || !output)
    throw new Error("Explicit synthetic target URL file and output directory required");
  const root = process.cwd();
  const buildId = readFileSync(resolve(root, "apps/web/.next/BUILD_ID"), "utf8").trim();
  const databaseUrl = readFileSync(urlFile, "utf8").trim();
  const input = {
    root,
    node: process.execPath,
    databaseUrl,
    port: 32571,
    output: resolve(output, "capture.json"),
    buildId,
    sign: createSessionToken,
  };
  const first = await captureNextServing({ ...input, output: resolve(output, "first.json") });
  writeFileSync(resolve(output, "first.json"), `${JSON.stringify(first, null, 2)}\n`, {
    mode: 0o600,
  });
  const second = await captureNextServing({ ...input, output: resolve(output, "second.json") });
  writeFileSync(resolve(output, "second.json"), `${JSON.stringify(second, null, 2)}\n`, {
    mode: 0o600,
  });
  const differences = servingDifferences(first, second);
  writeFileSync(resolve(output, "differences.json"), `${JSON.stringify(differences, null, 2)}\n`, {
    mode: 0o600,
  });
  expect(first.records).toHaveLength(30);
  const metadataPaths = new Set(["/robots.txt", "/sitemap.xml", "/llms.txt"]);
  const metadata = (capture: typeof first) => ({
    ...capture,
    records: capture.records.filter((record) => metadataPaths.has(record.request.path)),
  });
  expect(metadata(first).records).toHaveLength(18);
  expect(servingDifferences(metadata(first), metadata(second))).toEqual([]);
  for (const record of first.records) {
    const body = Buffer.from(record.bodyBase64, "base64").toString("utf8");
    if (record.request.path === "/sitemap.xml") {
      expect(body).toContain("g1-fixture-review");
      expect(body).not.toContain("g1-control-review");
    }
    if (record.request.path === "/robots.txt")
      expect(body).toContain("https://g1.oratlas.example/sitemap.xml");
    if (record.request.path === "/llms.txt") expect(body).toContain("ORAtlas");
    if (!metadataPaths.has(record.request.path)) {
      const policy = record.headers.find(([name]) => name === "content-security-policy")?.[1];
      const nonce = policy?.match(/'nonce-([a-f0-9]{32})'/u)?.[1];
      expect(nonce).toBeDefined();
      expect(body).toContain(`nonce="${nonce}"`);
      const other = second.records.find((candidate) => candidate.id === record.id)!;
      expect(other.headers.find(([name]) => name === "content-security-policy")?.[1]).not.toBe(
        policy,
      );
      expect(other.bodyBase64).not.toBe(record.bodyBase64);
      if (record.request.principal === "A-only") expect(body).toContain("g1-fixture-a-only");
    }
  }
  // This is an expected blocker characterization, never HTML G1 acceptance.
  expect(differences).toHaveLength(24);
}, 120_000);
