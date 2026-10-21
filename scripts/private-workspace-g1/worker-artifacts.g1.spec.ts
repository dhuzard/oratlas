import { readFileSync, writeFileSync } from "node:fs";
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
import {
  workerAuthorityHeaders,
  workerAuthorityDigests,
  WORKER_READ_SELECT_TABLES,
  WORKER_READ_COLUMN_UPDATES,
} from "./worker-authority.js";
import { workerOutputProblems } from "./worker-capture-safety.js";
import {
  PUBLIC_SELECT_TABLES,
  PUBLIC_TABLE_GRANTS,
  PUBLIC_COLUMN_UPDATE_GRANTS,
  tablePrivilegesSql,
  columnPrivilegesSql,
} from "./sql.js";
import { publicTableSnapshotSql, type KnownPublicSqlState } from "./known-mutation-state.js";
import {
  expectedWorkerArtifactState,
  workerArtifactStateProblems,
} from "./worker-artifact-state.js";
import {
  ARTIFACT_INPUTS,
  workerArtifactScenarios,
  WORKER_ARTIFACT_COLUMN_UPDATES,
} from "./worker-artifact-scenarios.js";
import { requestBodyText } from "./scenarios.js";

type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;
let out: string;
let label: string;
let sign: SessionSigner;
let handlers: Record<string, Handler>;
let disconnect: (() => Promise<void>) | undefined;
let snapshot: () => Promise<KnownPublicSqlState>;
let authorityScope: { roleContract: string; tables: string[]; columns: string[] };
let outboundAttempts = 0;
beforeAll(async () => {
  out = assertPublicChildEnv(process.env, "G1_WORKER_ARTIFACT_OUT");
  label = process.env.G1_CAPTURE_LABEL ?? "";
  if (!["baseline", "baseline-repeat", "after", "after-repeat"].includes(label))
    throw new Error("Invalid worker artifact capture label");
  nextInternals();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  vi.stubGlobal("fetch", () => {
    outboundAttempts++;
    throw new Error("Outbound HTTP forbidden in synthetic worker artifacts");
  });
  const [prepare, upload, complete, finding, db, token] = await Promise.all([
    import("@/app/api/verification-runs/[id]/artifacts/prepare/route"),
    import("@/app/api/verification-artifacts/[id]/content/route"),
    import("@/app/api/verification-runs/[id]/artifacts/complete/route"),
    import("@/app/api/verification-runs/[id]/findings/route"),
    import("@/lib/db"),
    import("@/lib/session-token"),
  ]);
  handlers = {
    "api/verification-runs/[id]/artifacts/prepare": prepare.POST,
    "api/verification-artifacts/[id]/content": upload.PUT,
    "api/verification-runs/[id]/artifacts/complete": complete.POST,
    "api/verification-runs/[id]/findings": finding.POST,
  };
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
    [
      ...PUBLIC_COLUMN_UPDATE_GRANTS,
      ...WORKER_READ_COLUMN_UPDATES,
      ...WORKER_ARTIFACT_COLUMN_UPDATES,
    ].flatMap(({ table, columns }) => columns.map((column) => [table, column, "UPDATE"])),
  );
  expect(sorted(posture.tables)).toEqual(expectedTables);
  expect(sorted(posture.columns)).toEqual(expectedColumns);
  authorityScope = {
    roleContract: "public-runtime-with-worker-artifact-completion",
    tables: expectedTables,
    columns: expectedColumns,
  };
  const { getPublicationVersionPacket } = await import("@/lib/publication-version-packet");
  expect(await getPublicationVersionPacket("g1-worker-version")).toEqual(
    JSON.parse(readFileSync(new URL("./fixtures/worker-input.json", import.meta.url), "utf8")),
  );
  snapshot = async () => {
    const state: Record<string, Readonly<Record<string, unknown>>[]> = {};
    for (const table of PUBLIC_SELECT_TABLES) {
      const rows = await db.prisma.$queryRawUnsafe<
        Array<{ rows: Readonly<Record<string, unknown>>[] }>
      >(publicTableSnapshotSql(table));
      state[table] = rows[0]!.rows;
    }
    return state;
  };
});
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await disconnect?.();
});
const mutable = ["VerifierCredential", "CertifierCredential", "VerificationArtifact"];
function focused(state: KnownPublicSqlState) {
  return Object.fromEntries(mutable.map((table) => [table, state[table]]));
}
function otherDigest(state: KnownPublicSqlState) {
  return sha256Text(
    canonicalJson(
      Object.fromEntries(
        PUBLIC_SELECT_TABLES.filter((table) => !mutable.includes(table)).map((table) => [
          table,
          state[table],
        ]),
      ),
    ),
  );
}
it("captures native artifact replays and exactly one existing artifact completion with complete state checks", async () => {
  const scenarios = workerArtifactScenarios();
  const records: HttpRecord[] = [];
  const before = await snapshot();
  expect(before.VerifierCredential).toHaveLength(7);
  expect(before.CertifierCredential).toHaveLength(6);
  expect(before.VerificationArtifact).toHaveLength(9);
  const run = before.VerificationRun!.find((row) => row.id === ARTIFACT_INPUTS.ids.run)!;
  expect(run.inputSha256).toBe(ARTIFACT_INPUTS.runInputSha256);
  expect(run.inputSchemaVersion).toBe(ARTIFACT_INPUTS.runInputSchemaVersion);
  expect(sha256Text(String(run.inputJson))).toBe(run.inputSha256);
  const perRequest: unknown[] = [];
  let expectedState = before;
  for (const scenario of scenarios) {
    const previous = await snapshot();
    expect(previous, `${scenario.id}: state continuity before dispatch`).toEqual(expectedState);
    const cookie = cookieHeader(scenario.session, sign);
    const body = requestBodyText(scenario);
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, {
      method: scenario.method,
      headers: {
        ...scenario.headers,
        ...workerAuthorityHeaders(scenario.workerAuthority),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === null ? {} : { body }),
    });
    const actualCookie = request.headers.get("cookie");
    if (actualCookie !== (cookie ?? null))
      throw new Error("Worker artifact Cookie header differs from recipe");
    const digests = workerAuthorityDigests(request.headers);
    expect(digests).toEqual(
      workerAuthorityDigests(new Headers(workerAuthorityHeaders(scenario.workerAuthority))),
    );
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      handlers[scenario.route]!(request, { params: Promise.resolve(scenario.params) }),
    );
    records.push(
      await captureHttp(
        {
          id: scenario.id,
          method: scenario.method,
          path: scenario.path,
          headers: scenario.headers ?? {},
          body,
          principal: scenario.principal,
          sessionCase: scenario.session.case,
          session: scenario.session,
          cookieSha256: actualCookie === null ? null : sha256Text(actualCookie),
          workerAuthority: scenario.workerAuthority,
          ...digests,
        },
        response,
        request.headers,
      ),
    );
    const after = await snapshot();
    expect(workerArtifactStateProblems(previous, after, scenario)).toEqual([]);
    expectedState = expectedWorkerArtifactState(expectedState, scenario);
    expect(after, `${scenario.id}: complete cumulative state`).toEqual(expectedState);
    perRequest.push({
      id: scenario.id,
      before: focused(previous),
      after: focused(after),
      otherTablesBefore: otherDigest(previous),
      otherTablesAfter: otherDigest(after),
    });
  }
  const after = await snapshot();
  expect(after, "complete final cumulative state").toEqual(expectedState);
  expect(
    after.VerificationArtifact!.find((row) => row.id === ARTIFACT_INPUTS.ids.uploaded)?.status,
  ).toBe("completed");
  expect(outboundAttempts).toBe(0);
  const capture: CaptureFile = {
    version: G1_CAPTURE_VERSION,
    label,
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records,
  };
  expect(validateCapture(capture, scenarios, sign)).toEqual([]);
  const state = {
    authorityScope,
    clock: G1_FIXED_CLOCK,
    before,
    after,
    perRequest,
    outboundAttempts,
    independentlyAssertedFields: [
      "VerifierCredential.lastUsedAt",
      "VerificationArtifact.status",
      "VerificationArtifact.completedAt",
    ],
  };
  // Both outputs validated before either is persisted. Raw credentials are never diagnostic values.
  if (
    workerOutputProblems(JSON.stringify(state)).length ||
    workerOutputProblems(JSON.stringify(capture)).length
  )
    throw new Error("Worker artifact capability disclosure refused");
  writeFileSync(out, `${JSON.stringify(capture, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(`${out}.state.json`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}, 240_000);
