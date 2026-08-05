import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertProductionBackupId, planPostgresDeployment } from "./postgres-deployment.js";

describe("PostgreSQL deployment planning", () => {
  it("keeps an immutable baseline DDL separate from the evolving bootstrap schema", () => {
    const packageRoot = resolve(import.meta.dirname, "..");
    const baseline = readFileSync(
      resolve(packageRoot, "prisma/baseline/20260805000000_existing_schema_baseline.sql"),
      "utf8",
    );
    expect(baseline).toContain('CREATE TABLE "KnowledgeNode"');
    expect(baseline).not.toContain('CREATE TABLE "_prisma_migrations"');
  });

  it("bootstraps only an empty database before resolving the baseline", () => {
    expect(planPostgresDeployment({ hasMigrationTable: false, applicationTableCount: 0 })).toEqual([
      "bootstrap-schema",
      "resolve-baseline",
      "migrate-deploy",
      "apply-guards",
    ]);
  });

  it("baselines a populated database only after an empty schema diff", () => {
    expect(
      planPostgresDeployment({
        hasMigrationTable: false,
        applicationTableCount: 84,
        schemaDiffExitCode: 0,
      }),
    ).toEqual(["resolve-baseline", "migrate-deploy", "apply-guards"]);
    expect(() =>
      planPostgresDeployment({
        hasMigrationTable: false,
        applicationTableCount: 84,
        schemaDiffExitCode: 2,
      }),
    ).toThrow(/differs/i);
    expect(() =>
      planPostgresDeployment({
        hasMigrationTable: false,
        applicationTableCount: 84,
        schemaDiffExitCode: 1,
      }),
    ).toThrow(/could not be compared/i);
  });

  it("uses migration history once the baseline exists", () => {
    expect(planPostgresDeployment({ hasMigrationTable: true, applicationTableCount: 84 })).toEqual([
      "migrate-deploy",
      "apply-guards",
    ]);
  });

  it("requires a bounded recorded backup id in production", () => {
    expect(assertProductionBackupId("1234567890")).toBe("1234567890");
    expect(() => assertProductionBackupId(undefined)).toThrow(/backup/i);
    expect(() => assertProductionBackupId("bad value")).toThrow(/backup/i);
  });
});
