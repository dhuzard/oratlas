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
  COLUMN_PRIVILEGES,
  columnPrivilegesSql,
  createPublicRoleSql,
  dropRecordedPublicObjectsSql,
  EXPECTED_RESET_STATE,
  isEmptySchema,
  probeSql,
  provisionPrivateSql,
  PUBLIC_COLUMN_UPDATE_GRANTS,
  PUBLIC_SELECT_TABLES,
  PUBLIC_TABLE_GRANTS,
  publicGrantSnapshotSql,
  resetTargetProblems,
  rolePostureSql,
  tablePrivilegesSql,
  truncateRecordedPublicTablesSql,
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
          "NODE_ENV",
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
        NODE_ENV: "test",
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
  it("grants the public role exactly the reviewed table and column privileges", () => {
    const sql = createPublicRoleSql("oratlas_g1_public", "pw");
    expect(sql).toMatch(/NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/);
    const grants = sql.split("\n").filter((line) => line.startsWith("GRANT"));
    expect(grants).toEqual([
      'GRANT USAGE ON SCHEMA public TO "oratlas_g1_public";',
      ...PUBLIC_TABLE_GRANTS.map(
        (grant) =>
          `GRANT ${grant.privileges.join(", ")} ON TABLE public."${grant.table}" TO "oratlas_g1_public";`,
      ),
      'GRANT UPDATE ("activatedAt", "retiredAt", "status") ON TABLE public."Certifier" TO "oratlas_g1_public";',
      'GRANT UPDATE ("readAt") ON TABLE public."Notification" TO "oratlas_g1_public";',
      'GRANT UPDATE ("orcid", "orcidVerifiedAt", "updatedAt") ON TABLE public."User" TO "oratlas_g1_public";',
    ]);
    // Writes are the audit append and column-scoped updates only; never table-wide or destructive.
    expect(sql).not.toMatch(/ALL TABLES|GRANT ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER|private_ws/u);
    expect(sql).not.toMatch(/GRANT UPDATE ON|GRANT [A-Z, ]*UPDATE[A-Z, ]* ON TABLE/u);
    expect(PUBLIC_TABLE_GRANTS.filter((grant) => grant.privileges.length > 1)).toEqual([
      expect.objectContaining({ table: "AuditEvent", privileges: ["SELECT", "INSERT"] }),
    ]);
    for (const grant of [...PUBLIC_TABLE_GRANTS, ...PUBLIC_COLUMN_UPDATE_GRANTS]) {
      expect(grant.reason.length, grant.table).toBeGreaterThan(10);
    }
    expect(Object.keys(EXPECTED_RESET_STATE.counts).sort()).toEqual(
      [...PUBLIC_SELECT_TABLES].sort(),
    );
    for (const grant of PUBLIC_COLUMN_UPDATE_GRANTS) {
      expect(PUBLIC_SELECT_TABLES, grant.table).toContain(grant.table);
    }
  });

  it("inventories effective table and column privileges, not one grantee's ACL entries", () => {
    const columns = columnPrivilegesSql("session_user");
    // A grantee filter on attacl misses grants to PUBLIC (grantee 0) and inherited grants.
    expect(columns).not.toMatch(/aclexplode|attacl|grantee/u);
    expect(columns).toContain("has_column_privilege(session_user, c.oid, a.attnum, p.privilege)");
    expect(columns).toContain("AND NOT has_table_privilege(session_user, c.oid, p.privilege)");
    expect(columns).toContain("ARRAY['SELECT','INSERT','UPDATE','REFERENCES']");
    expect(COLUMN_PRIVILEGES).toEqual(["SELECT", "INSERT", "UPDATE", "REFERENCES"]);
    expect(columns).toContain("NOT a.attisdropped");
    const tables = tablePrivilegesSql("'oratlas_g1_public'");
    expect(tables).not.toMatch(/aclexplode|relacl|grantee/u);
    expect(tables).toContain("has_table_privilege('oratlas_g1_public', c.oid, p.privilege)");
    expect(tables).toContain(
      "ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']",
    );
    for (const sql of [columns, tables]) {
      expect(sql).toContain("c.relnamespace = 'public'::regnamespace");
      expect(sql).toContain("c.relkind IN ('r', 'p', 'v', 'm', 'f')");
    }
    // The before/after snapshot and the runtime posture both use the effective inventories.
    expect(publicGrantSnapshotSql("oratlas_g1_public")).toContain(
      columnPrivilegesSql("'oratlas_g1_public'"),
    );
    expect(rolePostureSql(["g1_admin"])).toContain(columns);
    expect(rolePostureSql(["g1_admin"])).toContain(tablePrivilegesSql("session_user"));
  });

  it("resets only the exact run-created inventory of the validated target", () => {
    const inventory = { tables: ["Review", "User"], functions: ["oratlas_guard()"] };
    expect(truncateRecordedPublicTablesSql(inventory)).toBe(
      'TRUNCATE TABLE public."Review", public."User" RESTART IDENTITY;',
    );
    expect(truncateRecordedPublicTablesSql(inventory)).not.toMatch(/CASCADE/u);
    expect(() =>
      truncateRecordedPublicTablesSql({ tables: ['x"; DROP'], functions: [] }),
    ).toThrow();
    expect(() => truncateRecordedPublicTablesSql({ tables: [], functions: [] })).toThrow();
    const expected = { database: "oratlas_g1", adminRole: "g1_admin", inventory };
    const facts = {
      database: "oratlas_g1",
      sessionUser: "g1_admin",
      currentUser: "g1_admin",
      inventory,
    };
    expect(resetTargetProblems(facts, expected)).toEqual([]);
    expect(resetTargetProblems({ ...facts, database: "oratlas" }, expected)).toEqual([
      "reset connection database differs",
    ]);
    expect(resetTargetProblems({ ...facts, currentUser: "oratlas_g1_public" }, expected)).toEqual([
      "reset connection identity differs from the bootstrap role",
    ]);
    expect(
      resetTargetProblems(
        { ...facts, inventory: { ...inventory, tables: [...inventory.tables, "Foreign"] } },
        expected,
      ),
    ).toEqual(["public objects differ from the run-created inventory"]);
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
