import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..");
const script = readFileSync(resolve(root, "scripts/cloudsql-backup-gate.sh"), "utf8");
const build = parse(readFileSync(resolve(root, "cloudbuild.yaml"), "utf8")) as {
  steps: Array<{ id: string; args?: string[] }>;
};

describe("Cloud SQL pre-migration backup gate", () => {
  it("fails closed on data-protection settings and verifies the synchronous backup", () => {
    expect(script).toContain("settings.backupConfiguration.enabled");
    expect(script).toContain("settings.backupConfiguration.pointInTimeRecoveryEnabled");
    expect(script).toContain('backups_enabled" != "true"');
    expect(script).toContain('pitr_enabled" != "true"');

    const create = script.indexOf("sql backups create");
    const list = script.indexOf("sql backups list");
    const describe = script.indexOf("sql backups describe");
    const success = script.indexOf('backup_status" != "SUCCESS"');
    const record = script.indexOf('>"${output_path}.tmp"');
    expect(create).toBeGreaterThan(0);
    expect(list).toBeGreaterThan(create);
    expect(describe).toBeGreaterThan(list);
    expect(success).toBeGreaterThan(describe);
    expect(record).toBeGreaterThan(success);
    expect(script.slice(create, list)).not.toContain("--async");
  });

  it("runs after image push and gates the unchanged migration command", () => {
    const ids = build.steps.map((step) => step.id);
    expect(ids.indexOf("backup-database")).toBeGreaterThan(ids.indexOf("push"));
    expect(ids.indexOf("backup-database")).toBeLessThan(ids.indexOf("configure-migration-job"));
    expect(ids.indexOf("backup-database")).toBeLessThan(ids.indexOf("migrate-database"));

    const configure = build.steps.find((step) => step.id === "configure-migration-job");
    const configureCommand = configure?.args?.join("\n") ?? "";
    expect(configureCommand).toContain("--args=db:deploy:postgres");
    expect(configureCommand).toContain("ORATLAS_SCHEMA_BACKUP_ID");

    const migrate = build.steps.find((step) => step.id === "migrate-database");
    const command = migrate?.args?.join("\n") ?? "";
    expect(command).toContain("/workspace/oratlas-cloudsql-backup-id");
    expect(command).toContain('gcloud run jobs execute "${_SERVICE}-migrate"');
  });
});
