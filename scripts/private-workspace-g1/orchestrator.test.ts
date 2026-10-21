import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureFile, HttpRecord } from "./capture.js";
import { FORBIDDEN_CHILD_ENV } from "./child-env.js";
import { CAPTURE_LABELS, runG1Harness, type G1HarnessDeps } from "./orchestrator.js";
import { PsqlError } from "./postgres.js";
import { validSession } from "./principals.js";
import {
  dropPrivateSchemaSql,
  dropRecordedPublicObjectsSql,
  dropRoleSql,
  EXPECTED_RESET_STATE,
  preflightSql,
  PUBLIC_OBJECT_INVENTORY_SQL,
  publicGrantSnapshotSql,
  RESET_TARGET_SQL,
  resetStateSql,
  schemaObjectCountsSql,
  type PublicObjectInventory,
  type ResetState,
} from "./sql.js";
import { expectedAck, G1_ENV, PRIVATE_SCHEMA } from "./target.js";
import { captureFromGolden, withRecord } from "./test-support.js";

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
const RESET_LABELS = [...CAPTURE_LABELS.map((label) => `${label} capture`), "auth evidence"];

type Scenario = {
  failCleanup?: readonly CleanupStep[];
  rolesPass?: boolean;
  preflight?: Record<string, unknown>;
  /** Reject the Nth reset transaction (0-based). */
  failResetAt?: number;
  /** Report a drifted inventory to the Nth reset target check. */
  driftTargetAt?: number;
  /** Report leftover mutation state after the Nth reset. */
  dirtyResetAt?: number;
  /** Rewrite one capture child's output. */
  captureFor?: (label: string, capture: CaptureFile) => CaptureFile;
};

function fakes(scenario: Scenario) {
  const psqlCalls: string[] = [];
  const specEnvs: Array<{ spec: string; env: Record<string, string> }> = [];
  const failing = new Set(scenario.failCleanup ?? []);
  let resets = 0;
  let targetChecks = 0;
  let resetStates = 0;
  const deps: G1HarnessDeps = {
    runPsql: async (_connection, sql) => {
      psqlCalls.push(sql);
      if (sql.startsWith("TRUNCATE TABLE")) {
        if (resets++ === scenario.failResetAt) {
          throw new PsqlError(
            `psql exited with code 1: ERROR: cannot truncate for postgresql://${ADMIN_ROLE}:${ADMIN_SECRET}@${HOST}:${PORT}/${DATABASE}`,
            1,
            "",
          );
        }
        return "";
      }
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
      if (sql === RESET_TARGET_SQL) {
        const drift = targetChecks++ === scenario.driftTargetAt;
        return {
          database: DATABASE,
          sessionUser: ADMIN_ROLE,
          currentUser: ADMIN_ROLE,
          inventory: drift ? { ...INVENTORY, tables: [...INVENTORY.tables, "Foreign"] } : INVENTORY,
        } as T;
      }
      if (sql === resetStateSql()) {
        // The first state read follows the initial fixture load; later ones follow resets.
        const dirty = resetStates++ - 1 === scenario.dirtyResetAt;
        const state: ResetState = dirty
          ? { ...EXPECTED_RESET_STATE, counts: { ...EXPECTED_RESET_STATE.counts, AuditEvent: 6 } }
          : EXPECTED_RESET_STATE;
        return state as T;
      }
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
        const label = env.G1_CAPTURE_LABEL!;
        const capture = captureFromGolden(label);
        writeFileSync(
          env.G1_CAPTURE_OUT!,
          JSON.stringify(scenario.captureFor ? scenario.captureFor(label, capture) : capture),
        );
        return true;
      }
      if (spec === "auth-context.g1.spec.ts") {
        writeFileSync(env.G1_AUTH_EVIDENCE_OUT!, "{}\n");
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
    steps: Array<{ step: string; ok: boolean; detail?: unknown }>;
    cleanup: Array<{ step: string; ok: boolean; detail?: string }>;
    failure?: { check: string | null; cleanup: string[] };
    manifest?: { coverage: { routeFilesExercised: number; principalsExecuted: string[] } };
  };
  const cleanupAttempts = psqlCalls.filter((sql) =>
    Object.values(CLEANUP_SQL).includes(sql as never),
  );
  const truncations = psqlCalls.filter((sql) => sql.startsWith("TRUNCATE TABLE"));
  return { code, summary, summaryText, cleanupAttempts, specEnvs, truncations };
}

function expectSanitized(...texts: string[]) {
  for (const text of [...texts, output.join("\n")]) {
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  }
}

const failedChecks = (summary: { steps: Array<{ step: string; ok: boolean }> }) =>
  summary.steps.filter((step) => !step.ok).map((step) => step.step);

describe("G1 orchestrator sequence (offline fault injection)", () => {
  it("passes only when every check and every cleanup step succeeds", async () => {
    const { code, summary, summaryText, cleanupAttempts, specEnvs, truncations } = await harness(
      {},
    );
    expect(code).toBe(0);
    expect(summary.result).toBe("passed (G1-empty partial coverage only)");
    expect(summary.failure).toBeUndefined();
    expect(summary.steps.every((step) => step.ok)).toBe(true);
    // A reset (truncate + reload of the recorded tables) precedes every handler child.
    expect(truncations).toHaveLength(RESET_LABELS.length);
    expect(truncations[0]).toBe(
      `TRUNCATE TABLE public."Review", public."ReviewVersion" RESTART IDENTITY;\n${readFileSync(
        join(process.cwd(), "scripts/private-workspace-g1/fixtures/public-fixtures.sql"),
        "utf8",
      )}`,
    );
    expect(summary.steps.filter((s) => s.step.startsWith("reset")).map((s) => s.step)).toEqual(
      RESET_LABELS.map((label) => `reset public fixtures before ${label}`),
    );
    // Fresh child per capture, in order, then the auth child and the role child.
    expect(specEnvs.map(({ spec, env }) => `${spec}:${env.G1_CAPTURE_LABEL ?? ""}`)).toEqual([
      ...CAPTURE_LABELS.map((label) => `public-routes.g1.spec.ts:${label}`),
      "auth-context.g1.spec.ts:",
      "roles.g1.spec.ts:",
    ]);
    expect(summary.cleanup.map((step) => [step.step, step.ok])).toEqual(
      Object.keys(CLEANUP_SQL).map((step) => [step, true]),
    );
    expect(cleanupAttempts).toEqual(Object.values(CLEANUP_SQL));
    expect(summary.manifest?.coverage.routeFilesExercised).toBe(17);
    expect(summary.manifest?.coverage.principalsExecuted).toHaveLength(6);
    expect(output.at(-1)).toBe("[g1] result: passed (G1-empty partial coverage only)");
    expectSanitized(summaryText);
  });

  it("gives handler children a closed public-only environment (no credential or provider leak)", async () => {
    const { specEnvs } = await harness({});
    for (const { spec, env } of specEnvs) {
      expect(JSON.stringify(env)).not.toContain(ADMIN_SECRET);
      if (spec === "roles.g1.spec.ts") continue;
      expect(JSON.stringify(env)).not.toContain(PRIVATE_SECRET);
      for (const name of FORBIDDEN_CHILD_ENV)
        expect(env, `${spec}: ${name}`).not.toHaveProperty(name);
      expect(Object.keys(env).sort()).toEqual(
        [
          "DATABASE_URL",
          "LANG",
          "NEXT_PUBLIC_BASE_URL",
          "NODE_ENV",
          "RATE_LIMIT_MAX",
          "RATE_LIMIT_WINDOW_MS",
          "SESSION_SECRET",
          ...(spec === "public-routes.g1.spec.ts"
            ? ["G1_CAPTURE_LABEL", "G1_CAPTURE_OUT"]
            : ["G1_AUTH_EVIDENCE_OUT"]),
          ...["PATH", "HOME", "TMPDIR", "CI"].filter((name) => process.env[name]),
        ].sort(),
      );
      expect(env.DATABASE_URL).toMatch(/^postgresql:\/\/oratlas_g1_public:/u);
    }
  });

  it("fails and still cleans up when a reset transaction is rejected", async () => {
    const { code, summary, summaryText, cleanupAttempts, specEnvs } = await harness({
      failResetAt: 2,
    });
    expect(code).toBe(1);
    expect(summary.result).toBe("failed");
    expect(failedChecks(summary)).toEqual(["reset public fixtures before after capture"]);
    expect(summary.failure).toEqual({
      check: "reset public fixtures before after capture",
      cleanup: [],
    });
    // No capture child ran on the unreset state.
    expect(specEnvs.map(({ env }) => env.G1_CAPTURE_LABEL)).toEqual([
      "baseline",
      "baseline-repeat",
    ]);
    expect(cleanupAttempts).toEqual(Object.values(CLEANUP_SQL));
    expectSanitized(summaryText);
  });

  it("refuses to reset a drifted target and does not truncate", async () => {
    const { code, summary, truncations } = await harness({ driftTargetAt: 1 });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual(["reset public fixtures before baseline-repeat capture"]);
    expect(summary.steps.find((step) => !step.ok)?.detail).toEqual([
      "public objects differ from the run-created inventory",
    ]);
    expect(truncations).toHaveLength(1);
  });

  it("fails when a reset leaves mutation state behind", async () => {
    const { code, summary } = await harness({ dirtyResetAt: 3 });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual(["reset public fixtures before after-repeat capture"]);
  });

  it("fails a capture that is not the reviewed program outcome (principal swap)", async () => {
    const { code, summary } = await harness({
      captureFor: (label, capture) =>
        label === "after"
          ? withRecord(capture, "certifier-suspend-admin", (record) => ({
              ...(record as HttpRecord),
              request: { ...(record as HttpRecord).request, session: validSession("EDITOR") },
            }))
          : capture,
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual(["after capture matches the reviewed program outcomes"]);
    const detail = summary.steps.find((step) => !step.ok)?.detail as { problems: string[] };
    expect(detail.problems).toContain(
      "certifier-suspend-admin: ADMIN principal dispatched the session of g1-user-editor",
    );
  });

  it("fails paired comparison when a repeat differs in body bytes only", async () => {
    const { code, summary } = await harness({
      captureFor: (label, capture) =>
        label === "after-repeat"
          ? withRecord(capture, "llms-txt", (record) => ({
              ...(record as HttpRecord),
              bodyBase64: Buffer.from("changed").toString("base64"),
            }))
          : capture,
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual(["baseline and after-repeat captures byte-identical"]);
  });
});

describe("G1 orchestrator cleanup outcome (offline fault injection)", () => {
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
    expect(failedChecks(summary)).toEqual([
      "T-ROLE suite (direct public/private runtime connections)",
    ]);
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
