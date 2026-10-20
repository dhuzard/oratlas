import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  G1_CAPTURE_VERSION,
  sha256Hex,
  type CaptureFile,
  type CapturedResponse,
} from "./capture.js";
import type { GoldenFile } from "./compare.js";
import { runG1Harness, type G1HarnessDeps } from "./orchestrator.js";
import { PsqlError } from "./postgres.js";
import {
  dropPrivateSchemaSql,
  dropRecordedPublicObjectsSql,
  dropRoleSql,
  preflightSql,
  PUBLIC_OBJECT_INVENTORY_SQL,
  publicGrantSnapshotSql,
  schemaObjectCountsSql,
  type PublicObjectInventory,
} from "./sql.js";
import { expectedAck, G1_ENV, PRIVATE_SCHEMA } from "./target.js";

// Offline fault injection through the real orchestrator path: `runG1Harness` with in-memory psql
// and spec runners. Nothing here spawns psql/Vitest or opens a connection; the loopback port is
// never contacted.
const ADMIN_SECRET = "ADMIN-SECRET-g1";
const PUBLIC_SECRET = "PUBLIC-SECRET-g1";
const PRIVATE_SECRET = "PRIVATE-SECRET-g1";
const SECRETS = [ADMIN_SECRET, PUBLIC_SECRET, PRIVATE_SECRET];
const HOST = "127.0.0.1";
const PORT = 59999;
const DATABASE = "oratlas_g1";
const PUBLIC_ROLE = "oratlas_g1_public";
const PRIVATE_ROLE = "oratlas_g1_private";
const ADMIN_ROLE = "g1_admin";
const INVENTORY: PublicObjectInventory = {
  tables: ["Review", "ReviewVersion"],
  functions: ["oratlas_protect_verification()"],
};
const CLEANUP_SQL = {
  "drop private role": dropRoleSql(PRIVATE_ROLE),
  "drop public role": dropRoleSql(PUBLIC_ROLE),
  "drop empty private_ws": dropPrivateSchemaSql(),
  "drop run-created public objects": dropRecordedPublicObjectsSql(INVENTORY),
} as const;
type CleanupStep = keyof typeof CLEANUP_SQL;

const golden = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "scripts/private-workspace-g1/baselines/public-routes.golden.json"),
    "utf8",
  ),
) as GoldenFile;

/** A capture equal to the reviewed golden (hash-only bodies keep their recorded hash/length). */
function captureFromGolden(label: string): CaptureFile {
  return {
    version: G1_CAPTURE_VERSION,
    label,
    baseUrl: golden.baseUrl,
    clock: golden.clock,
    principal: "anonymous",
    responses: golden.routes.map((route): CapturedResponse => {
      const bytes = "encoding" in route.body ? Buffer.from(route.body.text, "utf8") : undefined;
      return {
        id: route.id,
        request: {
          id: route.id,
          method: route.method,
          path: route.path,
          headers: route.requestHeaders,
        },
        status: route.status,
        headers: route.headers,
        setCookie: route.setCookie,
        // Hash-only golden bodies are not reconstructible; the comparators check only their
        // recorded hash and length, so the synthetic capture carries those and no bytes.
        bodyBase64: bytes ? bytes.toString("base64") : "",
        bodySha256: bytes ? sha256Hex(bytes) : "sha256" in route.body ? route.body.sha256 : "",
        bodyLength: bytes ? bytes.byteLength : "length" in route.body ? route.body.length : 0,
      };
    }),
  };
}

type Scenario = {
  failCleanup?: readonly CleanupStep[];
  rolesPass?: boolean;
  preflight?: Record<string, unknown>;
};

function fakes(scenario: Scenario) {
  const psqlCalls: string[] = [];
  const specEnvs: Array<{ spec: string; env: Record<string, string> }> = [];
  const failing = new Set(scenario.failCleanup ?? []);
  const deps: G1HarnessDeps = {
    runPsql: async (_connection, sql) => {
      psqlCalls.push(sql);
      const step = (Object.keys(CLEANUP_SQL) as CleanupStep[]).find(
        (name) => CLEANUP_SQL[name] === sql,
      );
      if (step && failing.has(step)) {
        // Unredacted on purpose: the orchestrator must sanitize what it records.
        throw new PsqlError(
          `psql exited with code 1: ERROR: ${step} failed for postgresql://${ADMIN_ROLE}:${ADMIN_SECRET}@${HOST}:${PORT}/${DATABASE} (${PUBLIC_SECRET} ${PRIVATE_SECRET})`,
          1,
          "",
        );
      }
      return "";
    },
    queryJson: async <T>(_connection: unknown, sql: string): Promise<T> => {
      if (sql === preflightSql([PUBLIC_ROLE, PRIVATE_ROLE])) {
        return {
          serverVersionNum: 160004,
          database: DATABASE,
          sessionUser: ADMIN_ROLE,
          currentUser: ADMIN_ROLE,
          adminCanCreateRoles: true,
          existingRuntimeRoles: [],
          privateSchemaExists: false,
          nonPublicUserSchemas: [],
          publicRelations: 0,
          publicFunctions: 0,
          publicTypes: 0,
          defaultAclEntries: 0,
          ...scenario.preflight,
        } as T;
      }
      if (sql === PUBLIC_OBJECT_INVENTORY_SQL) return INVENTORY as T;
      if (sql === publicGrantSnapshotSql(PUBLIC_ROLE)) return { tablePrivileges: [] } as T;
      if (sql === schemaObjectCountsSql(PRIVATE_SCHEMA)) {
        return { schemaExists: true, owner: ADMIN_ROLE, tables: 0, functions: 0 } as T;
      }
      throw new Error("unexpected query in fake");
    },
    runSpec: async (spec, env, logPath) => {
      specEnvs.push({ spec, env });
      writeFileSync(logPath, "fake spec output\n");
      if (spec === "public-routes.g1.spec.ts") {
        writeFileSync(
          env.G1_CAPTURE_OUT!,
          JSON.stringify(captureFromGolden(env.G1_CAPTURE_LABEL!)),
        );
        return true;
      }
      return scenario.rolesPass ?? true;
    },
  };
  return { deps, psqlCalls, specEnvs };
}

const evidenceRoot = mkdtempSync(join(tmpdir(), "oratlas-g1-orchestrator-"));
afterAll(() => rmSync(evidenceRoot, { recursive: true, force: true }));

let output: string[];
beforeEach(() => {
  output = [];
  const capture = (...args: unknown[]) => void output.push(args.map(String).join(" "));
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => vi.restoreAllMocks());

async function harness(scenario: Scenario) {
  const evidence = mkdtempSync(join(evidenceRoot, "run-"));
  const { deps, psqlCalls, specEnvs } = fakes(scenario);
  const code = await runG1Harness(
    {
      [G1_ENV.admin]: `postgresql://${ADMIN_ROLE}:${ADMIN_SECRET}@${HOST}:${PORT}/${DATABASE}`,
      [G1_ENV.public]: `postgresql://${PUBLIC_ROLE}:${PUBLIC_SECRET}@${HOST}:${PORT}/${DATABASE}`,
      [G1_ENV.private]: `postgresql://${PRIVATE_ROLE}:${PRIVATE_SECRET}@${HOST}:${PORT}/${DATABASE}`,
      [G1_ENV.ack]: expectedAck(HOST, PORT, DATABASE),
      G1_EVIDENCE_DIR: evidence,
    },
    deps,
  );
  const summaryText = readFileSync(join(evidence, "summary.json"), "utf8");
  const summary = JSON.parse(summaryText) as {
    result: string;
    steps: Array<{ step: string; ok: boolean }>;
    cleanup: Array<{ step: string; ok: boolean; detail?: string }>;
    failure?: { check: string | null; cleanup: string[] };
  };
  const cleanupAttempts = psqlCalls.filter((sql) =>
    Object.values(CLEANUP_SQL).includes(sql as never),
  );
  return { code, summary, summaryText, cleanupAttempts, specEnvs };
}

function expectSanitized(...texts: string[]) {
  for (const text of [...texts, output.join("\n")]) {
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  }
}

describe("G1 orchestrator cleanup outcome (offline fault injection)", () => {
  it("passes only when every check and every cleanup step succeeds", async () => {
    const { code, summary, summaryText, cleanupAttempts, specEnvs } = await harness({});
    expect(code).toBe(0);
    expect(summary.result).toBe("passed (G1-empty partial coverage only)");
    expect(summary.failure).toBeUndefined();
    expect(summary.steps.every((step) => step.ok)).toBe(true);
    expect(summary.cleanup.map((step) => [step.step, step.ok])).toEqual(
      Object.keys(CLEANUP_SQL).map((step) => [step, true]),
    );
    expect(cleanupAttempts).toEqual(Object.values(CLEANUP_SQL));
    // Children never receive the bootstrap credential; capture children never the private one.
    for (const { spec, env } of specEnvs) {
      expect(JSON.stringify(env)).not.toContain(ADMIN_SECRET);
      if (spec === "public-routes.g1.spec.ts") {
        expect(JSON.stringify(env)).not.toContain(PRIVATE_SECRET);
      }
    }
    expect(output.at(-1)).toBe("[g1] result: passed (G1-empty partial coverage only)");
    expectSanitized(summaryText);
  });

  it("fails (exit 1) when all checks pass but every cleanup statement is rejected", async () => {
    const failCleanup = Object.keys(CLEANUP_SQL) as CleanupStep[];
    const { code, summary, summaryText, cleanupAttempts } = await harness({ failCleanup });
    expect(code).toBe(1);
    expect(summary.result).toBe("failed (cleanup incomplete; run-created resources may remain)");
    expect(summary.steps.every((step) => step.ok)).toBe(true);
    // Every owned resource was still attempted, in order, despite earlier failures.
    expect(cleanupAttempts).toEqual(Object.values(CLEANUP_SQL));
    expect(summary.cleanup.map((step) => [step.step, step.ok])).toEqual(
      failCleanup.map((step) => [step, false]),
    );
    expect(summary.failure).toEqual({ check: null, cleanup: failCleanup });
    for (const step of summary.cleanup) expect(step.detail).toContain("[redacted]");
    expect(output.some((line) => line.includes("passed"))).toBe(false);
    expect(output.at(-1)).toBe(
      "[g1] result: failed (cleanup incomplete; run-created resources may remain)",
    );
    expectSanitized(summaryText);
  });

  it("keeps the original check failure and still attempts the remaining cleanup", async () => {
    const { code, summary, summaryText, cleanupAttempts } = await harness({
      rolesPass: false,
      failCleanup: ["drop private role"],
    });
    expect(code).toBe(1);
    expect(summary.result).toBe("failed (cleanup incomplete; run-created resources may remain)");
    const failedChecks = summary.steps.filter((step) => !step.ok).map((step) => step.step);
    expect(failedChecks).toEqual(["T-ROLE suite (direct public/private runtime connections)"]);
    expect(summary.failure).toEqual({
      check: "T-ROLE suite (direct public/private runtime connections)",
      cleanup: ["drop private role"],
    });
    expect(cleanupAttempts).toEqual(Object.values(CLEANUP_SQL));
    expect(summary.cleanup.map((step) => step.ok)).toEqual([false, true, true, true]);
    expectSanitized(summaryText);
  });

  it("reports a check failure as failed even when cleanup succeeds", async () => {
    const { code, summary } = await harness({ rolesPass: false });
    expect(code).toBe(1);
    expect(summary.result).toBe("failed");
    expect(summary.failure).toEqual({
      check: "T-ROLE suite (direct public/private runtime connections)",
      cleanup: [],
    });
  });

  it("refuses (exit 2) before mutation and attempts no cleanup", async () => {
    const { code, summary, cleanupAttempts } = await harness({ preflight: { publicRelations: 1 } });
    expect(code).toBe(2);
    expect(summary.result).toBe("refused before mutation");
    expect(summary.cleanup).toEqual([]);
    expect(cleanupAttempts).toEqual([]);
  });
});
