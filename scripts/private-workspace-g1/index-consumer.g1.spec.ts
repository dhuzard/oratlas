import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { assertPublicChildEnv } from "./child-env.js";
import { G1_FIXED_CLOCK } from "./capture.js";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import {
  columnPrivilegesSql,
  tablePrivilegesSql,
  PUBLIC_TABLE_GRANTS,
  PUBLIC_COLUMN_UPDATE_GRANTS,
  PUBLIC_SELECT_TABLES,
} from "./sql.js";
import {
  INDEX_PROTOCOL,
  INDEX_READ_TABLES,
  indexCaptureProblems,
  indexDigest,
  type IndexCapture,
} from "./index-channel.js";

// Actual disconnected index consumer + actual Prisma/PostgreSQL. No handler/principal/session
// impersonation, mocked Prisma, search DTO projection or fake empty successful index.
let disconnect: (() => Promise<void>) | undefined;
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await disconnect?.();
});

it("captures a populated public index with exact runtime authority and unchanged source rows", async () => {
  const out = assertPublicChildEnv(process.env, "G1_INDEX_CAPTURE_OUT");
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  const label = process.env.G1_INDEX_LABEL;
  if (!label || !/^(baseline|baseline-repeat|after|after-repeat)$/u.test(label))
    throw new Error("Explicit index run label required");
  const roleContract = process.env.G1_INDEX_ROLE_CONTRACT ?? "public-runtime";
  if (roleContract !== "public-runtime" && roleContract !== "read-only-probe")
    throw new Error("Unknown index role contract");
  const stateTables = roleContract === "public-runtime" ? PUBLIC_SELECT_TABLES : INDEX_READ_TABLES;
  vi.stubGlobal("fetch", () => {
    throw new Error("External fetch forbidden in index consumer");
  });
  const [{ buildKnowledgeIndex }, { prisma }] = await Promise.all([
    import("@/lib/index-builder"),
    import("@/lib/db"),
  ]);
  disconnect = () => prisma.$disconnect();
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      evidence: {
        user: string;
        current: string;
        privileged: boolean;
        memberships: number;
        owned: number;
        publicCreate: boolean;
        tables: Array<[string, string]>;
        columns: unknown[];
        privateExists: boolean;
        privateUsage: boolean;
        privateCreate: boolean;
      };
    }>
  >(`SELECT json_build_object(
    'user', session_user::text, 'current', current_user::text,
    'privileged', (SELECT rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
      FROM pg_roles WHERE rolname = session_user),
    'memberships', (SELECT count(*) FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = session_user)),
    'owned', (SELECT count(*) FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = session_user))
      + (SELECT count(*) FROM pg_namespace WHERE nspowner = (SELECT oid FROM pg_roles WHERE rolname = session_user))
      + (SELECT count(*) FROM pg_proc WHERE proowner = (SELECT oid FROM pg_roles WHERE rolname = session_user))
      + (SELECT count(*) FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = session_user)),
    'publicCreate', has_schema_privilege(session_user, 'public', 'CREATE'),
    'tables', ${tablePrivilegesSql("session_user")},
    'columns', ${columnPrivilegesSql("session_user")},
    'privateExists', to_regnamespace('private_ws') IS NOT NULL,
    'privateUsage', CASE WHEN to_regnamespace('private_ws') IS NULL THEN false ELSE has_schema_privilege(session_user, 'private_ws', 'USAGE') END,
    'privateCreate', CASE WHEN to_regnamespace('private_ws') IS NULL THEN false ELSE has_schema_privilege(session_user, 'private_ws', 'CREATE') END
  ) AS evidence`);
  const posture = rows[0]!.evidence;
  expect(posture.user).toBe(new URL(process.env.DATABASE_URL!).username);
  expect(posture.current).toBe(posture.user);
  expect(posture.privileged).toBe(false);
  expect(posture.memberships).toBe(0);
  expect(posture.owned).toBe(0);
  expect(posture.publicCreate).toBe(false);
  const sorted = (values: unknown[]) => values.map((value) => JSON.stringify(value)).sort();
  const expectedTables =
    roleContract === "public-runtime"
      ? PUBLIC_TABLE_GRANTS.flatMap(({ table, privileges }) => privileges.map((p) => [table, p]))
      : INDEX_READ_TABLES.map((table) => [table, "SELECT"]);
  const expectedColumns =
    roleContract === "public-runtime"
      ? PUBLIC_COLUMN_UPDATE_GRANTS.flatMap(({ table, columns }) =>
          columns.map((c) => [table, c, "UPDATE"]),
        )
      : [];
  expect(sorted(posture.tables)).toEqual(sorted(expectedTables));
  expect(sorted(posture.columns)).toEqual(sorted(expectedColumns));
  expect(posture.privateUsage).toBe(false);
  expect(posture.privateCreate).toBe(false);
  expect(posture.privateExists).toBe(label.startsWith("after"));

  // Prove excluded inputs exist and have the intended disqualifier. Missing rows must not
  // turn an exclusion assertion into vacuous success. The index remains the real consumer.
  const controls = await prisma.review.findMany({
    where: {
      id: {
        in: [
          "g1-review-control",
          "g1-index-tombstone",
          "g1-index-withdrawn",
          "g1-index-invalid-sha",
        ],
      },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      status: true,
      versions: {
        select: {
          publicState: true,
          snapshot: { select: { commitSha: true } },
          claims: { select: { text: true } },
        },
      },
    },
  });
  expect(controls.map((row) => row.id)).toEqual([
    "g1-index-invalid-sha",
    "g1-index-tombstone",
    "g1-index-withdrawn",
    "g1-review-control",
  ]);
  for (const row of controls) {
    expect(row.versions).toHaveLength(1);
    expect(row.versions[0]!.claims.length).toBeGreaterThan(0);
    if (row.id === "g1-review-control") expect(row.status).not.toBe("published");
    if (row.id === "g1-index-invalid-sha")
      expect(row.versions[0]!.snapshot?.commitSha).toBe("not-an-exact-commit-sha");
    if (row.id === "g1-index-tombstone") expect(row.versions[0]!.publicState).toBe("tombstoned");
    if (row.id === "g1-index-withdrawn") expect(row.versions[0]!.publicState).toBe("withdrawn");
  }

  const snapshot = async (client: Pick<typeof prisma, "$queryRawUnsafe"> = prisma) => {
    const state: Record<string, unknown> = {};
    for (const table of stateTables) {
      const result = await client.$queryRawUnsafe<Array<{ rows: unknown[] }>>(
        `SELECT COALESCE(json_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"), '[]'::json) AS rows FROM public."${table}" t`,
      );
      state[table] = result[0]!.rows;
    }
    return indexDigest(state);
  };
  const before = await snapshot();
  const index = await buildKnowledgeIndex();
  const capture: IndexCapture = {
    protocol: INDEX_PROTOCOL,
    clock: G1_FIXED_CLOCK,
    label,
    roleContract,
    stateTables,
    index,
    indexSha256: indexDigest(index),
    stateBeforeSha256: before,
    stateAfterSha256: await snapshot(),
  };
  expect(indexCaptureProblems(capture)).toEqual([]);
  // Exercise a genuine same-count UPDATE under actual app authority, entirely inside a
  // rolled-back transaction. This is a negative control for value snapshots, not a mock
  // write attributed to the index consumer. Optional minimal-read authority cannot write.
  if (roleContract === "public-runtime") {
    const rollback = new Error("Synthetic index control rollback");
    await expect(
      prisma.$transaction(async (tx) => {
        const count = await tx.user.count();
        const beforeUpdate = await snapshot(tx);
        await tx.user.update({ where: { id: "g1-user-a-only" }, data: { orcid: null } });
        expect(await tx.user.count()).toBe(count);
        const afterUpdate = await snapshot(tx);
        expect(afterUpdate).not.toBe(beforeUpdate);
        expect(
          indexCaptureProblems({
            ...capture,
            stateBeforeSha256: beforeUpdate,
            stateAfterSha256: afterUpdate,
          }),
        ).toContain("consumer mutated database");
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await snapshot()).toBe(capture.stateAfterSha256);
  }
  const bytes = canonicalJson({
    ...capture,
    posture,
    sameCountUpdateControl:
      roleContract === "public-runtime" ? "rejected-and-rolled-back" : "not-exercised",
  });
  const url = new URL(process.env.DATABASE_URL!);
  for (const secret of [process.env.DATABASE_URL!, url.password, decodeURIComponent(url.password)])
    if (secret.length > 0 && bytes.includes(secret))
      throw new Error("Index evidence contains credential");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${bytes}\n`, { mode: 0o600 });
}, 30_000);
