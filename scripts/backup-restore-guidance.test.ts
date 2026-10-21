import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Exercise the real CLIs; these non-file branches must remain guidance-only.
const marker = "synthetic-secret-marker-NOT-FOR-OUTPUT";
const url = `postgresql://synthetic-user:${marker}@127.0.0.1:1/synthetic-database`;
const run = (script: string, args: string[] = []) =>
  execFileSync(process.execPath, ["--import", "tsx", resolve("scripts", script), ...args], {
    env: { DATABASE_URL: url },
    encoding: "utf8",
    timeout: 10_000,
  });

it("prints usable backup guidance without disclosing the database URL or password", () => {
  const output = run("backup.ts");
  expect(output).toContain('pg_dump "$DATABASE_URL" -Fc -f backup.dump');
  expect(output).toContain("no file copy performed");
  expect(output).not.toContain(marker);
  expect(output).not.toContain(url);
  expect(output).not.toContain("synthetic-user");
});

it("prints both restore commands without disclosing credentials or interpolating the backup path", () => {
  const path = `unused-${marker}-$(must-not-run).dump`;
  const output = run("restore.ts", [path]);
  expect(output).toContain('pg_restore --clean --if-exists -d "$DATABASE_URL" "$BACKUP_PATH"');
  expect(output).toContain('psql "$DATABASE_URL" -f "$BACKUP_PATH"');
  expect(output).toContain("Set BACKUP_PATH to the supplied dump path");
  expect(output).toContain("no file copy performed");
  expect(output).not.toContain(marker);
  expect(output).not.toContain(url);
  expect(output).not.toContain(path);
});
