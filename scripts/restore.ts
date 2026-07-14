/**
 * Database restore helper — inverse of scripts/backup.ts.
 *
 * Usage: npx tsx scripts/restore.ts <path-to-backup>
 *
 * For a SQLite `file:` DATABASE_URL, copies the given backup file over the live
 * database file (overwriting it). For any non-file URL (e.g. Postgres) it prints
 * pg_restore / psql guidance and exits 0. Never operates without an explicit
 * backup path argument, and never deletes anything.
 */
import { copyFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { filePathFromUrl } from "./backup.js";

function main(): void {
  const backupArg = process.argv[2];
  const url = process.env.DATABASE_URL ?? "file:./dev.db";

  if (!backupArg) {
    console.error("Usage: npx tsx scripts/restore.ts <path-to-backup>");
    console.error("  Restores a backup created by scripts/backup.ts.");
    process.exit(1);
  }

  if (!url.startsWith("file:")) {
    console.info("DATABASE_URL is not a SQLite file: URL — no file copy performed.");
    console.info("To restore a Postgres database from a dump, run (operator action):\n");
    console.info(`  pg_restore --clean --if-exists -d "${url}" "${backupArg}"`);
    console.info(`  # or, for a plain SQL dump:  psql "${url}" -f "${backupArg}"\n`);
    process.exit(0);
  }

  const backupPath = isAbsolute(backupArg) ? backupArg : resolve(process.cwd(), backupArg);
  if (!existsSync(backupPath)) {
    console.error(`✗ Backup file not found: ${backupPath}`);
    process.exit(1);
  }

  const rawPath = filePathFromUrl(url);
  const dbPath = isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);

  console.warn("⚠ This OVERWRITES the current database with the backup:");
  console.warn(`    database: ${dbPath}`);
  console.warn(`    backup:   ${backupPath}`);

  copyFileSync(backupPath, dbPath);

  console.info("✓ Restore complete. The database now reflects the backup contents.");
}

main();
