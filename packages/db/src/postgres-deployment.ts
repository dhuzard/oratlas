export const POSTGRES_BASELINE_MIGRATION = "20260805000000_existing_schema_baseline" as const;

export type PostgresDeploymentAction =
  "bootstrap-schema" | "resolve-baseline" | "migrate-deploy" | "apply-guards";

export interface PostgresDeploymentPreflight {
  hasMigrationTable: boolean;
  applicationTableCount: number;
  /** Prisma migrate diff: 0=no drift, 1=error, 2=drift. */
  schemaDiffExitCode?: number;
}

export function planPostgresDeployment(
  input: PostgresDeploymentPreflight,
): PostgresDeploymentAction[] {
  if (input.hasMigrationTable) return ["migrate-deploy", "apply-guards"];
  if (input.applicationTableCount === 0) {
    return ["bootstrap-schema", "resolve-baseline", "migrate-deploy", "apply-guards"];
  }
  if (input.schemaDiffExitCode !== 0) {
    throw new Error(
      input.schemaDiffExitCode === 2
        ? "Existing PostgreSQL schema differs from the reviewed baseline."
        : "Existing PostgreSQL schema could not be compared with the reviewed baseline.",
    );
  }
  return ["resolve-baseline", "migrate-deploy", "apply-guards"];
}

export function assertProductionBackupId(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._/-]{1,300}$/.test(value)) {
    throw new Error("A verified ORATLAS_SCHEMA_BACKUP_ID is required in production.");
  }
  return value;
}
