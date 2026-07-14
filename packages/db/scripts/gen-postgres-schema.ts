import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Generate the PostgreSQL variant of the Prisma schema (issue #7).
 *
 * The canonical schema targets SQLite for zero-config local development, but it
 * deliberately avoids provider-specific features so production can run on
 * PostgreSQL. This script derives `schema.postgres.prisma` from the canonical
 * schema by swapping only the datasource provider — nothing else — so the two
 * can never drift in their models. CI pushes and seeds the generated schema
 * against a real Postgres service, and checks the committed DDL for drift.
 */
const prismaDir = join(import.meta.dirname, "..", "prisma");
const source = join(prismaDir, "schema.prisma");
const target = join(prismaDir, "schema.postgres.prisma");

const original = readFileSync(source, "utf8");

const swapped = original.replace(/datasource\s+db\s*\{[^}]*\}/m, (block) =>
  block.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"'),
);

if (!/provider\s*=\s*"postgresql"/.test(swapped)) {
  console.error("[gen-postgres-schema] failed to swap datasource provider to postgresql.");
  process.exit(1);
}

const header =
  "// GENERATED FILE — do not edit by hand.\n" +
  "// Produced from schema.prisma by `pnpm --filter @oratlas/db db:pg:schema`.\n" +
  "// Only the datasource provider differs (postgresql); models are identical.\n\n";

writeFileSync(target, header + swapped, "utf8");
console.log(`[gen-postgres-schema] wrote ${target}`);
