import { writeFileSync } from "node:fs";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  captureHttp,
  G1_BASE_URL,
  G1_FIXED_CLOCK,
  G1_CAPTURE_VERSION,
  type CaptureFile,
  type HttpRecord,
} from "./capture.js";
import { assertPublicChildEnv } from "./child-env.js";
import { validateCapture } from "./compare.js";
import { invokeRouteHandler, nextInternals } from "./next-request-context.js";
import { cookieHeader, sha256Text, type SessionSigner } from "./principals.js";
import { WORKER_READ_SELECT_TABLES, WORKER_READ_COLUMN_UPDATES } from "./worker-authority.js";
import {
  PUBLIC_SELECT_TABLES,
  PUBLIC_TABLE_GRANTS,
  PUBLIC_COLUMN_UPDATE_GRANTS,
  tablePrivilegesSql,
  columnPrivilegesSql,
} from "./sql.js";
import { publicTableSnapshotSql, type KnownPublicSqlState } from "./known-mutation-state.js";
import { PROTOCOL_POST_INPUTS, protocolDoiScenarios } from "./protocol-doi-scenarios.js";
import { protocolDoiStateProblems, assertProtocolDoiOutputSafe } from "./protocol-doi-state.js";
import { requestBodyText } from "./scenarios.js";
let out: string;
let label: string;
let sign: SessionSigner;
let handlers: Record<string, (request: Request) => Promise<Response>>;
let disconnect: (() => Promise<void>) | undefined;
let snapshot: () => Promise<KnownPublicSqlState>;
let authorityScope: { roleContract: string; tables: string[]; columns: string[] };
let outboundAttempts = 0;
beforeAll(async () => {
  out = assertPublicChildEnv(process.env, "G1_PROTOCOL_DOI_OUT");
  label = process.env.G1_CAPTURE_LABEL ?? "";
  if (!["baseline", "baseline-repeat", "after", "after-repeat"].includes(label))
    throw new Error("Invalid protocol/DOI capture label");
  nextInternals();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  vi.stubGlobal("fetch", () => {
    outboundAttempts++;
    throw new Error("Provider calls forbidden in synthetic protocol/DOI program");
  });
  const [protocol, doi, db, token] = await Promise.all([
    import("@/app/api/protocols/snapshots/route"),
    import("@/app/api/validate-doi/route"),
    import("@/lib/db"),
    import("@/lib/session-token"),
  ]);
  handlers = { "api/protocols/snapshots": protocol.POST, "api/validate-doi": doi.POST };
  sign = token.createSessionToken;
  disconnect = () => db.prisma.$disconnect();
  const postureRows = await db.prisma.$queryRawUnsafe<
    Array<{
      evidence: {
        user: string;
        current: string;
        privileged: boolean;
        memberships: number;
        owned: number;
        publicCreate: boolean;
        tables: unknown[];
        columns: unknown[];
        privateExists: boolean;
        privateUsage: boolean;
        privateCreate: boolean;
      };
    }>
  >(`SELECT json_build_object(
    'user', session_user::text, 'current', current_user::text,
    'privileged', (SELECT rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = session_user),
    'memberships', (SELECT count(*) FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = session_user)),
    'owned', (SELECT count(*) FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = session_user))
      + (SELECT count(*) FROM pg_namespace WHERE nspowner = (SELECT oid FROM pg_roles WHERE rolname = session_user))
      + (SELECT count(*) FROM pg_proc WHERE proowner = (SELECT oid FROM pg_roles WHERE rolname = session_user))
      + (SELECT count(*) FROM pg_type WHERE typowner = (SELECT oid FROM pg_roles WHERE rolname = session_user))
      + (SELECT count(*) FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = session_user)),
    'publicCreate', has_schema_privilege(session_user, 'public', 'CREATE'),
    'tables', ${tablePrivilegesSql("session_user")}, 'columns', ${columnPrivilegesSql("session_user")},
    'privateExists', to_regnamespace('private_ws') IS NOT NULL,
    'privateUsage', CASE WHEN to_regnamespace('private_ws') IS NULL THEN false ELSE has_schema_privilege(session_user, 'private_ws', 'USAGE') END,
    'privateCreate', CASE WHEN to_regnamespace('private_ws') IS NULL THEN false ELSE has_schema_privilege(session_user, 'private_ws', 'CREATE') END
  ) AS evidence`);
  const posture = postureRows[0]!.evidence;
  expect(posture.user).toBe(new URL(process.env.DATABASE_URL!).username);
  expect(posture.current).toBe(posture.user);
  expect(posture.privileged).toBe(false);
  expect(posture.memberships).toBe(0);
  expect(posture.owned).toBe(0);
  expect(posture.publicCreate).toBe(false);
  expect(posture.privateUsage).toBe(false);
  expect(posture.privateCreate).toBe(false);
  expect(posture.privateExists).toBe(label.startsWith("after"));
  const sorted = (values: unknown[]) =>
    [...new Set(values.map((value) => canonicalJson(value)))].sort();
  const expectedTables = sorted([
    ...PUBLIC_TABLE_GRANTS.flatMap(({ table, privileges }) =>
      privileges.map((privilege) => [table, privilege]),
    ),
    ...WORKER_READ_SELECT_TABLES.map((table) => [table, "SELECT"]),
  ]);
  const expectedColumns = sorted(
    [...PUBLIC_COLUMN_UPDATE_GRANTS, ...WORKER_READ_COLUMN_UPDATES].flatMap(({ table, columns }) =>
      columns.map((column) => [table, column, "UPDATE"]),
    ),
  );
  expect(sorted(posture.tables)).toEqual(expectedTables);
  expect(sorted(posture.columns)).toEqual(expectedColumns);
  authorityScope = {
    roleContract: "public-runtime-protocol-doi",
    tables: expectedTables,
    columns: expectedColumns,
  };
  snapshot = async () => {
    const result: Record<string, Readonly<Record<string, unknown>>[]> = {};
    for (const table of PUBLIC_SELECT_TABLES) {
      const rows = await db.prisma.$queryRawUnsafe<
        Array<{ rows: Readonly<Record<string, unknown>>[] }>
      >(publicTableSnapshotSql(table));
      result[table] = rows[0]!.rows;
    }
    return result;
  };
});
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await disconnect?.();
});
it("captures actual snapshot replay and local DOI reports without changing any public row", async () => {
  const scenarios = protocolDoiScenarios(),
    records: HttpRecord[] = [],
    cookieSecrets = new Set<string>();
  // Enumerate every dispatched cookie before any database/response assertion can format values.
  for (const scenario of scenarios) {
    const cookie = cookieHeader(scenario.session, sign);
    if (!cookie) continue;
    if (scenario.session.case === "malformed") {
      cookieSecrets.add(cookie);
      continue;
    }
    const value = cookie.slice(cookie.indexOf("=") + 1),
      parts = value.split(".");
    for (const secret of [cookie, value, parts.slice(0, -1).join("."), parts.at(-1)!].filter(
      Boolean,
    ))
      cookieSecrets.add(secret);
  }
  const safe = (state: unknown) => assertProtocolDoiOutputSafe(records, state, [...cookieSecrets]);
  const before = await snapshot();
  safe(before);
  const native = before.ProtocolSnapshot!.find(
    (row) => row.id === PROTOCOL_POST_INPUTS.replay.snapshotId,
  )!;
  expect(native.rawJson).toBe(canonicalJson(PROTOCOL_POST_INPUTS.input.payload));
  expect(native.contentHash).toBe(
    sha256Text(canonicalJson({ payload: PROTOCOL_POST_INPUTS.input.payload, osfQuestions: null })),
  );
  const perRequest: unknown[] = [],
    expectedDigest = sha256Text(canonicalJson(before));
  for (const scenario of scenarios) {
    const previous = await snapshot();
    safe(previous);
    expect(
      protocolDoiStateProblems(before, previous),
      `${scenario.id}: state continuity before`,
    ).toEqual([]);
    const cookie = cookieHeader(scenario.session, sign),
      body = requestBodyText(scenario);
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, {
      method: "POST",
      headers: { ...scenario.headers, ...(cookie ? { cookie } : {}) },
      ...(body === null ? {} : { body }),
    });
    const actualCookie = request.headers.get("cookie");
    if (actualCookie !== (cookie ?? null))
      throw new Error("Protocol/DOI Cookie header differs from recipe");
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      handlers[scenario.route]!(request),
    );
    records.push(
      await captureHttp(
        {
          id: scenario.id,
          method: "POST",
          path: scenario.path,
          headers: scenario.headers ?? {},
          body,
          principal: scenario.principal,
          sessionCase: scenario.session.case,
          session: scenario.session,
          cookieSha256: actualCookie === null ? null : sha256Text(actualCookie),
        },
        response,
        request.headers,
      ),
    );
    safe({});
    const after = await snapshot();
    safe(after);
    expect(
      protocolDoiStateProblems(before, after),
      `${scenario.id}: complete unchanged state`,
    ).toEqual([]);
    const beforeSha256 = sha256Text(canonicalJson(previous)),
      afterSha256 = sha256Text(canonicalJson(after));
    expect(beforeSha256).toBe(expectedDigest);
    expect(afterSha256).toBe(expectedDigest);
    perRequest.push({ id: scenario.id, beforeSha256, afterSha256 });
  }
  const after = await snapshot();
  safe(after);
  expect(protocolDoiStateProblems(before, after)).toEqual([]);
  expect(outboundAttempts).toBe(0);
  const capture: CaptureFile = {
    version: G1_CAPTURE_VERSION,
    label,
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records,
  };
  const state = {
    authorityScope,
    clock: G1_FIXED_CLOCK,
    before,
    after,
    perRequest,
    outboundAttempts,
    expectedPublicStateSha256: expectedDigest,
  };
  safe(state);
  expect(validateCapture(capture, scenarios, sign)).toEqual([]);
  writeFileSync(out, `${JSON.stringify(capture, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(`${out}.state.json`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}, 180_000);
