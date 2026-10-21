import type * as NativeFs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { upgradeGolden } from "./compare.js";
import { SUPPLEMENTAL_PROGRAMS } from "./supplemental-programs.js";
import {
  supplementalCountsSql,
  supplementalStateDigest,
  type SupplementalProgram,
} from "./supplemental-channel.js";
import { indexDigest, INDEX_READ_TABLES, type IndexCapture } from "./index-channel.js";
import { SCENARIOS } from "./scenarios.js";
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
  truncateRecordedPublicTablesSql,
  schemaObjectCountsSql,
  type PublicObjectInventory,
  type ResetState,
} from "./sql.js";
import { expectedAck, G1_ENV, PRIVATE_SCHEMA } from "./target.js";
import { captureFromGolden, withRecord } from "./test-support.js";

// Only reviewed supplemental state hashes are replaced with small, explicitly synthetic unit
// state. HTTP bytes, declared outcomes, actual supplemental lifecycle and golden checks remain real.
// Native full-row state evidence belongs to the separately executed PostgreSQL child programs.
const syntheticReviewedStates = vi.hoisted(() => new Map<string, string>());
vi.mock("node:fs", async (importOriginal) => {
  const native = await importOriginal<typeof NativeFs>();
  return {
    ...native,
    readFileSync: ((...args: Parameters<typeof native.readFileSync>) => {
      const original = native.readFileSync(...args);
      const digest = syntheticReviewedStates.get(String(args[0]));
      if (digest === undefined) return original;
      const rewritten = JSON.stringify({ ...JSON.parse(original.toString()), stateSha256: digest });
      return typeof original === "string" ? rewritten : Buffer.from(rewritten);
    }) as typeof native.readFileSync,
  };
});

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
  tables: [
    ...readFileSync(join(process.cwd(), "packages/db/prisma/schema.postgres.sql"), "utf8").matchAll(
      /^CREATE TABLE "([A-Z][A-Za-z0-9]+)"/gmu,
    ),
  ]
    .map((match) => match[1]!)
    .sort(),
  functions: ["oratlas_protect_verification()"],
};
const CLEANUP_SQL = {
  "drop private role": dropRoleSql(PRIVATE_ROLE),
  "drop public role": dropRoleSql(PUBLIC_ROLE),
  "drop empty private_ws": dropPrivateSchemaSql(),
  "drop run-created public objects": dropRecordedPublicObjectsSql(INVENTORY),
} as const;
type CleanupStep = keyof typeof CLEANUP_SQL;
const RESET_LABELS = [
  ...CAPTURE_LABELS.flatMap((label) => [
    `${label} capture`,
    `${label} index capture`,
    ...SUPPLEMENTAL_PROGRAMS.map((program) => `${label} ${program.name} capture`),
  ]),
  "auth evidence",
];
const INDEX_GOLDEN_PATH = join(
  process.cwd(),
  "scripts/private-workspace-g1/baselines/public-index.golden.json",
);
const INDEX_FIXTURE_SQL = readFileSync(
  join(process.cwd(), "scripts/private-workspace-g1/fixtures/index-fixtures.sql"),
  "utf8",
);
// This is a separate independently reviewed native consumer baseline. Never generate a fake
// golden from expectations just to make orchestration mocks pass. The root supplies it after review.
function reviewedIndex(label: string): IndexCapture {
  return { ...JSON.parse(readFileSync(INDEX_GOLDEN_PATH, "utf8")), label };
}

const supplementalGoldenPath = (program: SupplementalProgram) =>
  join(process.cwd(), "scripts/private-workspace-g1/baselines", `${program.name}.golden.json`);
const syntheticSupplementalUnitState = (program: SupplementalProgram) => ({
  protocol: "g1.unit.synthetic-parent-state/0.1",
  program: program.name,
  purpose: "small synthetic unit state; not native G1 row evidence",
});
const childSequence = (labels: readonly string[]) =>
  labels.flatMap((label) => [
    `public-routes.g1.spec.ts:${label}`,
    `index-consumer.g1.spec.ts:${label}`,
    ...SUPPLEMENTAL_PROGRAMS.map((program) => `${program.spec}:${label}`),
  ]);

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
  /** Refuse this index child before it writes any capture. */
  failIndexLabel?: string;
  /** Rewrite an independently reviewed index capture for negative evidence controls. */
  indexFor?: (label: string, capture: IndexCapture) => IndexCapture;
};

function fakes(scenario: Scenario) {
  const psqlCalls: string[] = [];
  const countQueries: string[] = [];
  const specEnvs: Array<{ spec: string; env: Record<string, string> }> = [];
  const events: string[] = [];
  const failing = new Set(scenario.failCleanup ?? []);
  let resets = 0;
  let targetChecks = 0;
  let resetStates = 0;
  const baseCounts = Object.fromEntries(
    INVENTORY.tables.map((table) => [table, EXPECTED_RESET_STATE.counts[table] ?? 0]),
  );
  let supplementalCounts = { ...baseCounts };
  const fixturePrograms = new Set<string>();
  let activeSupplemental: SupplementalProgram | undefined;
  for (const program of SUPPLEMENTAL_PROGRAMS)
    syntheticReviewedStates.set(
      supplementalGoldenPath(program),
      supplementalStateDigest(syntheticSupplementalUnitState(program)),
    );
  const deps: G1HarnessDeps = {
    runPsql: async (_connection, sql) => {
      psqlCalls.push(sql);
      if (sql === INDEX_FIXTURE_SQL) events.push("index-only fixtures");
      // Shared SQL belongs to the current reset, not every descriptor referencing that file.
      for (const program of activeSupplemental ? [activeSupplemental] : []) {
        for (const fixture of program.fixtures ?? []) {
          if (
            sql !==
            readFileSync(join(process.cwd(), "scripts/private-workspace-g1", fixture), "utf8")
          )
            continue;
          events.push(`supplemental-only fixtures:${program.name}:${fixture}`);
          if (!fixturePrograms.has(program.name)) {
            for (const [table, delta] of Object.entries(program.addedRows))
              supplementalCounts[table] = (supplementalCounts[table] ?? 0) + delta;
            fixturePrograms.add(program.name);
          }
        }
      }
      if (sql.startsWith("TRUNCATE TABLE")) {
        events.push(`reset:${RESET_LABELS[resets]}`);
        activeSupplemental = SUPPLEMENTAL_PROGRAMS.find((program) =>
          RESET_LABELS[resets]?.endsWith(` ${program.name} capture`),
        );
        supplementalCounts = { ...baseCounts };
        fixturePrograms.clear();
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
      if (sql === supplementalCountsSql(INVENTORY.tables)) {
        countQueries.push(sql);
        return { ...supplementalCounts } as T;
      }
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
      events.push(`child:${spec}:${env.G1_CAPTURE_LABEL ?? env.G1_INDEX_LABEL ?? ""}`);
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
      if (spec === "index-consumer.g1.spec.ts") {
        const label = env.G1_INDEX_LABEL!;
        if (scenario.failIndexLabel === label) return false;
        const capture = reviewedIndex(label);
        writeFileSync(
          env.G1_INDEX_CAPTURE_OUT!,
          JSON.stringify(scenario.indexFor ? scenario.indexFor(label, capture) : capture),
        );
        return true;
      }
      const program = SUPPLEMENTAL_PROGRAMS.find((program) => program.spec === spec);
      if (program) {
        // Native HTTP is reconstructed only from the independently reviewed committed golden.
        // Never manufacture HTTP/golden success from scenario expectations.
        const reviewed = JSON.parse(readFileSync(supplementalGoldenPath(program), "utf8"));
        const capture = captureFromGolden(env.G1_CAPTURE_LABEL!, upgradeGolden(reviewed.http));
        writeFileSync(env[program.outVariable]!, JSON.stringify(capture));
        writeFileSync(
          env[program.outVariable]! + program.stateSuffix,
          JSON.stringify(syntheticSupplementalUnitState(program)),
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
  return { deps, psqlCalls, specEnvs, events, countQueries };
}

const evidenceRoot = mkdtempSync(join(tmpdir(), "oratlas-g1-orchestrator-"));
afterAll(() => rmSync(evidenceRoot, { recursive: true, force: true }));

let output: string[];
beforeEach(() => {
  output = [];
  syntheticReviewedStates.clear();
  const capture = (...args: unknown[]) => void output.push(args.map(String).join(" "));
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => vi.restoreAllMocks());

async function harness(scenario: Scenario) {
  const evidence = mkdtempSync(join(evidenceRoot, "run-"));
  const { deps, psqlCalls, specEnvs, events, countQueries } = fakes(scenario);
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
  return {
    code,
    summary,
    summaryText,
    cleanupAttempts,
    specEnvs,
    truncations,
    events,
    evidence,
    countQueries,
  };
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
    const {
      code,
      summary,
      summaryText,
      cleanupAttempts,
      specEnvs,
      truncations,
      events,
      evidence,
      countQueries,
    } = await harness({});
    expect(code).toBe(0);
    expect(INVENTORY.tables).toHaveLength(87);
    expect(countQueries).toHaveLength(CAPTURE_LABELS.length * SUPPLEMENTAL_PROGRAMS.length * 2);
    expect(countQueries.every((sql) => sql === supplementalCountsSql(INVENTORY.tables))).toBe(true);
    expect(summary.result).toBe("passed (G1-empty partial coverage only)");
    expect(summary.failure).toBeUndefined();
    expect(summary.steps.every((step) => step.ok)).toBe(true);
    // A reset (truncate + reload of the recorded tables) precedes every handler child.
    expect(truncations).toHaveLength(RESET_LABELS.length);
    expect(truncations[0]).toBe(
      `${truncateRecordedPublicTablesSql(INVENTORY)}\n${[
        "public-fixtures.sql",
        "editorial-fixtures.sql",
        "scholarly-fixtures.sql",
        "discovery-fixtures.sql",
        "protocol-fixtures.sql",
        "editorial-read-fixtures.sql",
      ]
        .map((file) =>
          readFileSync(join(process.cwd(), "scripts/private-workspace-g1/fixtures", file), "utf8"),
        )
        .join("\n")}`,
    );
    expect(summary.steps.filter((s) => s.step.startsWith("reset")).map((s) => s.step)).toEqual(
      RESET_LABELS.map((label) => `reset public fixtures before ${label}`),
    );
    // Fresh child per capture, in order, then the auth child and the role child.
    expect(
      specEnvs.map(
        ({ spec, env }) => `${spec}:${env.G1_CAPTURE_LABEL ?? env.G1_INDEX_LABEL ?? ""}`,
      ),
    ).toEqual([...childSequence(CAPTURE_LABELS), "auth-context.g1.spec.ts:", "roles.g1.spec.ts:"]);
    expect(summary.cleanup.map((step) => [step.step, step.ok])).toEqual(
      Object.keys(CLEANUP_SQL).map((step) => [step, true]),
    );
    expect(cleanupAttempts).toEqual(Object.values(CLEANUP_SQL));
    expect(summary.manifest?.coverage.routeFilesExercised).toBe(
      new Set(
        [...SCENARIOS, ...SUPPLEMENTAL_PROGRAMS.flatMap((program) => program.scenarios)]
          .filter((scenario) => scenario.kind === "http")
          .map((scenario) => scenario.route),
      ).size,
    );
    expect(events).toEqual([
      ...CAPTURE_LABELS.flatMap((label) => [
        `reset:${label} capture`,
        `child:public-routes.g1.spec.ts:${label}`,
        `reset:${label} index capture`,
        "index-only fixtures",
        `child:index-consumer.g1.spec.ts:${label}`,
        ...SUPPLEMENTAL_PROGRAMS.flatMap((program) => [
          `reset:${label} ${program.name} capture`,
          ...(program.fixtures ?? []).map(
            (fixture) => `supplemental-only fixtures:${program.name}:${fixture}`,
          ),
          `child:${program.spec}:${label}`,
        ]),
      ]),
      "reset:auth evidence",
      "child:auth-context.g1.spec.ts:",
      "child:roles.g1.spec.ts:",
    ]);
    expect(JSON.parse(readFileSync(join(evidence, "index-golden-candidate.json"), "utf8"))).toEqual(
      reviewedIndex("baseline"),
    );
    expect(summary.manifest?.coverage.principalsExecuted).toHaveLength(6);
    expect(output.at(-1)).toBe("[g1] result: passed (G1-empty partial coverage only)");
    expectSanitized(summaryText);
    // Full four-label/catalog assertions process thousands of exact reviewed records.
    // Keep this offline-only budget bounded without changing native child deadlines.
  }, 15_000);

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
            : spec === "index-consumer.g1.spec.ts"
              ? ["G1_INDEX_CAPTURE_OUT", "G1_INDEX_LABEL"]
              : SUPPLEMENTAL_PROGRAMS.some((program) => program.spec === spec)
                ? [
                    "G1_CAPTURE_LABEL",
                    SUPPLEMENTAL_PROGRAMS.find((program) => program.spec === spec)!.outVariable,
                  ]
                : ["G1_AUTH_EVIDENCE_OUT"]),
          ...["PATH", "HOME", "TMPDIR", "CI"].filter((name) => process.env[name]),
        ].sort(),
      );
      expect(env.DATABASE_URL).toMatch(/^postgresql:\/\/oratlas_g1_public:/u);
    }
  });

  it("fails and still cleans up when a reset transaction is rejected", async () => {
    const { code, summary, summaryText, cleanupAttempts, specEnvs } = await harness({
      failResetAt: RESET_LABELS.indexOf("after capture"),
    });
    expect(code).toBe(1);
    expect(summary.result).toBe("failed");
    expect(failedChecks(summary)).toEqual(["reset public fixtures before after capture"]);
    expect(summary.failure).toEqual({
      check: "reset public fixtures before after capture",
      cleanup: [],
    });
    // No capture child ran on the unreset state.
    expect(
      specEnvs.map(({ spec, env }) => `${spec}:${env.G1_CAPTURE_LABEL ?? env.G1_INDEX_LABEL}`),
    ).toEqual([...childSequence(["baseline", "baseline-repeat"])]);
    expect(cleanupAttempts).toEqual(Object.values(CLEANUP_SQL));
    expectSanitized(summaryText);
  });

  it("refuses to reset a drifted target and does not truncate", async () => {
    const { code, summary, truncations } = await harness({
      driftTargetAt: RESET_LABELS.indexOf("baseline-repeat capture"),
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual(["reset public fixtures before baseline-repeat capture"]);
    expect(summary.steps.find((step) => !step.ok)?.detail).toEqual([
      "public objects differ from the run-created inventory",
    ]);
    expect(truncations).toHaveLength(RESET_LABELS.indexOf("baseline-repeat capture"));
  });

  it("fails when a reset leaves mutation state behind", async () => {
    const { code, summary } = await harness({
      dirtyResetAt: RESET_LABELS.indexOf("after-repeat capture"),
    });
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

describe("G1 fixed supplemental parent lifecycle (offline fault injection)", () => {
  it("fails a supplemental reset before loading its fixtures or invoking that child", async () => {
    const program = SUPPLEMENTAL_PROGRAMS[0]!;
    const label = `baseline ${program.name} capture`;
    const { code, summary, events, specEnvs, cleanupAttempts, countQueries } = await harness({
      failResetAt: RESET_LABELS.indexOf(label),
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual([`reset public fixtures before ${label}`]);
    expect(events.at(-1)).toBe(`reset:${label}`);
    expect(specEnvs.map(({ spec }) => spec)).toEqual([
      "public-routes.g1.spec.ts",
      "index-consumer.g1.spec.ts",
    ]);
    expect(countQueries).toEqual([]);
    // The first baseline supplemental reset precedes private schema/role creation.
    expect(cleanupAttempts).toEqual([
      CLEANUP_SQL["drop public role"],
      CLEANUP_SQL["drop run-created public objects"],
    ]);
    expect(summary.cleanup.map(({ step, ok }) => [step, ok])).toEqual([
      ["drop public role", true],
      ["drop run-created public objects", true],
    ]);
  });
});

describe("G1 isolated index orchestration (offline fault injection)", () => {
  it("fails a rejected index child before reading missing evidence and preserves cleanup", async () => {
    const { code, summary, cleanupAttempts, specEnvs, evidence } = await harness({
      failIndexLabel: "after",
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual([
      "after index: fresh actual consumer child under the public runtime role",
    ]);
    expect(specEnvs.at(-1)?.spec).toBe("index-consumer.g1.spec.ts");
    expect(specEnvs.at(-1)?.env.G1_INDEX_LABEL).toBe("after");
    expect(existsSync(join(evidence, "index-after.json"))).toBe(false);
    expect(cleanupAttempts).toEqual(Object.values(CLEANUP_SQL));
    expect(summary.cleanup.every((step) => step.ok)).toBe(true);
  });

  it("refuses an index reset failure before loading its extra controls or invoking its child", async () => {
    const { code, summary, events, cleanupAttempts } = await harness({
      failResetAt: RESET_LABELS.indexOf("after index capture"),
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual(["reset public fixtures before after index capture"]);
    expect(events.at(-1)).toBe("reset:after index capture");
    expect(events.filter((event) => event === "index-only fixtures")).toHaveLength(2);
    expect(cleanupAttempts).toEqual(Object.values(CLEANUP_SQL));
  });

  it("fails a tampered canonical index digest before any pair or golden acceptance", async () => {
    const { code, summary } = await harness({
      indexFor: (label, capture) =>
        label === "baseline" ? { ...capture, indexSha256: "0".repeat(64) } : capture,
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual([
      "baseline index matches populated outcomes and unchanged rows",
    ]);
    expect(summary.steps.find((step) => !step.ok)?.detail).toContain("index digest mismatch");
    expect(
      summary.steps.some((step) => step.step.includes("match the reviewed index golden")),
    ).toBe(false);
  });

  it("fails a same-count value mutation reported by a consumer capture", async () => {
    const { code, summary } = await harness({
      indexFor: (label, capture) =>
        label === "baseline"
          ? {
              ...capture,
              stateAfterSha256: indexDigest({ User: [{ id: "same-row", role: "ADMIN" }] }),
            }
          : capture,
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual([
      "baseline index matches populated outcomes and unchanged rows",
    ]);
    expect(summary.steps.find((step) => !step.ok)?.detail).toContain("consumer mutated database");
  });

  it("compares public row values across runs even when each consumer individually makes no changes", async () => {
    const changed = indexDigest({ User: [{ id: "same-row", orcid: "changed-value" }] });
    const { code, summary } = await harness({
      indexFor: (label, capture) =>
        label === "after"
          ? { ...capture, stateBeforeSha256: changed, stateAfterSha256: changed }
          : capture,
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual([
      "baseline and after canonical indexes and public rows identical",
    ]);
    expect(summary.steps.find((step) => !step.ok)?.detail).toContain(
      "public fixture state differs",
    );
  });

  it("rejects an index whose content differs even after its own digest is recomputed", async () => {
    const { code, summary } = await harness({
      indexFor: (label, capture) => {
        if (label !== "after") return capture;
        capture.index.claims[0]!.text = "Changed synthetic public source content";
        return { ...capture, indexSha256: indexDigest(capture.index) };
      },
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual([
      "baseline and after canonical indexes and public rows identical",
    ]);
    expect(summary.steps.find((step) => !step.ok)?.detail).toContain("index bytes differ");
  });

  it("rejects comparison under a different otherwise valid index authority", async () => {
    const { code, summary } = await harness({
      indexFor: (label, capture) =>
        label === "after"
          ? { ...capture, roleContract: "read-only-probe", stateTables: INDEX_READ_TABLES }
          : capture,
    });
    expect(code).toBe(1);
    expect(failedChecks(summary)).toEqual([
      "baseline and after canonical indexes and public rows identical",
    ]);
    expect(summary.steps.find((step) => !step.ok)?.detail).toContain(
      "authority or state scope differs",
    );
  });

  it("writes a separate candidate without changing the independently reviewed index golden", async () => {
    const reviewed = readFileSync(INDEX_GOLDEN_PATH, "utf8");
    const { code, evidence } = await harness({});
    expect(code).toBe(0);
    expect(readFileSync(INDEX_GOLDEN_PATH, "utf8")).toBe(reviewed);
    expect(JSON.parse(readFileSync(join(evidence, "index-golden-candidate.json"), "utf8"))).toEqual(
      reviewedIndex("baseline"),
    );
  });

  it("keeps an index failure as the original cause while attempting all failing cleanup steps", async () => {
    const failCleanup = Object.keys(CLEANUP_SQL) as CleanupStep[];
    const { code, summary, summaryText, cleanupAttempts } = await harness({
      failIndexLabel: "after",
      failCleanup,
    });
    expect(code).toBe(1);
    expect(summary.result).toBe("failed (cleanup incomplete; run-created resources may remain)");
    expect(summary.failure).toEqual({
      check: "after index: fresh actual consumer child under the public runtime role",
      cleanup: failCleanup,
    });
    expect(cleanupAttempts).toEqual(Object.values(CLEANUP_SQL));
    expect(summary.cleanup.every((step) => !step.ok)).toBe(true);
    expectSanitized(summaryText);
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
