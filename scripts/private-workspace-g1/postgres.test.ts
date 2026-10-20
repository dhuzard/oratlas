import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  PSQL_ARGS,
  psqlInvocation,
  quoteIdent,
  quoteLiteral,
  redact,
  runPsql,
} from "./postgres.js";
import {
  createPublicRoleSql,
  dropRecordedPublicObjectsSql,
  FIXTURE_PUBLIC_TABLES,
  isEmptySchema,
  probeSql,
  provisionPrivateSql,
  type SchemaObjectCounts,
} from "./sql.js";
import type { G1Connection } from "./target.js";

// Offline: argument/SQL construction and a fake `psql` on a private PATH. No database is contacted.
const connection: G1Connection = {
  host: "localhost",
  port: 55432,
  database: "oratlas_g1",
  user: "oratlas_g1_public",
  password: "pw-'quoted'-SECRET",
};

const fakeBin = mkdtempSync(join(tmpdir(), "oratlas-g1-fake-psql-"));
afterAll(() => rmSync(fakeBin, { recursive: true, force: true }));

function fakePsql(script: string): string {
  writeFileSync(join(fakeBin, "psql"), `#!/bin/sh\n${script}\n`);
  chmodSync(join(fakeBin, "psql"), 0o755);
  return `${fakeBin}:/usr/bin:/bin`;
}

describe("safe psql adapter", () => {
  it("passes no host, user, database or password in argv", () => {
    const invocation = psqlInvocation(connection, { path: "/usr/bin" });
    expect(invocation.command).toBe("psql");
    expect(invocation.args).toEqual([...PSQL_ARGS]);
    expect(invocation.args).toContain("-X");
    expect(invocation.args).toContain("--no-password");
    expect(invocation.args).toContain("ON_ERROR_STOP=1");
    expect(invocation.args.join(" ")).not.toMatch(/SECRET|localhost|oratlas_g1/u);
  });

  it("builds a closed child environment that ambient PG* variables cannot redirect", () => {
    const previous = { PGHOST: process.env.PGHOST, PGSERVICE: process.env.PGSERVICE };
    process.env.PGHOST = "db.example.com";
    process.env.PGSERVICE = "production";
    try {
      const { env } = psqlInvocation(connection, { path: "/usr/bin" });
      expect(Object.keys(env).sort()).toEqual(
        [
          "LANG",
          "LC_ALL",
          "PATH",
          "PGAPPNAME",
          "PGCONNECT_TIMEOUT",
          "PGDATABASE",
          "PGHOST",
          "PGOPTIONS",
          "PGPASSFILE",
          "PGPASSWORD",
          "PGPORT",
          "PGSERVICEFILE",
          "PGSSLMODE",
          "PGSYSCONFDIR",
          "PGUSER",
        ].sort(),
      );
      expect(env).toMatchObject({
        PGHOST: "localhost",
        PGPORT: "55432",
        PGPASSFILE: "/dev/null",
        PGSERVICEFILE: "/dev/null",
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("delivers SQL on stdin and returns stdout", async () => {
    const path = fakePsql('cat; printf "|%s" "$PGUSER"');
    await expect(runPsql(connection, "SELECT 1;", { path })).resolves.toBe(
      "SELECT 1;|oratlas_g1_public",
    );
  });

  it("redacts the password and URLs from failures", async () => {
    const path = fakePsql(
      'cat >/dev/null; echo "FATAL: password $PGPASSWORD for postgresql://u:$PGPASSWORD@h/db" >&2; exit 2',
    );
    const error = await runPsql(connection, "SELECT 1;", { path }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("[redacted]");
    expect((error as Error).message).not.toContain("SECRET");
  });

  it("kills a hung psql at the timeout", async () => {
    const path = fakePsql("sleep 5");
    await expect(runPsql(connection, "", { path, timeoutMs: 100 })).rejects.toThrow(/timed out/);
  });

  it("quotes only safe identifiers and escapes literals", () => {
    expect(quoteIdent("oratlas_g1_public")).toBe('"oratlas_g1_public"');
    for (const unsafe of ['a"b', "Upper", "x; DROP ROLE y", "", "a b", "1abc"]) {
      expect(() => quoteIdent(unsafe)).toThrow(/Unsafe SQL identifier/);
    }
    expect(quoteLiteral("it's")).toBe("'it''s'");
    expect(() => quoteLiteral("a\u0000b")).toThrow(/NUL/);
    expect(redact("x secret y postgres://u:p@h/db", ["secret"])).toBe(
      "x [redacted] y postgres://[redacted]",
    );
  });
});

describe("G1 provisioning SQL", () => {
  it("grants the public role SELECT on the fixture tables only", () => {
    const sql = createPublicRoleSql("oratlas_g1_public", "pw");
    expect(sql).toMatch(/NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/);
    expect(sql).toContain(
      `GRANT SELECT ON TABLE ${FIXTURE_PUBLIC_TABLES.map((t) => `public."${t}"`).join(", ")}`,
    );
    expect(sql).not.toMatch(/ALL TABLES|INSERT|UPDATE|DELETE|private_ws/u);
  });

  it("creates an empty private schema with USAGE only for the private role", () => {
    const sql = provisionPrivateSql("g1_admin", "oratlas_g1_private", "pw");
    expect(sql).toContain('CREATE SCHEMA "private_ws" AUTHORIZATION "g1_admin";');
    expect(sql).toContain('REVOKE ALL ON SCHEMA "private_ws" FROM PUBLIC;');
    expect(sql).toContain('GRANT USAGE ON SCHEMA "private_ws" TO "oratlas_g1_private";');
    expect(sql).not.toMatch(/CREATE TABLE|GRANT CREATE|GRANT ALL|DEFAULT PRIVILEGES/u);
  });

  it("wraps probes in a transaction that is always rolled back", () => {
    const sql = probeSql(`CREATE TABLE "private_ws".g1_probe (id integer)`);
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    expect(sql).toContain(`EXECUTE 'CREATE TABLE "private_ws".g1_probe (id integer)'`);
    expect(sql).not.toMatch(/COMMIT/u);
  });

  it("drops only recorded run-created objects and refuses unexpected names", () => {
    expect(
      dropRecordedPublicObjectsSql({ tables: ["Review"], functions: ["oratlas_guard()"] }),
    ).toBe(
      'DROP TABLE IF EXISTS public."Review" CASCADE;\nDROP FUNCTION IF EXISTS public.oratlas_guard();',
    );
    expect(() => dropRecordedPublicObjectsSql({ tables: ['x"; DROP'], functions: [] })).toThrow();
    expect(() =>
      dropRecordedPublicObjectsSql({ tables: [], functions: ["f(); DROP SCHEMA x"] }),
    ).toThrow();
  });

  it("treats any object kind as non-empty", () => {
    const empty: SchemaObjectCounts = {
      schemaExists: true,
      owner: "g1_admin",
      tables: 0,
      sequences: 0,
      views: 0,
      indexes: 0,
      otherRelations: 0,
      functions: 0,
      types: 0,
      collations: 0,
      operators: 0,
      conversions: 0,
      textSearch: 0,
      extensions: 0,
      statisticsObjects: 0,
    };
    expect(isEmptySchema(empty)).toBe(true);
    for (const key of Object.keys(empty).filter((k) => k !== "schemaExists" && k !== "owner")) {
      expect(isEmptySchema({ ...empty, [key]: 1 }), key).toBe(false);
    }
  });
});
