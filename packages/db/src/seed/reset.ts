/**
 * Delete the local SQLite development database so `db:reset` can re-push and
 * re-seed from scratch. This avoids `prisma db push --force-reset`, which
 * newer Prisma versions gate behind an interactive consent prompt.
 *
 * SQLite / development only. For PostgreSQL, use a proper migration reset.
 */
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
if (!url.startsWith("file:")) {
  console.error(
    `Refusing to reset a non-file database (${url}). db:reset is for local SQLite only.`,
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
// Prisma resolves SQLite paths relative to the schema directory (packages/db/prisma).
const schemaDir = join(here, "..", "..", "prisma");
const rel = url.slice("file:".length);
const dbPath = rel.startsWith("/") ? rel : join(schemaDir, rel);

for (const path of [dbPath, `${dbPath}-journal`]) {
  if (existsSync(path)) {
    rmSync(path);
    console.info(`Removed ${path}`);
  }
}
console.info("Local database reset; run db push + seed next.");
