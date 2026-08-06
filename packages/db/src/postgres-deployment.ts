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

export function baselineSchemaUrl(databaseUrl: string, schema: string): string {
  if (!/^oratlas_baseline_[a-f0-9]{20}$/.test(schema)) {
    throw new Error("Invalid temporary baseline schema name.");
  }
  const parsed = new URL(databaseUrl);
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("The PostgreSQL deployment wrapper requires a PostgreSQL DATABASE_URL.");
  }
  parsed.searchParams.set("schema", schema);
  return parsed.toString();
}

export function baselineDatamodelForPublicSchema(
  datamodel: string,
  temporarySchema: string,
): string {
  if (!/^oratlas_baseline_[a-f0-9]{20}$/.test(temporarySchema)) {
    throw new Error("Invalid temporary baseline schema name.");
  }
  const datasourceSchemas = new RegExp(
    `^\\s*schemas\\s*=\\s*\\["${temporarySchema}"\\]\\s*$`,
    "gm",
  );
  const modelSchema = new RegExp(`^\\s*@@schema\\("${temporarySchema}"\\)\\s*$`, "gm");
  const baselineDatasourceUrl = /env\("ORATLAS_BASELINE_DATABASE_URL"\)/g;
  const normalized = datamodel
    .replace(datasourceSchemas, "")
    .replace(modelSchema, "")
    .replace(baselineDatasourceUrl, 'env("DATABASE_URL")');
  if (normalized.includes(temporarySchema)) {
    throw new Error("Temporary baseline schema leaked into the normalized datamodel.");
  }
  if (normalized.includes("ORATLAS_BASELINE_DATABASE_URL")) {
    throw new Error("Temporary baseline datasource leaked into the normalized datamodel.");
  }
  return normalized;
}
