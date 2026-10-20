import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { G1_BASE_URL, type CaptureFile } from "./capture.js";
import {
  comparePairedCaptures,
  compareWithGolden,
  goldenCandidate,
  type GoldenFile,
} from "./compare.js";
import { G1_COVERAGE_STATUS, PRINCIPALS, SURFACES } from "./manifest.js";
import { PsqlError, queryJson, redact, runPsql } from "./postgres.js";
import {
  createPublicRoleSql,
  dropPrivateSchemaSql,
  dropRecordedPublicObjectsSql,
  dropRoleSql,
  isEmptySchema,
  preflightSql,
  provisionPrivateSql,
  PUBLIC_OBJECT_INVENTORY_SQL,
  publicGrantSnapshotSql,
  schemaObjectCountsSql,
  type PublicObjectInventory,
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
 * public role → BASELINE capture → empty private_ws + private role → AFTER capture → T-ROLE suite
 * → compare captures/golden → clean up only run-created resources → write sanitized evidence.
 * Exit codes: 0 passed (every check and every cleanup step succeeded), 1 a check or a cleanup step
 * failed, 2 target refused before any mutation. `run.ts` is the CLI entry point.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DDL_PATH = resolve(ROOT, "packages/db/prisma/schema.postgres.sql");
const FIXTURE_PATH = resolve(HERE, "fixtures/public-fixtures.sql");
const GOLDEN_PATH = resolve(HERE, "baselines/public-routes.golden.json");
const VITEST_CONFIG = resolve(HERE, "vitest.config.ts");
/** Non-secret constant: the capture process must not fall back to the development secret. */
const CAPTURE_SESSION_SECRET = "g1-capture-only-not-a-secret";

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
    env: Record<string, string>,
    logPath: string,
    secrets: readonly string[],
  ) => Promise<boolean>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function log(message: string): void {
  console.info(`[g1] ${message}`);
}

function secretsOf(target: G1Target): string[] {
  return [target.admin.password, target.public.password, target.private.password];
}

function baseChildEnv(): Record<string, string> {
  const env: Record<string, string> = { LANG: "C.UTF-8", NODE_ENV: "test" };
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
  env: Record<string, string>,
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
      const output = redact(Buffer.concat(chunks).toString("utf8"), secrets);
      writeFileSync(logPath, output, { mode: 0o600 });
      process.stdout.write(output);
      resolvePromise(code === 0);
    });
  });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
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
  env: NodeJS.ProcessEnv,
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
    created.publicObjects = await deps.queryJson<PublicObjectInventory>(
      target.admin,
      PUBLIC_OBJECT_INVENTORY_SQL,
    );
    record("bootstrap public schema from schema.postgres.sql", true, {
      tables: created.publicObjects.tables.length,
      functions: created.publicObjects.functions.length,
    });
    await deps.runPsql(target.admin, readFileSync(FIXTURE_PATH, "utf8"), {
      singleTransaction: true,
      secrets,
    });
    record("load deterministic public fixtures", true);

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
    record("create restricted public runtime role", true, grantsBefore);

    // 4. Baseline capture under the public role only.
    const captureEnv = (label: string, out: string) => ({
      ...baseChildEnv(),
      DATABASE_URL: prismaUrl(target.public),
      NEXT_PUBLIC_BASE_URL: G1_BASE_URL,
      SESSION_SECRET: CAPTURE_SESSION_SECRET,
      G1_CAPTURE_LABEL: label,
      G1_CAPTURE_OUT: out,
    });
    const baselinePath = join(evidenceDir, "capture-baseline.json");
    record(
      "baseline public capture (restricted public role)",
      await deps.runSpec(
        "public-routes.g1.spec.ts",
        captureEnv("baseline", baselinePath),
        join(evidenceDir, "capture-baseline.log"),
        secrets,
      ),
    );

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
      "public role grants unchanged by private provisioning",
      JSON.stringify(grantsAfter) === JSON.stringify(grantsBefore),
      grantsAfter,
    );

    // 6. After capture, identical public role and fixtures.
    const afterPath = join(evidenceDir, "capture-after.json");
    record(
      "after public capture (restricted public role)",
      await deps.runSpec(
        "public-routes.g1.spec.ts",
        captureEnv("after", afterPath),
        join(evidenceDir, "capture-after.log"),
        secrets,
      ),
    );

    // 7. T-ROLE suite with runtime credentials only (no admin credential in the child).
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

    // 8. Compare paired captures and the reviewed golden baseline.
    const baseline = readJson<CaptureFile>(baselinePath);
    const after = readJson<CaptureFile>(afterPath);
    const paired = comparePairedCaptures(baseline, after);
    record("baseline and after captures byte-identical", paired.length === 0, paired);
    writeJson(
      join(evidenceDir, "golden-candidate.json"),
      goldenCandidate(baseline, "CANDIDATE — not reviewed; never copied automatically"),
    );
    if (!existsSync(GOLDEN_PATH)) {
      record("reviewed golden baseline present", false, "golden-candidate.json written");
    }
    const golden = readJson<GoldenFile>(GOLDEN_PATH);
    const goldenDifferences = [
      ...compareWithGolden(baseline, golden),
      ...compareWithGolden(after, golden),
    ];
    record("captures match the reviewed golden baseline", goldenDifferences.length === 0, {
      differences: goldenDifferences,
      routes: golden.routes.map((route) => `${route.id}:${route.status}`),
    });
    summary.manifest = { surfaces: SURFACES, principals: PRINCIPALS };
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
