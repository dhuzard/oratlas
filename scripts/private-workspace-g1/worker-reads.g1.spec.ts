import { createNativeEvidenceGuard, type NativeEvidenceGuard } from "./native-evidence-guard.js";
import { workerOutputProblems } from "./worker-capture-safety.js";
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  G1_BASE_URL,
  G1_FIXED_CLOCK,
  G1_CAPTURE_VERSION,
  bodyText,
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
  workerAuthorityDisclosureProblems,
  type WorkerAuthority,
  WORKER_READ_SELECT_TABLES,
  WORKER_READ_COLUMN_UPDATES,
} from "./worker-authority.js";
import {
  PUBLIC_SELECT_TABLES,
  PUBLIC_TABLE_GRANTS,
  PUBLIC_COLUMN_UPDATE_GRANTS,
  tablePrivilegesSql,
  columnPrivilegesSql,
} from "./sql.js";
import { workerReadScenarios } from "./worker-read-scenarios.js";

type Handler = (
  request: Request,
  context: { params: Promise<{ id: string; artifactId?: string }> },
) => Promise<Response>;
type WorkerRecord = HttpRecord & {
  request: HttpRecord["request"] & {
    workerAuthority: WorkerAuthority;
    authorizationSha256: string | null;
    verificationLeaseSha256: string | null;
  };
};
let out: string;
let sign: SessionSigner;
let guard: NativeEvidenceGuard;
let disconnect: (() => Promise<void>) | undefined;
let handlers: Record<string, Handler>;
type CredentialRow = Readonly<Record<string, unknown>> & { id: string; lastUsedAt: string | null };
let credentialState: () => Promise<CredentialRow[]>;
let label: string;
let authorityScope: { roleContract: string; tables: string[]; columns: string[] };
let unchangedDatabaseDigest: () => Promise<string>;

beforeAll(async () => {
  out = assertPublicChildEnv(process.env, "G1_WORKER_CAPTURE_OUT");
  label = process.env.G1_CAPTURE_LABEL ?? "";
  if (!["baseline", "baseline-repeat", "after", "after-repeat"].includes(label))
    throw new Error("Invalid worker capture label");
  nextInternals();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  vi.stubGlobal("fetch", () => {
    throw new Error("Outbound HTTP forbidden in synthetic worker reads");
  });
  const [vInput, vSource, cRun, cInput, db, token] = await Promise.all([
    import("@/app/api/verification-runs/[id]/input/route"),
    import("@/app/api/verification-runs/[id]/source-artifacts/[artifactId]/route"),
    import("@/app/api/certification-runs/[id]/route"),
    import("@/app/api/certification-runs/[id]/input/route"),
    import("@/lib/db"),
    import("@/lib/session-token"),
  ]);
  handlers = {
    "api/verification-runs/[id]/input": vInput.GET,
    "api/verification-runs/[id]/source-artifacts/[artifactId]": async (request, context) => {
      const params = await context.params;
      if (!params.artifactId) throw new Error("Missing synthetic source-artifact parameter");
      return vSource.GET(request, {
        params: Promise.resolve({ id: params.id, artifactId: params.artifactId }),
      });
    },
    "api/certification-runs/[id]": cRun.GET,
    "api/certification-runs/[id]/input": cInput.GET,
  };
  sign = token.createSessionToken;
  guard = createNativeEvidenceGuard(sign, process.env.DATABASE_URL!);
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
      + (SELECT count(*) FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = session_user)),
    'publicCreate', has_schema_privilege(session_user, 'public', 'CREATE'),
    'tables', ${tablePrivilegesSql("session_user")}, 'columns', ${columnPrivilegesSql("session_user")},
    'privateExists', to_regnamespace('private_ws') IS NOT NULL,
    'privateUsage', CASE WHEN to_regnamespace('private_ws') IS NULL THEN false ELSE has_schema_privilege(session_user, 'private_ws', 'USAGE') END,
    'privateCreate', CASE WHEN to_regnamespace('private_ws') IS NULL THEN false ELSE has_schema_privilege(session_user, 'private_ws', 'CREATE') END
  ) AS evidence`);
  const posture = guard.value(postureRows[0]!.evidence);
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
    roleContract: "public-runtime-with-worker-read",
    tables: expectedTables,
    columns: expectedColumns,
  };
  const { getPublicationVersionPacket } = await import("@/lib/publication-version-packet");
  // Re-run the actual readonly native builder; do not accept a hand-shaped packet as proof.
  expect(guard.value(await getPublicationVersionPacket("g1-worker-version"))).toEqual(
    JSON.parse(readFileSync(new URL("./fixtures/worker-input.json", import.meta.url), "utf8")),
  );
  credentialState = async () => {
    const [verifier, certifier] = await Promise.all([
      db.prisma.verifierCredential.findMany({
        orderBy: { id: "asc" },
      }),
      db.prisma.certifierCredential.findMany({
        orderBy: { id: "asc" },
      }),
    ]);
    guard.value([verifier, certifier]);
    return (JSON.parse(canonicalJson([...verifier, ...certifier])) as CredentialRow[]).sort(
      (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  };
  unchangedDatabaseDigest = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of new Set([...PUBLIC_SELECT_TABLES, ...WORKER_READ_SELECT_TABLES])) {
      const expression = WORKER_READ_SELECT_TABLES.includes(
        table as (typeof WORKER_READ_SELECT_TABLES)[number],
      )
        ? "to_jsonb(t) - 'lastUsedAt'"
        : "to_jsonb(t)";
      const result = await db.prisma.$queryRawUnsafe<Array<{ rows: unknown[] }>>(
        `SELECT COALESCE(json_agg(${expression} ORDER BY (${expression})::text COLLATE "C"), '[]'::json) AS rows FROM public."${table}" t`,
      );
      rows[table] = result[0]!.rows;
    }
    guard.value(rows);
    return sha256Text(canonicalJson(rows));
  };
});
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await disconnect?.();
});

it("captures valid worker reads and narrow credential last-use updates independently of cookie roles", async () => {
  const scenarios = workerReadScenarios();
  const records: WorkerRecord[] = [];
  const databaseBefore = await unchangedDatabaseDigest();
  const credentialsBefore = await credentialState();
  const perRequest: Array<{ id: string; before: CredentialRow[]; after: CredentialRow[] }> = [];
  for (const scenario of scenarios) {
    const before = await credentialState();
    const cookie = cookieHeader(scenario.session, sign);
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, {
      headers: {
        ...workerAuthorityHeaders(scenario.workerAuthority),
        ...(cookie ? { cookie } : {}),
      },
    });
    const dispatchedCookie = request.headers.get("cookie");
    if (dispatchedCookie !== (cookie ?? null))
      throw new Error("Worker Cookie header differs from session recipe");
    const digests = workerAuthorityDigests(request.headers);
    expect(digests).toEqual(
      workerAuthorityDigests(new Headers(workerAuthorityHeaders(scenario.workerAuthority))),
    );
    const id = scenario.params?.id;
    const artifactId = scenario.params?.artifactId;
    if (typeof id !== "string" || (artifactId !== undefined && typeof artifactId !== "string"))
      throw new Error("Invalid synthetic worker route parameters");
    guard.cookie(request.headers.get("cookie"));
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      handlers[scenario.route]!(request, {
        params: Promise.resolve({ id, ...(artifactId ? { artifactId } : {}) }),
      }),
    );
    const base = await guard.capture(
      {
        id: scenario.id,
        method: "GET",
        path: scenario.path,
        headers: scenario.headers ?? {},
        body: null,
        principal: scenario.principal,
        sessionCase: scenario.session.case,
        session: scenario.session,
        cookieSha256: dispatchedCookie === null ? null : sha256Text(dispatchedCookie),
        workerAuthority: scenario.workerAuthority,
        ...digests,
      },
      response,
      request.headers,
    );
    expect(workerAuthorityDisclosureProblems(bodyText(base), scenario.workerAuthority)).toEqual([]);
    const after = await credentialState();
    const authenticated = ["active", "wrong-owner"].includes(scenario.workerAuthority.credential);
    const changedId = `g1-worker-${scenario.workerAuthority.kind}-${scenario.workerAuthority.credential}`;
    expect(after).toEqual(
      before.map((row) =>
        authenticated && row.id === changedId ? { ...row, lastUsedAt: G1_FIXED_CLOCK } : row,
      ),
    );
    perRequest.push({ id: scenario.id, before, after });
    records.push({
      ...base,
      request: { ...base.request, workerAuthority: scenario.workerAuthority, ...digests },
    });
  }
  const capture: CaptureFile = {
    version: G1_CAPTURE_VERSION,
    label,
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records,
  };
  const state = await credentialState();
  const databaseAfter = await unchangedDatabaseDigest();
  expect(databaseAfter).toBe(databaseBefore);
  expect(state).toHaveLength(12);
  expect(
    state
      .filter(
        (row) =>
          row.lastUsedAt !== credentialsBefore.find((before) => before.id === row.id)?.lastUsedAt,
      )
      .map((row) => row.id),
  ).toEqual([
    "g1-worker-certifier-active",
    "g1-worker-certifier-wrong-owner",
    "g1-worker-verifier-active",
    "g1-worker-verifier-wrong-owner",
  ]);
  const stateEvidence = {
    authorityScope,
    credentialsBefore,
    credentialsAfter: state,
    perRequest,
    unchangedDatabaseBefore: databaseBefore,
    unchangedDatabaseAfter: databaseAfter,
    independentlyAssertedCredentialFields: [
      "CertifierCredential.lastUsedAt",
      "VerifierCredential.lastUsedAt",
    ],
  };
  if (workerOutputProblems(JSON.stringify(stateEvidence)).length)
    throw new Error("Worker capability state disclosure refused");
  guard.value([capture, stateEvidence]);
  expect(validateCapture(capture, scenarios, sign)).toEqual([]);
  writeFileSync(out, `${JSON.stringify(capture, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(`${out}.state.json`, `${JSON.stringify(stateEvidence, null, 2)}\n`, {
    mode: 0o600,
  });
}, 60_000);
