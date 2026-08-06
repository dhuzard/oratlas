import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..");
const scriptPath = resolve(root, "scripts/cloudsql-backup-gate.sh");
const script = readFileSync(scriptPath, "utf8");
const build = parse(readFileSync(resolve(root, "cloudbuild.yaml"), "utf8")) as {
  steps: Array<{ id: string; args?: string[] }>;
};
const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runGate(
  configuration = "True,True",
  status = "SUCCESSFUL",
  backupId = "backupRuns/prod_123.4",
  argumentStyle: "split" | "equals" = "split",
) {
  const directory = mkdtempSync(join(tmpdir(), "oratlas-cloudsql-gate-"));
  temporaryDirectories.push(directory);
  const fakeGcloud = join(directory, "gcloud");
  const output = join(directory, "backup-id");
  writeFileSync(
    fakeGcloud,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FAKE_GCLOUD_LOG"
if [[ "$1 $2 $3" == "sql instances describe" ]]; then printf '%s\\n' "$FAKE_CONFIGURATION"; exit 0; fi
if [[ "$1 $2 $3" == "sql backups create" ]]; then
  for argument in "$@"; do case "$argument" in --description=*) printf '%s' "\${argument#--description=}" > "$FAKE_DESCRIPTION";; esac; done
  exit 0
fi
if [[ "$1 $2 $3" == "sql backups list" ]]; then printf '%s\\n' "$FAKE_BACKUP_ID"; exit 0; fi
if [[ "$1 $2 $3" == "sql backups describe" ]]; then printf '%s,%s,%s\\n' "$FAKE_BACKUP_ID" "$FAKE_STATUS" "$(cat "$FAKE_DESCRIPTION")"; exit 0; fi
exit 64
`,
    "utf8",
  );
  chmodSync(fakeGcloud, 0o755);
  const result = spawnSync(
    "bash",
    argumentStyle === "equals"
      ? [
          scriptPath,
          "--project=oratlas-prod1",
          "--instance=oratlas-postgres",
          "--build-id=build-1",
          `--output=${output}`,
        ]
      : [
          scriptPath,
          "--project",
          "oratlas-prod1",
          "--instance",
          "oratlas-postgres",
          "--build-id",
          "build-1",
          "--output",
          output,
        ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GCLOUD_BIN: fakeGcloud,
        FAKE_CONFIGURATION: configuration,
        FAKE_STATUS: status,
        FAKE_BACKUP_ID: backupId,
        FAKE_DESCRIPTION: join(directory, "description"),
        FAKE_GCLOUD_LOG: join(directory, "gcloud.log"),
      },
    },
  );
  return { directory, output, result };
}

describe("Cloud SQL pre-migration backup gate", () => {
  it.runIf(process.platform !== "win32")(
    "records only the exact synchronously created successful backup",
    () => {
      const { directory, output, result } = runGate();
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(output, "utf8")).toBe("backupRuns/prod_123.4\n");
      const commands = readFileSync(join(directory, "gcloud.log"), "utf8");
      expect(commands).toContain("sql instances describe");
      expect(commands).toContain("sql backups create");
      expect(commands).not.toContain("--async");
      expect(commands.indexOf("sql backups create")).toBeLessThan(
        commands.indexOf("sql backups list"),
      );
      expect(commands.indexOf("sql backups list")).toBeLessThan(
        commands.indexOf("sql backups describe"),
      );
    },
  );

  it.runIf(process.platform !== "win32")(
    "accepts the equals-style arguments used by Cloud Build",
    () => {
      const { output, result } = runGate("True,True", "SUCCESSFUL", "backup-123", "equals");
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(output, "utf8")).toBe("backup-123\n");
    },
  );

  it.runIf(process.platform !== "win32")("fails closed when PITR is disabled", () => {
    const { output, result } = runGate("True,False");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("point-in-time recovery");
    expect(() => readFileSync(output)).toThrow();
  });

  it.runIf(process.platform !== "win32")("does not record a failed backup", () => {
    const { output, result } = runGate("True,True", "FAILED");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SUCCESSFUL");
    expect(() => readFileSync(output)).toThrow();
  });

  it.runIf(process.platform !== "win32")("rejects an unsafe opaque backup id", () => {
    const { output, result } = runGate("True,True", "SUCCESSFUL", "backup;drop-table");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unsafe characters");
    expect(() => readFileSync(output)).toThrow();
  });

  it("stages traffic only after the backup-gated migration and smoke", () => {
    expect(script).toContain('backup_status" != "SUCCESSFUL"');
    const ids = build.steps.map((step) => step.id);
    expect(ids).toEqual([
      "build",
      "push",
      "backup-database",
      "configure-migration-job",
      "migrate-database",
      "configure-canonical-backfill-job",
      "backfill-and-enforce-canonical-graph",
      "deploy-service",
      "verify-beta-journey",
      "promote-service",
    ]);
    const deploy = build.steps.find(({ id }) => id === "deploy-service")?.args?.join("\n") ?? "";
    expect(deploy).toContain("--no-traffic");
    expect(deploy).toContain("--tag=");
    expect(deploy).toContain("CANDIDATE_TAG_MAX_LENGTH=$$((46 - $${#SERVICE_NAME}))");
    const promote = build.steps.find(({ id }) => id === "promote-service")?.args?.join("\n") ?? "";
    expect(promote).toContain("--to-tags=");
    const configureMigration =
      build.steps.find(({ id }) => id === "configure-migration-job")?.args?.join("\n") ?? "";
    expect(configureMigration).toContain("backup id file is missing");
    const configureBackfill =
      build.steps.find(({ id }) => id === "configure-canonical-backfill-job")?.args?.join("\n") ??
      "";
    expect(configureBackfill).toContain("--all,--finalize-contract");
    expect(configureBackfill).toContain("ORATLAS_SCHEMA_BACKUP_ID");
    expect(rootPackage.scripts["backfill:canonical-graph"]).toContain(
      "pnpm --filter @oratlas/db exec tsx",
    );
  });
});
