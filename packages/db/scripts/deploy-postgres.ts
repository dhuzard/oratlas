import { spawnSync } from "node:child_process";
import { applyDatabaseGuards } from "../src/database-guards.js";
import { getPrisma } from "../src/index.js";
import {
  assertProductionBackupId,
  planPostgresDeployment,
  POSTGRES_BASELINE_MIGRATION,
  type PostgresDeploymentAction,
} from "../src/postgres-deployment.js";

function runPrisma(args: string[], allowedExitCodes: number[] = [0]): number {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(executable, ["exec", "prisma", ...args], {
    cwd: new URL("..", import.meta.url),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (!allowedExitCodes.includes(status)) {
    throw new Error(`Prisma command failed with exit code ${status}.`);
  }
  return status;
}

async function tableNames(): Promise<string[]> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  return rows.map((row) => row.table_name);
}

async function execute(action: PostgresDeploymentAction): Promise<void> {
  switch (action) {
    case "bootstrap-schema":
      runPrisma([
        "db",
        "execute",
        "--file",
        "prisma/baseline/20260805000000_existing_schema_baseline.sql",
        "--schema",
        "prisma/schema.postgres.prisma",
      ]);
      return;
    case "resolve-baseline":
      runPrisma([
        "migrate",
        "resolve",
        "--applied",
        POSTGRES_BASELINE_MIGRATION,
        "--schema",
        "prisma/schema.postgres.prisma",
      ]);
      return;
    case "migrate-deploy":
      runPrisma(["migrate", "deploy", "--schema", "prisma/schema.postgres.prisma"]);
      return;
    case "apply-guards":
      await applyDatabaseGuards(getPrisma(), "postgresql");
  }
}

const prisma = getPrisma();
try {
  if (process.env.NODE_ENV === "production") {
    const backupId = assertProductionBackupId(process.env.ORATLAS_SCHEMA_BACKUP_ID);
    console.info(`[postgres-deploy] verified backup gate id ${backupId}`);
  }
  const tables = await tableNames();
  const hasMigrationTable = tables.includes("_prisma_migrations");
  const applicationTableCount = tables.filter((table) => table !== "_prisma_migrations").length;
  let schemaDiffExitCode: number | undefined;
  if (!hasMigrationTable && applicationTableCount > 0) {
    schemaDiffExitCode = runPrisma(
      [
        "migrate",
        "diff",
        "--from-schema-datasource",
        "prisma/schema.postgres.prisma",
        "--to-schema-datamodel",
        "prisma/schema.postgres.prisma",
        "--exit-code",
      ],
      [0, 2],
    );
  }
  const actions = planPostgresDeployment({
    hasMigrationTable,
    applicationTableCount,
    schemaDiffExitCode,
  });
  for (const action of actions) {
    console.info(`[postgres-deploy] ${action}`);
    await execute(action);
  }
} finally {
  await prisma.$disconnect();
}
