import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { POSTGRES_DATABASE_GUARD_SQL } from "../src/database-guards.js";

const target = join(import.meta.dirname, "..", "prisma", "schema.postgres.sql");

appendFileSync(
  target,
  `\n\n-- Database-native guards also applied after Prisma db push.\n${POSTGRES_DATABASE_GUARD_SQL.map((statement) => `${statement};`).join("\n\n")}\n`,
  "utf8",
);
