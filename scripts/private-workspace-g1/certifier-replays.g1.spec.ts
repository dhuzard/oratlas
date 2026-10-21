import { readPublicSnapshot } from "./public-snapshot.js";
import { createNativeEvidenceGuard, type NativeEvidenceGuard } from "./native-evidence-guard.js";
import { writeFileSync } from "node:fs";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
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
import {
  PUBLIC_SELECT_TABLES,
  PUBLIC_TABLE_GRANTS,
  PUBLIC_COLUMN_UPDATE_GRANTS,
  tablePrivilegesSql,
  columnPrivilegesSql,
} from "./sql.js";
import { type KnownPublicSqlState } from "./known-mutation-state.js";
import {
  expectedCertifierReplayState,
  certifierReplayStateProblems,
  certifierReplayCapabilityProblems,
} from "./certifier-replay-state.js";
import { CERTIFIER_INPUTS, certifierReplayScenarios } from "./certifier-replay-scenarios.js";
import { requestBodyText } from "./scenarios.js";
type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;
let out: string;
let label: string;
let sign: SessionSigner;
let guard: NativeEvidenceGuard;
let handlers: Record<string, Handler>;
let disconnect: (() => Promise<void>) | undefined;
let snapshot: () => Promise<KnownPublicSqlState>;
let authorityScope: { roleContract: string; tables: string[]; columns: string[] };
let outboundAttempts = 0;
beforeAll(async () => {
  out = assertPublicChildEnv(process.env, "G1_CERTIFIER_REPLAY_OUT");
  label = process.env.G1_CAPTURE_LABEL ?? "";
  if (!["baseline", "baseline-repeat", "after", "after-repeat"].includes(label))
    throw new Error("Invalid certifier replay label");
  nextInternals();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  vi.stubGlobal("fetch", () => {
    outboundAttempts++;
    throw new Error("Outbound HTTP forbidden in synthetic certifier replays");
  });
  const [create, result, transition, lifecycle, db, token] = await Promise.all([
    import("@/app/api/certification-runs/route"),
    import("@/app/api/certification-runs/[id]/result/route"),
    import("@/app/api/certification-runs/[id]/transition/route"),
    import("@/app/api/certification-results/[id]/lifecycle/route"),
    import("@/lib/db"),
    import("@/lib/session-token"),
  ]);
  handlers = {
    "api/certification-runs": create.POST,
    "api/certification-runs/[id]/result": result.POST,
    "api/certification-runs/[id]/transition": transition.POST,
    "api/certification-results/[id]/lifecycle": lifecycle.POST,
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
      + (SELECT count(*) FROM pg_type WHERE typowner = (SELECT oid FROM pg_roles WHERE rolname = session_user))
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
    roleContract: "public-runtime-with-certifier-replays",
    tables: expectedTables,
    columns: expectedColumns,
  };
  const { getPublicationVersionPacket } = await import("@/lib/publication-version-packet");
  const packet = await getPublicationVersionPacket("g1-discovery-version");
  expect(sha256Text(canonicalJson(packet))).toBe(CERTIFIER_INPUTS.terminalPacketSha256);
  snapshot = async () => {
    const result = await readPublicSnapshot(db.prisma);
    return guard.value(result);
  };
});
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await disconnect?.();
});
const credentialTables = ["CertifierCredential", "VerifierCredential"];
const focused = (state: KnownPublicSqlState) =>
  Object.fromEntries(credentialTables.map((table) => [table, state[table]]));
const otherDigest = (state: KnownPublicSqlState) =>
  sha256Text(
    canonicalJson(
      Object.fromEntries(
        PUBLIC_SELECT_TABLES.filter((table) => !credentialTables.includes(table)).map((table) => [
          table,
          state[table],
        ]),
      ),
    ),
  );
it("captures native certifier replays with cumulative full-state and independent cookie authority", async () => {
  const scenarios = certifierReplayScenarios(),
    records: HttpRecord[] = [],
    before = await snapshot();
  expect(before.CertifierCredential).toHaveLength(7);
  expect(before.VerifierCredential).toHaveLength(6);
  const terminal = before.CertificationRun!.find(
    (row) => row.id === CERTIFIER_INPUTS.terminalRunId,
  )!;
  expect(terminal.status).toBe("failed");
  expect(sha256Text(String(terminal.inputPacketJson))).toBe(CERTIFIER_INPUTS.terminalPacketSha256);
  const cookieSecrets = new Set<string>();
  let expected = before;
  const perRequest: unknown[] = [];
  for (const scenario of scenarios) {
    const previous = await snapshot();
    expect(previous, `${scenario.id}: cumulative before continuity`).toEqual(expected);
    const cookie = cookieHeader(scenario.session, sign),
      body = requestBodyText(scenario);
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, {
      method: "POST",
      headers: {
        ...scenario.headers,
        ...workerAuthorityHeaders(scenario.workerAuthority),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === null ? {} : { body }),
    });
    const actualCookie = request.headers.get("cookie");
    if (actualCookie !== (cookie ?? null))
      throw new Error("Certifier Cookie header differs from recipe");
    if (actualCookie !== null) {
      const value = actualCookie.slice(actualCookie.indexOf("=") + 1);
      const parts = value.split(".");
      for (const secret of [actualCookie, value, parts.slice(0, -1).join("."), parts.at(-1)!])
        cookieSecrets.add(secret);
    }
    const digests = workerAuthorityDigests(request.headers);
    expect(digests).toEqual(
      workerAuthorityDigests(new Headers(workerAuthorityHeaders(scenario.workerAuthority))),
    );
    guard.cookie(request.headers.get("cookie"));
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      handlers[scenario.route]!(request, {
        params: Promise.resolve({ id: scenario.params.id ?? "unused-collection-parameter" }),
      }),
    );
    records.push(
      await guard.capture(
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
          workerAuthority: scenario.workerAuthority,
          ...digests,
        },
        response,
        request.headers,
      ),
    );
    const after = await snapshot();
    expect(certifierReplayStateProblems(previous, after, scenario)).toEqual([]);
    expected = expectedCertifierReplayState(expected, scenario);
    expect(after, `${scenario.id}: cumulative complete rows`).toEqual(expected);
    perRequest.push({
      id: scenario.id,
      before: focused(previous),
      after: focused(after),
      otherTablesBefore: otherDigest(previous),
      otherTablesAfter: otherDigest(after),
    });
  }
  const after = await snapshot();
  expect(after, "complete final cumulative state").toEqual(expected);
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
    independentlyAssertedFields: ["CertifierCredential.lastUsedAt"],
  };
  if (certifierReplayCapabilityProblems(records, state, [...cookieSecrets]).length)
    throw new Error("Certifier capability output refused");
  guard.value([capture, state]);
  expect(validateCapture(capture, scenarios, sign)).toEqual([]);
  writeFileSync(out, `${JSON.stringify(capture, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(`${out}.state.json`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}, 240_000);
