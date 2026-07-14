/**
 * Database backup helper.
 *
 * For a SQLite `file:` DATABASE_URL, copies the database file to
 * `backups/<basename>.<UTC-timestamp>.bak`. For any non-file URL (e.g. Postgres)
 * it prints the recommended `pg_dump` command instead — dumping a live Postgres
 * is an operator action, not something this script performs.
 *
 * Node built-ins only. Never deletes anything.
 */
import { copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Filesystem-safe UTC timestamp, e.g. 2026-07-14T12-30-00-000Z. */
export function utcStamp(date = new Date()): string {
  return date.toISOString().replace(/:/g, "-");
}

/** Strip the `file:` scheme and return the raw filesystem path. */
export function filePathFromUrl(url: string): string {
  // Supports file:./dev.db, file:dev.db, file:/abs/path, file:///abs/path.
  let p = url.replace(/^file:/, "");
  p = p.replace(/^\/\/(?=\/)/, ""); // file:///abs -> /abs
  return p;
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..");
  const url = process.env.DATABASE_URL ?? "file:./dev.db";

  if (!url.startsWith("file:")) {
    console.info("DATABASE_URL is not a SQLite file: URL — no file copy performed.");
    console.info("To back up a Postgres database, run (operator action):\n");
    console.info(`  pg_dump "${url}" -Fc -f backup.dump\n`);
    console.info("Store the dump securely; restore with pg_restore (see scripts/restore.ts).");
    process.exit(0);
  }

  const rawPath = filePathFromUrl(url);
  const dbPath = isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);

  if (!existsSync(dbPath)) {
    console.error(`✗ SQLite database not found at: ${dbPath}`);
    console.error("  (resolved from DATABASE_URL relative to the current working directory)");
    process.exit(1);
  }

  const backupsDir = join(repoRoot, "backups");
  mkdirSync(backupsDir, { recursive: true });

  const target = join(backupsDir, `${basename(dbPath)}.${utcStamp()}.bak`);
  copyFileSync(dbPath, target);

  console.info(`✓ Backed up SQLite database`);
  console.info(`  from: ${dbPath}`);
  console.info(`  to:   ${target}`);
}

// Run only when invoked directly, so importing this module (e.g. from
// restore.ts for filePathFromUrl) does not trigger a backup as a side effect.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
