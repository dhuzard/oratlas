import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryJson, quoteIdent } from "./postgres.js";
import {
  FIXTURE_PUBLIC_TABLES,
  isEmptySchema,
  probeSql,
  rolePostureSql,
  schemaObjectCountsSql,
  type ProbeResult,
  type SchemaObjectCounts,
} from "./sql.js";
import { parseRuntimeTargets, PRIVATE_SCHEMA, type G1RuntimeTargets } from "./target.js";

// T-ROLE G1-empty posture. Runs in a child process holding only the PUBLIC and PRIVATE runtime
// URLs (direct connections) and the bootstrap role *name*; it never receives the admin credential
// and never uses SET ROLE from an admin session to impersonate a runtime role. Missing
// configuration fails the suite. Table-level SELECT/DML denial on real private tables is deferred
// to the post-G1 table suite: a query against a nonexistent relation is not table evidence.

type Posture = {
  sessionUser: string;
  currentUser: string;
  database: string;
  attributes: Record<string, boolean>;
  memberOf: string[];
  members: string[];
  otherRoles: Array<{
    role: string;
    exists: boolean;
    member: boolean | null;
    usage: boolean | null;
  }>;
  owned: Record<string, number>;
  privateSchema: {
    visibleInCatalog: boolean;
    owner: string | null;
    usage: boolean;
    create: boolean;
    acl: Array<{ grantee: string; privilege: string; grantable: boolean }>;
  };
  publicSchema: { usage: boolean; create: boolean };
  databasePrivileges: { create: boolean; temporary: boolean; connect: boolean };
  publicTablePrivileges: Array<[string, string]>;
  defaultAcl: unknown[];
};

type ProbeCase = {
  readonly id: string;
  readonly statement: string;
  readonly expected: string;
  readonly meaning: string;
};

let targets: G1RuntimeTargets;
let evidenceOut: string;
const evidence: Record<string, unknown> = {};

beforeAll(() => {
  targets = parseRuntimeTargets(process.env);
  const out = process.env.G1_ROLE_EVIDENCE_OUT;
  if (!out || !isAbsolute(out)) throw new Error("G1_ROLE_EVIDENCE_OUT (absolute path) is required");
  evidenceOut = out;
});

afterAll(() => {
  if (!evidenceOut) return;
  mkdirSync(dirname(evidenceOut), { recursive: true });
  writeFileSync(evidenceOut, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
});

const posture = (which: "public" | "private") =>
  queryJson<Posture>(
    targets[which],
    rolePostureSql([
      targets.adminRole,
      which === "public" ? targets.private.user : targets.public.user,
    ]),
  );

const probe = (which: "public" | "private", statement: string) =>
  queryJson<ProbeResult>(targets[which], probeSql(statement));

const privateCounts = (which: "public" | "private") =>
  queryJson<SchemaObjectCounts>(targets[which], schemaObjectCountsSql(PRIVATE_SCHEMA));

const NO_ATTRIBUTES = {
  super: false,
  inherit: false,
  createRole: false,
  createDb: false,
  replication: false,
  bypassRls: false,
  canLogin: true,
};

function expectRestrictedRole(result: Posture, user: string, peer: string) {
  expect(result.sessionUser).toBe(user);
  expect(result.currentUser).toBe(user);
  expect(result.attributes).toEqual(NO_ATTRIBUTES);
  expect(result.memberOf).toEqual([]);
  expect(result.members).toEqual([]);
  expect(result.otherRoles).toEqual([
    { role: targets.adminRole, exists: true, member: false, usage: false },
    { role: peer, exists: true, member: false, usage: false },
  ]);
  expect(result.owned).toEqual({ relations: 0, schemas: 0, functions: 0, types: 0, databases: 0 });
  expect(result.publicSchema.create).toBe(false);
  expect(result.databasePrivileges.create).toBe(false);
  // No default privileges exist yet: tables created later by the migration path receive no
  // implicit grants for either runtime role; the table suite must grant and test them explicitly.
  expect(result.defaultAcl).toEqual([]);
}

function expectedPrivateAcl() {
  return [
    { grantee: targets.adminRole, privilege: "CREATE", grantable: false },
    { grantee: targets.adminRole, privilege: "USAGE", grantable: false },
    { grantee: targets.private.user, privilege: "USAGE", grantable: false },
  ];
}

function sortAcl(acl: Posture["privateSchema"]["acl"]) {
  return [...acl].sort((a, b) =>
    `${a.grantee}/${a.privilege}`.localeCompare(`${b.grantee}/${b.privilege}`),
  );
}

describe("G1 T-ROLE: runtime identities and role posture (direct connections)", () => {
  it("public runtime role is restricted, owns nothing and has no private_ws privilege", async () => {
    const result = await posture("public");
    evidence.publicPosture = result;
    expectRestrictedRole(result, targets.public.user, targets.private.user);
    expect(result.privateSchema.visibleInCatalog).toBe(true); // catalog visibility is not hidden
    expect(result.privateSchema.owner).toBe(targets.adminRole);
    expect(result.privateSchema.usage).toBe(false);
    expect(result.privateSchema.create).toBe(false);
    expect(sortAcl(result.privateSchema.acl)).toEqual(expectedPrivateAcl());
    expect(result.publicSchema.usage).toBe(true);
    expect(result.publicTablePrivileges).toEqual(
      [...FIXTURE_PUBLIC_TABLES].sort().map((table) => [table, "SELECT"]),
    );
  });

  it("private runtime role has private_ws USAGE only and no public table privilege", async () => {
    const result = await posture("private");
    evidence.privatePosture = result;
    expectRestrictedRole(result, targets.private.user, targets.public.user);
    expect(result.privateSchema.owner).toBe(targets.adminRole);
    expect(result.privateSchema.usage).toBe(true);
    expect(result.privateSchema.create).toBe(false);
    expect(sortAcl(result.privateSchema.acl)).toEqual(expectedPrivateAcl());
    expect(result.publicTablePrivileges).toEqual([]);
  });
});

describe("G1 T-ROLE: private_ws is empty", () => {
  it("contains no tables, sequences, views, functions, types or other objects", async () => {
    const [fromPublic, fromPrivate] = [
      await privateCounts("public"),
      await privateCounts("private"),
    ];
    evidence.emptySchemaBeforeProbes = { fromPublic, fromPrivate };
    expect(fromPrivate.schemaExists).toBe(true);
    expect(isEmptySchema(fromPublic)).toBe(true);
    expect(isEmptySchema(fromPrivate)).toBe(true);
  });
});

function probeCases(): { public: ProbeCase[]; private: ProbeCase[] } {
  const schema = quoteIdent(PRIVATE_SCHEMA);
  const admin = quoteIdent(targets.adminRole);
  const pub = quoteIdent(targets.public.user);
  const priv = quoteIdent(targets.private.user);
  const denied = "insufficient_privilege (permission denial, not a missing object)";
  return {
    public: [
      {
        id: "create-private-table",
        statement: `CREATE TABLE ${schema}.g1_probe (id integer)`,
        expected: "42501",
        meaning: denied,
      },
      {
        id: "resolve-private-relation",
        statement: `SELECT 1 FROM ${schema}.g1_absent_probe`,
        expected: "42501",
        meaning: "schema USAGE is checked before relation lookup; a 42P01 here would mean USAGE",
      },
      {
        id: "grant-self-private-usage",
        statement: `GRANT USAGE ON SCHEMA ${schema} TO ${pub}`,
        expected: "42501",
        meaning: denied,
      },
      {
        id: "create-public-table",
        statement: `CREATE TABLE public.g1_probe (id integer)`,
        expected: "42501",
        meaning: denied,
      },
      {
        id: "create-schema",
        statement: `CREATE SCHEMA g1_probe_schema`,
        expected: "42501",
        meaning: denied,
      },
      {
        id: "create-role",
        statement: `CREATE ROLE g1_probe_role`,
        expected: "42501",
        meaning: denied,
      },
      { id: "set-role-admin", statement: `SET ROLE ${admin}`, expected: "42501", meaning: denied },
      { id: "set-role-private", statement: `SET ROLE ${priv}`, expected: "42501", meaning: denied },
    ],
    private: [
      {
        id: "create-private-table",
        statement: `CREATE TABLE ${schema}.g1_probe (id integer)`,
        expected: "42501",
        meaning: `${denied}: USAGE without CREATE`,
      },
      {
        id: "resolve-private-relation-control",
        statement: `SELECT 1 FROM ${schema}.g1_absent_probe`,
        expected: "42P01",
        meaning:
          "control only: with USAGE the absent relation is undefined_table — NOT table-permission evidence",
      },
      {
        id: "read-public-fixture-table",
        statement: `SELECT 1 FROM public."ReviewVersion"`,
        expected: "42501",
        meaning: "private role has no blanket public access",
      },
      {
        id: "create-public-table",
        statement: `CREATE TABLE public.g1_probe (id integer)`,
        expected: "42501",
        meaning: denied,
      },
      {
        id: "create-schema",
        statement: `CREATE SCHEMA g1_probe_schema`,
        expected: "42501",
        meaning: denied,
      },
      {
        id: "create-role",
        statement: `CREATE ROLE g1_probe_role`,
        expected: "42501",
        meaning: denied,
      },
      { id: "set-role-admin", statement: `SET ROLE ${admin}`, expected: "42501", meaning: denied },
      { id: "set-role-public", statement: `SET ROLE ${pub}`, expected: "42501", meaning: denied },
    ],
  };
}

describe("G1 T-ROLE: rolled-back DDL/role probes record SQLSTATEs", () => {
  for (const which of ["public", "private"] as const) {
    it(`${which} runtime role is denied with 42501 (and never creates a probe)`, async () => {
      const results: Array<ProbeCase & ProbeResult> = [];
      for (const testCase of probeCases()[which]) {
        const outcome = await probe(which, testCase.statement);
        results.push({ ...testCase, ...outcome });
      }
      evidence[`${which}Probes`] = results;
      for (const result of results) {
        expect(result.sessionUser, result.id).toBe(targets[which].user);
        expect(result.sqlstate, `${result.id}: ${result.message ?? ""}`).not.toBe("SUCCEEDED");
        expect(result.sqlstate, result.id).toBe(result.expected);
      }
    });
  }

  it("public role can read exactly its fixture data (grants are functional, not degraded)", async () => {
    const counts = await queryJson<Record<string, number>>(
      targets.public,
      `SELECT json_build_object(${FIXTURE_PUBLIC_TABLES.map(
        (table) => `'${table}', (SELECT count(*) FROM public."${table}")`,
      ).join(", ")});`,
    );
    evidence.publicFixtureCounts = counts;
    expect(counts).toEqual({
      Person: 2,
      RepositorySnapshot: 3,
      Review: 1,
      ReviewContributor: 4,
      ReviewVersion: 3,
    });
  });

  it("leaves private_ws empty after every probe", async () => {
    const [fromPublic, fromPrivate] = [
      await privateCounts("public"),
      await privateCounts("private"),
    ];
    evidence.emptySchemaAfterProbes = { fromPublic, fromPrivate };
    expect(isEmptySchema(fromPublic)).toBe(true);
    expect(isEmptySchema(fromPrivate)).toBe(true);
  });
});
