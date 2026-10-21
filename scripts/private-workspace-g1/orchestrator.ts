import { supplementalChannels } from "./supplemental-orchestrator.js";
import { SUPPLEMENTAL_PROGRAMS } from "./supplemental-programs.js";
import { workerChildOutput } from "./worker-capture-safety.js";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicChildEnv } from "./child-env.js";
import {
  indexCaptureDifferences,
  indexCaptureProblems,
  indexRunnerOutputProblems,
  type IndexCapture,
} from "./index-channel.js";
import {
  comparePairedCaptures,
  compareWithGolden,
  goldenCandidate,
  validateCapture,
} from "./compare.js";
import { coverageSummary, G1_COVERAGE_STATUS, PRINCIPALS, SURFACES } from "./manifest.js";
import { PsqlError, queryJson, redact, runPsql } from "./postgres.js";
import { SCENARIOS } from "./scenarios.js";
import {
  createPublicRoleSql,
  dropPrivateSchemaSql,
  dropRecordedPublicObjectsSql,
  dropRoleSql,
  EXPECTED_RESET_STATE,
  isEmptySchema,
  preflightSql,
  provisionPrivateSql,
  PUBLIC_COLUMN_UPDATE_GRANTS,
  PUBLIC_OBJECT_INVENTORY_SQL,
  PUBLIC_TABLE_GRANTS,
  publicGrantSnapshotSql,
  RESET_TARGET_SQL,
  resetStateSql,
  resetTargetProblems,
  schemaObjectCountsSql,
  truncateRecordedPublicTablesSql,
  type PublicObjectInventory,
  type ResetState,
  type ResetTarget,
  type SchemaObjectCounts,
} from "./sql.js";
import {
  G1_ENV,
  G1_RUNTIME_ENV,
  G1TargetError,
  parseG1Target,
  PRIVATE_SCHEMA,
  prismaUrl,
  type G1Connection,
  type G1Target,
} from "./target.js";

/**
 * G1-empty harness orchestrator (docs/private-workspace-g1-harness.md). Order:
 * validate target → preflight (refuse unless clean) → bootstrap public DDL + fixtures → restricted
 * public role → [reset → BASELINE capture] → [reset → BASELINE repeat] → empty private_ws + private
 * role → [reset → AFTER capture] → [reset → AFTER repeat] → [reset → auth evidence] → T-ROLE suite
 * → validate/compare captures and golden → clean up only run-created resources → write sanitized
 * evidence. Every capture is a fresh child running the reviewed ordered scenario program; resets
 * use the bootstrap connection only, after re-checking the target identity and the run-created
 * inventory. Exit codes: 0 passed (every check and every cleanup step succeeded), 1 a check or a
 * cleanup step failed, 2 target refused before any mutation. `run.ts` is the CLI entry point.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DDL_PATH = resolve(ROOT, "packages/db/prisma/schema.postgres.sql");
const FIXTURE_PATHS = [
  "public-fixtures.sql",
  "editorial-fixtures.sql",
  "scholarly-fixtures.sql",
  "discovery-fixtures.sql",
  "protocol-fixtures.sql",
  "editorial-read-fixtures.sql",
].map((file) => resolve(HERE, "fixtures", file));
const GOLDEN_PATH = resolve(HERE, "baselines/public-routes.golden.json");
const INDEX_GOLDEN_PATH = resolve(HERE, "baselines/public-index.golden.json");
const INDEX_FIXTURE_PATH = resolve(HERE, "fixtures/index-fixtures.sql");
const VITEST_CONFIG = resolve(HERE, "vitest.config.ts");
const APP_DIRECTORY = resolve(ROOT, "apps/web/src/app");
/** Capture children in run order; the first is the reference for paired comparison. */
export const CAPTURE_LABELS = ["baseline", "baseline-repeat", "after", "after-repeat"] as const;

type Step = { step: string; ok: boolean; detail?: unknown };

class HarnessFailure extends Error {}
class RefusedBeforeMutation extends Error {}

/** Database and child-process effects, injectable so the offline tests can drive this exact path. */
export type G1HarnessDeps = {
  runPsql: (
    connection: G1Connection,
    sql: string,
    options: { singleTransaction?: boolean; secrets?: readonly string[] },
  ) => Promise<string>;
  queryJson: <T>(connection: G1Connection, sql: string) => Promise<T>;
  runSpec: (
    spec: string,
    env: G1ChildEnv,
    logPath: string,
    secrets: readonly string[],
  ) => Promise<boolean>;
};

/** Exact environment of a spec child: string values only, with a fixed `NODE_ENV`. */
export type G1ChildEnv = Record<string, string> & { NODE_ENV: "test" };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function log(message: string): void {
  console.info(`[g1] ${message}`);
}

function secretsOf(target: G1Target): string[] {
  return [target.admin.password, target.public.password, target.private.password];
}

function baseChildEnv(): G1ChildEnv {
  const env: G1ChildEnv = { LANG: "C.UTF-8", NODE_ENV: "test" };
  for (const name of ["PATH", "HOME", "TMPDIR", "CI"]) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}

function vitestEntry(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
}

/** Run one dedicated spec in a child with exactly `env`; output is redacted and logged. */
function runSpec(
  spec: string,
  env: G1ChildEnv,
  logPath: string,
  secrets: readonly string[],
): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [vitestEntry(), "run", "--config", VITEST_CONFIG, resolve(HERE, spec)],
      { cwd: ROOT, env, shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const outputProblems =
        spec === "index-consumer.g1.spec.ts"
          ? indexRunnerOutputProblems(raw, [
              ...secrets,
              ...secrets.map(encodeURIComponent),
              env.DATABASE_URL ?? "",
            ])
          : [];
      // A rejected sink is a failed check. Never preserve its hidden text or turn
      // redacted evidence into a claim that the original sink did not leak.
      const guarded = workerChildOutput(raw);
      const output = !guarded.ok
        ? guarded.text
        : outputProblems.length
          ? `[g1] refused index child output: ${outputProblems.join(", ")}\n`
          : redact(raw, secrets);
      writeFileSync(logPath, output, { mode: 0o600 });
      process.stdout.write(output);
      resolvePromise(code === 0 && outputProblems.length === 0 && guarded.ok);
    });
  });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

type Preflight = {
  serverVersionNum: number;
  database: string;
  sessionUser: string;
  currentUser: string;
  adminCanCreateRoles: boolean;
  existingRuntimeRoles: string[];
  privateSchemaExists: boolean;
  nonPublicUserSchemas: string[];
  publicRelations: number;
  publicFunctions: number;
  publicTypes: number;
  defaultAclEntries: number;
};

function preflightProblems(target: G1Target, facts: Preflight): string[] {
  const problems: string[] = [];
  if (facts.serverVersionNum < 160000 || facts.serverVersionNum >= 170000) {
    problems.push(`server is not PostgreSQL 16 (server_version_num ${facts.serverVersionNum})`);
  }
  if (facts.database !== target.database) problems.push("connected database differs from target");
  if (facts.sessionUser !== target.admin.user || facts.currentUser !== target.admin.user) {
    problems.push("admin session identity differs from the admin URL user");
  }
  if (!facts.adminCanCreateRoles) problems.push("admin role cannot create roles");
  if (facts.existingRuntimeRoles.length > 0) {
    problems.push(`runtime roles already exist: ${facts.existingRuntimeRoles.join(", ")}`);
  }
  if (facts.privateSchemaExists) problems.push(`${PRIVATE_SCHEMA} already exists`);
  if (facts.nonPublicUserSchemas.length > 0) {
    problems.push(`database has extra schemas: ${facts.nonPublicUserSchemas.join(", ")}`);
  }
  if (facts.publicRelations + facts.publicFunctions + facts.publicTypes > 0) {
    problems.push("public schema is not empty");
  }
  if (facts.defaultAclEntries > 0) problems.push("database already has default privileges");
  return problems;
}

const DEFAULT_DEPS: G1HarnessDeps = { runPsql, queryJson, runSpec };

type CreatedResources = {
  publicObjects: PublicObjectInventory | undefined;
  publicRole: boolean;
  privateSchema: boolean;
  privateRole: boolean;
};

/**
 * Run the harness against the target described by `env` (the dedicated G1 variables only). Returns
 * the exit code; any failed cleanup step forces `1` and a failed summary, even after passing checks.
 */
export async function runG1Harness(
  env: Readonly<Record<string, string | undefined>>,
  deps: G1HarnessDeps = DEFAULT_DEPS,
): Promise<number> {
  let target: G1Target;
  try {
    target = parseG1Target(env);
  } catch (error) {
    if (error instanceof G1TargetError) {
      console.error(`[g1] refused before any database connection: ${error.message}`);
      return 2;
    }
    throw error;
  }
  const secrets = secretsOf(target);
  const runId = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${process.pid}`;
  const evidenceDir = resolve(
    env.G1_EVIDENCE_DIR?.trim() || join(tmpdir(), `oratlas-g1-evidence-${runId}`),
  );
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  log(`evidence directory: ${evidenceDir}`);

  const steps: Step[] = [];
  const created: CreatedResources = {
    publicObjects: undefined,
    publicRole: false,
    privateSchema: false,
    privateRole: false,
  };
  const summary: Record<string, unknown> = {
    harness: "oratlas-private-workspace-g1",
    coverage: G1_COVERAGE_STATUS,
    target: {
      host: target.host,
      port: target.port,
      database: target.database,
      adminRole: target.admin.user,
      publicRole: target.public.user,
      privateRole: target.private.user,
    },
    steps,
  };
  const record = (step: string, ok: boolean, detail?: unknown) => {
    steps.push({ step, ok, ...(detail === undefined ? {} : { detail }) });
    log(`${ok ? "ok  " : "FAIL"} ${step}`);
    if (!ok) throw new HarnessFailure(step);
  };

  let exitCode = 1;
  try {
    // 1. Preflight: read-only; refuses unless the target is a clean PostgreSQL 16 database.
    let facts: Preflight;
    try {
      facts = await deps.queryJson<Preflight>(
        target.admin,
        preflightSql([target.public.user, target.private.user]),
      );
    } catch (error) {
      const message = redact(errorMessage(error), secrets);
      console.error(`[g1] refused: preflight connection failed: ${message}`);
      steps.push({ step: "preflight", ok: false });
      throw new RefusedBeforeMutation();
    }
    summary.preflight = facts;
    const problems = preflightProblems(target, facts);
    if (problems.length > 0) {
      steps.push({ step: "preflight", ok: false, detail: problems });
      console.error(`[g1] refused before mutation: ${problems.join("; ")}`);
      throw new RefusedBeforeMutation();
    }
    record("preflight: clean PostgreSQL 16 disposable target", true);

    // 2. Public schema from the checked-in generated PostgreSQL DDL, then fixtures.
    await deps.runPsql(target.admin, readFileSync(DDL_PATH, "utf8"), {
      singleTransaction: true,
      secrets,
    });
    const inventory = await deps.queryJson<PublicObjectInventory>(
      target.admin,
      PUBLIC_OBJECT_INVENTORY_SQL,
    );
    created.publicObjects = inventory;
    record("bootstrap public schema from schema.postgres.sql", true, {
      tables: inventory.tables.length,
      functions: inventory.functions.length,
    });
    const fixtureSql = FIXTURE_PATHS.map((path) => readFileSync(path, "utf8")).join("\n");
    await deps.runPsql(target.admin, fixtureSql, { singleTransaction: true, secrets });
    const seeded = await deps.queryJson<ResetState>(target.admin, resetStateSql());
    record(
      "load deterministic public fixtures",
      JSON.stringify(seeded) === JSON.stringify(EXPECTED_RESET_STATE),
      seeded,
    );

    // 3. Restricted public runtime role, before the baseline.
    await deps.runPsql(
      target.admin,
      createPublicRoleSql(target.public.user, target.public.password),
      { singleTransaction: true, secrets },
    );
    created.publicRole = true;
    const grantsBefore = await deps.queryJson(
      target.admin,
      publicGrantSnapshotSql(target.public.user),
    );
    record("create restricted public runtime role", true, {
      reviewedTableGrants: PUBLIC_TABLE_GRANTS,
      reviewedColumnGrants: PUBLIC_COLUMN_UPDATE_GRANTS,
      effective: grantsBefore,
    });

    // Reset: bootstrap connection only, after proving the target and the run-created inventory
    // are unchanged; truncate exactly those tables and reload the fixtures in one transaction.
    const reset = async (label: string) => {
      const step = `reset public fixtures before ${label}`;
      const facts = await deps.queryJson<ResetTarget>(target.admin, RESET_TARGET_SQL);
      const problems = resetTargetProblems(facts, {
        database: target.database,
        adminRole: target.admin.user,
        inventory,
      });
      if (problems.length > 0) record(step, false, problems);
      try {
        await deps.runPsql(
          target.admin,
          `${truncateRecordedPublicTablesSql(inventory)}\n${fixtureSql}`,
          { singleTransaction: true, secrets },
        );
      } catch (error) {
        record(step, false, redact(errorMessage(error), secrets));
      }
      const state = await deps.queryJson<ResetState>(target.admin, resetStateSql());
      const ok = JSON.stringify(state) === JSON.stringify(EXPECTED_RESET_STATE);
      record(step, ok, ok ? undefined : state);
    };

    const handlerEnv = (outVariable: string, out: string, extra: Record<string, string> = {}) => ({
      ...baseChildEnv(),
      ...publicChildEnv(prismaUrl(target.public)),
      ...extra,
      [outVariable]: out,
    });
    const supplemental = supplementalChannels({
      programs: SUPPLEMENTAL_PROGRAMS,
      labels: CAPTURE_LABELS,
      directory: HERE,
      evidenceDir,
      inventoryTables: inventory.tables,
      admin: target.admin,
      secrets,
      deps,
      reset,
      childEnv: handlerEnv,
      record,
    });
    const capturePaths = new Map<string, string>();
    const indexPaths = new Map<string, string>();
    const capture = async (label: (typeof CAPTURE_LABELS)[number]) => {
      await reset(`${label} capture`);
      const out = join(evidenceDir, `capture-${label}.json`);
      capturePaths.set(label, out);
      record(
        `${label} capture: fresh child runs the scenario program (restricted public role)`,
        await deps.runSpec(
          "public-routes.g1.spec.ts",
          handlerEnv("G1_CAPTURE_OUT", out, { G1_CAPTURE_LABEL: label }),
          join(evidenceDir, `capture-${label}.log`),
          secrets,
        ),
      );
      const problems = validateCapture(readJson(out), SCENARIOS);
      record(`${label} capture matches the reviewed program outcomes`, problems.length === 0, {
        records: SCENARIOS.length,
        problems,
      });
      // The index consumes its own reset. Its extra exclusion fixtures never
      // alter the HTTP program or hide a changed public response in a new golden.
      await reset(`${label} index capture`);
      await deps.runPsql(target.admin, readFileSync(INDEX_FIXTURE_PATH, "utf8"), {
        singleTransaction: true,
        secrets,
      });
      const indexOut = join(evidenceDir, `index-${label}.json`);
      indexPaths.set(label, indexOut);
      record(
        `${label} index: fresh actual consumer child under the public runtime role`,
        await deps.runSpec(
          "index-consumer.g1.spec.ts",
          handlerEnv("G1_INDEX_CAPTURE_OUT", indexOut, { G1_INDEX_LABEL: label }),
          join(evidenceDir, `index-${label}.log`),
          secrets,
        ),
      );
      const indexProblems = indexCaptureProblems(readJson(indexOut) as IndexCapture);
      record(
        `${label} index matches populated outcomes and unchanged rows`,
        indexProblems.length === 0,
        indexProblems,
      );
      await supplemental.capture(label);
    };

    // 4. Baseline and its repeat, each after a reset, under the public role only.
    await capture("baseline");
    await capture("baseline-repeat");

    // 5. Empty private schema and private runtime role.
    await deps.runPsql(
      target.admin,
      provisionPrivateSql(target.admin.user, target.private.user, target.private.password),
      { singleTransaction: true, secrets },
    );
    created.privateSchema = true;
    created.privateRole = true;
    const emptyAfterProvision = await deps.queryJson<SchemaObjectCounts>(
      target.admin,
      schemaObjectCountsSql(PRIVATE_SCHEMA),
    );
    record(
      "provision empty private_ws and private runtime role",
      emptyAfterProvision.schemaExists && isEmptySchema(emptyAfterProvision),
      emptyAfterProvision,
    );
    const grantsAfter = await deps.queryJson(
      target.admin,
      publicGrantSnapshotSql(target.public.user),
    );
    record(
      "public role table and column grants unchanged by private provisioning",
      JSON.stringify(grantsAfter) === JSON.stringify(grantsBefore),
      grantsAfter,
    );

    // 6. After capture and its repeat, identical public role, each after a reset.
    await capture("after");
    await capture("after-repeat");

    // 7. Auth evidence in its own fresh child (production session functions, real contexts).
    await reset("auth evidence");
    const authEvidencePath = join(evidenceDir, "auth-evidence.json");
    record(
      "auth evidence: six principals and four invalid sessions (fresh child)",
      await deps.runSpec(
        "auth-context.g1.spec.ts",
        handlerEnv("G1_AUTH_EVIDENCE_OUT", authEvidencePath),
        join(evidenceDir, "auth-evidence.log"),
        secrets,
      ),
    );

    // 8. T-ROLE suite with runtime credentials only (no admin credential in the child).
    const roleEvidencePath = join(evidenceDir, "role-evidence.json");
    record(
      "T-ROLE suite (direct public/private runtime connections)",
      await deps.runSpec(
        "roles.g1.spec.ts",
        {
          ...baseChildEnv(),
          [G1_ENV.public]: prismaUrl(target.public),
          [G1_ENV.private]: prismaUrl(target.private),
          [G1_RUNTIME_ENV.adminRole]: target.admin.user,
          G1_ROLE_EVIDENCE_OUT: roleEvidencePath,
        },
        join(evidenceDir, "roles.log"),
        secrets,
      ),
    );
    const emptyAfterRoles = await deps.queryJson<SchemaObjectCounts>(
      target.admin,
      schemaObjectCountsSql(PRIVATE_SCHEMA),
    );
    record("private_ws still empty after T-ROLE probes", isEmptySchema(emptyAfterRoles), {
      emptyAfterRoles,
    });

    // 9. Paired comparisons (every capture against the baseline) and the reviewed golden.
    const captures = new Map(
      CAPTURE_LABELS.map((label) => [label, readJson(capturePaths.get(label)!)]),
    );
    const reference = captures.get("baseline");
    const indexes = new Map(
      CAPTURE_LABELS.map((label) => [label, readJson(indexPaths.get(label)!) as IndexCapture]),
    );
    const indexReference = indexes.get("baseline")!;
    for (const label of CAPTURE_LABELS.slice(1)) {
      const paired = comparePairedCaptures(reference, captures.get(label));
      record(`baseline and ${label} captures byte-identical`, paired.length === 0, paired);
      const indexDifferences = indexCaptureDifferences(indexReference, indexes.get(label)!);
      record(
        `baseline and ${label} canonical indexes and public rows identical`,
        indexDifferences.length === 0,
        indexDifferences,
      );
    }
    writeJson(join(evidenceDir, "index-golden-candidate.json"), indexReference);
    writeJson(
      join(evidenceDir, "golden-candidate.json"),
      goldenCandidate(reference, "CANDIDATE — not reviewed; never copied automatically"),
    );
    supplemental.compare();
    if (!existsSync(INDEX_GOLDEN_PATH))
      record(
        "reviewed index golden present",
        false,
        "index-golden-candidate.json written; independent review required",
      );
    const indexGolden = readJson(INDEX_GOLDEN_PATH) as IndexCapture;
    const indexGoldenDifferences = CAPTURE_LABELS.flatMap((label) =>
      indexCaptureDifferences(indexGolden, indexes.get(label)!).map(
        (difference) => `${label}: ${difference}`,
      ),
    );
    record(
      "all canonical indexes and public rows match the reviewed index golden",
      indexGoldenDifferences.length === 0,
      indexGoldenDifferences,
    );
    if (!existsSync(GOLDEN_PATH)) {
      record("reviewed golden baseline present", false, "golden-candidate.json written");
    }
    const golden = readJson(GOLDEN_PATH);
    const goldenDifferences = CAPTURE_LABELS.flatMap((label) =>
      compareWithGolden(captures.get(label), golden, SCENARIOS).map(
        (difference) => `${label}: ${difference}`,
      ),
    );
    record("captures match the reviewed golden baseline", goldenDifferences.length === 0, {
      differences: goldenDifferences,
    });
    summary.manifest = {
      coverage: coverageSummary(APP_DIRECTORY, [
        ...SCENARIOS,
        ...SUPPLEMENTAL_PROGRAMS.flatMap((program) => program.scenarios),
      ]),
      programs: [
        { name: "public-routes", records: SCENARIOS.length },
        ...SUPPLEMENTAL_PROGRAMS.map((program) => ({
          name: program.name,
          records: program.scenarios.length,
        })),
      ],
      surfaces: SURFACES,
      principals: PRINCIPALS,
    };
    exitCode = 0;
  } catch (error) {
    if (error instanceof RefusedBeforeMutation) {
      exitCode = 2;
    } else {
      if (!(error instanceof HarnessFailure)) {
        const message = redact(error instanceof PsqlError ? error.message : String(error), secrets);
        steps.push({ step: "unexpected error", ok: false, detail: message });
        console.error(`[g1] ${message}`);
      }
      exitCode = 1;
    }
  }

  // Cleanup runs after every outcome, attempts every recorded resource, and its result decides the
  // final status: a check that passed is never reported as passed while cleanup failed.
  const cleanupSteps = await cleanup(target, created, secrets, deps);
  summary.cleanup = cleanupSteps;
  const failedCleanup = cleanupSteps.filter((step) => !step.ok).map((step) => step.step);
  if (failedCleanup.length > 0) exitCode = 1;
  if (exitCode !== 0) {
    summary.failure = {
      // The first failing check is kept even when cleanup also failed.
      check: steps.find((step) => !step.ok)?.step ?? null,
      cleanup: failedCleanup,
    };
  }
  summary.result =
    exitCode === 0
      ? "passed (G1-empty partial coverage only)"
      : exitCode === 2
        ? "refused before mutation"
        : failedCleanup.length > 0
          ? "failed (cleanup incomplete; run-created resources may remain)"
          : "failed";
  writeJson(join(evidenceDir, "summary.json"), summary);
  log(`summary: ${join(evidenceDir, "summary.json")}`);
  log(`result: ${String(summary.result)}`);
  return exitCode;
}

/** Remove only resources this run proved it created; report anything left behind. Never throws. */
async function cleanup(
  target: G1Target,
  created: CreatedResources,
  secrets: readonly string[],
  deps: G1HarnessDeps,
): Promise<Step[]> {
  const results: Step[] = [];
  // The SQL is built inside the guarded block so a builder error is a recorded failure too.
  const attempt = async (step: string, sql: () => string) => {
    try {
      await deps.runPsql(target.admin, sql(), { singleTransaction: true, secrets });
      results.push({ step, ok: true });
    } catch (error) {
      results.push({ step, ok: false, detail: redact(errorMessage(error), secrets) });
    }
  };
  if (created.privateRole) {
    await attempt("drop private role", () => dropRoleSql(target.private.user));
  }
  if (created.publicRole) {
    await attempt("drop public role", () => dropRoleSql(target.public.user));
  }
  if (created.privateSchema) await attempt("drop empty private_ws", dropPrivateSchemaSql);
  const publicObjects = created.publicObjects;
  if (publicObjects) {
    await attempt("drop run-created public objects", () =>
      dropRecordedPublicObjectsSql(publicObjects),
    );
  }
  for (const result of results) log(`cleanup ${result.ok ? "ok  " : "FAIL"} ${result.step}`);
  return results;
}
