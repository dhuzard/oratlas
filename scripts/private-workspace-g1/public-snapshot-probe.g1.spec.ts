import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";
import { assertPublicChildEnv } from "./child-env.js";
import {
  PUBLIC_SELECT_TABLES,
  PUBLIC_TABLE_GRANTS,
  PUBLIC_COLUMN_UPDATE_GRANTS,
  tablePrivilegesSql,
  columnPrivilegesSql,
} from "./sql.js";
import {
  publicTableSnapshotSql,
  knownPublicStateProblems,
  type KnownPublicSqlState,
} from "./known-mutation-state.js";
import { readPublicSnapshot, publicSnapshotSql } from "./public-snapshot.js";
import { nativeEvidenceProblems } from "./native-evidence-safety.js";

it("compares two exact serial/batch native reads under identical restricted authority", async () => {
  const out = assertPublicChildEnv(process.env, "G1_PUBLIC_SNAPSHOT_OUT");
  let outbound = 0;
  vi.stubGlobal("fetch", () => {
    outbound++;
    throw Error("Public snapshot outbound refused");
  });
  const { prisma } = await import("@/lib/db");
  const url = new URL(process.env.DATABASE_URL!);
  const secrets = [process.env.DATABASE_URL!, url.password, decodeURIComponent(url.password)];
  const guard = (value: unknown) => {
    if (nativeEvidenceProblems(value, secrets).length)
      throw Error("Public snapshot capability disclosure refused");
  };
  try {
    const authority = (
      await prisma.$queryRawUnsafe<
        Array<{
          posture: {
            user: string;
            current: string;
            privileged: boolean;
            memberships: number;
            owned: number;
            publicCreate: boolean;
            privateExists: boolean;
            tables: unknown[];
            columns: unknown[];
          };
        }>
      >(
        `SELECT json_build_object('user',session_user::text,'current',current_user::text,'privileged',(SELECT rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=session_user),'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=session_user)),'owned',(SELECT count(*) FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_type WHERE typowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=session_user)),'publicCreate',has_schema_privilege(session_user,'public','CREATE'),'privateExists',to_regnamespace('private_ws') IS NOT NULL,'tables',${tablePrivilegesSql("session_user")},'columns',${columnPrivilegesSql("session_user")}) AS posture`,
      )
    )[0]!.posture;
    guard(authority);
    expect(authority.user).toBe(url.username);
    expect(authority.current).toBe(authority.user);
    expect(authority.privileged).toBe(false);
    expect(authority.memberships).toBe(0);
    expect(authority.owned).toBe(0);
    expect(authority.publicCreate).toBe(false);
    expect(authority.privateExists).toBe(false);
    const sorted = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).sort();
    expect(sorted(authority.tables)).toEqual(
      sorted(PUBLIC_TABLE_GRANTS.flatMap((g) => g.privileges.map((p) => [g.table, p]))),
    );
    expect(sorted(authority.columns)).toEqual(
      sorted(
        PUBLIC_COLUMN_UPDATE_GRANTS.flatMap((g) => g.columns.map((c) => [g.table, c, "UPDATE"])),
      ),
    );
    const checks: Array<{
      serial: KnownPublicSqlState;
      batch: KnownPublicSqlState;
      serialStatements: number;
      batchStatements: number;
      serialMs: number;
      batchMs: number;
      jsonBytesEqual: boolean;
      tamperRefused: boolean;
    }> = [];
    for (let check = 0; check < 2; check++) {
      let serialStatements = 0;
      const serialStart = performance.now();
      const serial: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
      for (const table of PUBLIC_SELECT_TABLES) {
        serialStatements++;
        serial[table] = (
          await prisma.$queryRawUnsafe<Array<{ rows: Record<string, unknown>[] }>>(
            publicTableSnapshotSql(table),
          )
        )[0]!.rows;
      }
      const serialMs = performance.now() - serialStart;
      guard(serial);
      let batchStatements = 0;
      const batchStart = performance.now();
      const batch = await readPublicSnapshot({
        $queryRawUnsafe<T>(sql: string) {
          batchStatements++;
          return prisma.$queryRawUnsafe<T>(sql);
        },
      });
      const batchMs = performance.now() - batchStart;
      guard(batch);
      expect(batchStatements).toBe(1);
      expect(serialStatements).toBe(PUBLIC_SELECT_TABLES.length);
      expect(Object.keys(batch)).toEqual(PUBLIC_SELECT_TABLES);
      expect(JSON.stringify(batch)).toBe(JSON.stringify(serial));
      expect(knownPublicStateProblems(serial, batch)).toEqual([]);
      expect(batch.User!.length).toBeGreaterThan(0);
      expect(batch.Review!.length).toBeGreaterThan(0);
      expect(batch.PublicationCapture!.length).toBeGreaterThan(0);
      const tampered = structuredClone(batch) as Record<string, Array<Record<string, unknown>>>;
      tampered.User![0]!.displayName = "Synthetic same-count snapshot tamper control";
      expect(tampered.User).toHaveLength(batch.User!.length);
      const tamperRefused = knownPublicStateProblems(serial, tampered).length > 0;
      expect(tamperRefused).toBe(true);
      checks.push({
        serial,
        batch,
        serialStatements,
        batchStatements,
        serialMs,
        batchMs,
        jsonBytesEqual: true,
        tamperRefused,
      });
    }
    expect(JSON.stringify(checks[0]!.serial)).toBe(JSON.stringify(checks[1]!.serial));
    const explain = await prisma.$queryRawUnsafe<
      Array<{
        "QUERY PLAN": Array<{ Plan: unknown; "Planning Time": number; "Execution Time": number }>;
      }>
    >(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${publicSnapshotSql()}`);
    guard(explain);
    const relations: string[] = [];
    const walk = (value: unknown) => {
      if (value && typeof value === "object") {
        if ("Relation Name" in value && typeof value["Relation Name"] === "string")
          relations.push(value["Relation Name"]);
        for (const child of Object.values(value)) walk(child);
      }
    };
    walk(explain);
    expect(relations.sort()).toEqual([...PUBLIC_SELECT_TABLES].sort());
    expect(outbound).toBe(0);
    const evidence = {
      protocol: "oratlas.g1.public-snapshot-prototype/0.1",
      authority,
      scope: PUBLIC_SELECT_TABLES,
      checks,
      explain,
      outbound,
      limit:
        "Adapter read cost only; no T-TIME or concurrent-writer/noninterference claim. Native evidence is never rewritten.",
    };
    guard(evidence);
    writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  } finally {
    vi.unstubAllGlobals();
    await prisma.$disconnect();
  }
}, 60_000);
