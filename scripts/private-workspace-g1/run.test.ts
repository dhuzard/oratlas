import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { expectedAck, G1_ENV } from "./target.js";

// Offline: the orchestrator must refuse unsafe or incomplete configuration before it opens any
// connection or creates evidence. Hosts used here are never contacted (refusal happens first).
const require = createRequire(import.meta.url);
const tsx = join(dirname(require.resolve("tsx/package.json")), "dist/cli.mjs");
const run = resolve(process.cwd(), "scripts/private-workspace-g1/run.ts");
const evidenceRoot = mkdtempSync(join(tmpdir(), "oratlas-g1-refusal-"));
afterAll(() => rmSync(evidenceRoot, { recursive: true, force: true }));

function runHarness(extra: Record<string, string>) {
  const evidence = join(evidenceRoot, String(Math.random()).slice(2));
  const result = spawnSync(process.execPath, [tsx, run], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      G1_EVIDENCE_DIR: evidence,
      ...extra,
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { ...result, evidenceCreated: existsSync(evidence) };
}

describe("G1 orchestrator refusal", () => {
  it("fails (exit 2) with no G1 variables and never falls back to DATABASE_URL", () => {
    const result = runHarness({ DATABASE_URL: "postgresql://u:p@localhost:5432/oratlas" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("refused before any database connection");
    expect(result.stderr).toContain(G1_ENV.admin);
    expect(result.evidenceCreated).toBe(false);
  });

  it("refuses a remote target and a missing acknowledgement without echoing secrets", () => {
    const remote = {
      [G1_ENV.admin]: "postgresql://g1_admin:TOPSECRET@db.example.com:5432/oratlas_g1",
      [G1_ENV.public]: "postgresql://oratlas_g1_public:a@db.example.com:5432/oratlas_g1",
      [G1_ENV.private]: "postgresql://oratlas_g1_private:b@db.example.com:5432/oratlas_g1",
      [G1_ENV.ack]: expectedAck("db.example.com", 5432, "oratlas_g1"),
    };
    const refusedRemote = runHarness(remote);
    expect(refusedRemote.status).toBe(2);
    expect(refusedRemote.stderr).toMatch(/loopback host/);
    expect(`${refusedRemote.stdout}${refusedRemote.stderr}`).not.toContain("TOPSECRET");
    expect(refusedRemote.evidenceCreated).toBe(false);

    const local = Object.fromEntries(
      Object.entries(remote).map(([key, value]) => [
        key,
        value.replaceAll("db.example.com", "localhost"),
      ]),
    );
    const { [G1_ENV.ack]: _ack, ...withoutAck } = local;
    const refusedAck = runHarness(withoutAck);
    expect(refusedAck.status).toBe(2);
    expect(refusedAck.stderr).toContain(G1_ENV.ack);
    expect(refusedAck.evidenceCreated).toBe(false);
  });
});
