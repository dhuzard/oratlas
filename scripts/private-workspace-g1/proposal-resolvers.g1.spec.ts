import { writeFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import type { prisma as AppPrisma } from "@/lib/db";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import {
  G1_BASE_URL,
  G1_FIXED_CLOCK,
  G1_CAPTURE_VERSION,
  captureHttp,
  bodyText,
  type HttpRecord,
  type CaptureFile,
} from "./capture.js";
import { assertPublicChildEnv } from "./child-env.js";
import { validateCapture } from "./compare.js";
import { invokeRouteHandler, nextInternals } from "./next-request-context.js";
import { cookieHeader, sha256Text, type SessionSigner } from "./principals.js";
import {
  PUBLIC_SELECT_TABLES,
  PUBLIC_TABLE_GRANTS,
  PUBLIC_COLUMN_UPDATE_GRANTS,
  tablePrivilegesSql,
  columnPrivilegesSql,
} from "./sql.js";
import { publicTableSnapshotSql, type KnownPublicSqlState } from "./known-mutation-state.js";

import {
  proposalResolverScenarios,
  resolverBody,
  RESOLVER_COLUMN_UPDATES,
  RESOLVER_NOTE,
  type ResolverTarget,
} from "./proposal-resolver-scenarios.js";
import targets from "./fixtures/proposal-resolver-targets.json";
const TARGETS = targets as readonly ResolverTarget[];
const SCENARIOS = proposalResolverScenarios(TARGETS);
import { ResolverAuditFixture, RESOLVER_AUDIT_IDS } from "./proposal-resolver-audit.js";
import { auditRevokeDisclosureProblems, auditRevokeCookieSecrets } from "./audit-revoke-safety.js";
import { PLATFORM_VERSION } from "../../packages/config/src/index.js";
import { requestBodyText } from "./scenarios.js";
type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>;
let out: string;
let label: string;
let prisma: typeof AppPrisma;
let sign: SessionSigner;
let handlers: Record<string, Handler>;
let attempts = 0;
let delegatedQueries = 0;
const fixture = new ResolverAuditFixture();
const secrets: string[] = [];
function guard(value: unknown): void {
  if (auditRevokeDisclosureProblems(value, [...new Set(secrets)]).length)
    throw new Error("Audit revocation capability disclosure refused");
}
let authorityScope: { roleContract: string; tables: unknown[]; columns: unknown[] };
beforeAll(async () => {
  out = assertPublicChildEnv(process.env, "G1_PROPOSAL_RESOLVER_OUT");
  label = process.env.G1_CAPTURE_LABEL ?? "";
  if (!["baseline", "baseline-repeat", "after", "after-repeat"].includes(label))
    throw new Error("Invalid proposal resolver capture label");
  nextInternals();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  vi.stubGlobal("fetch", () => {
    attempts++;
    throw new Error("Outbound HTTP forbidden in proposal resolver probe");
  });
  const native = await import("@oratlas/db");
  const base = native.getPrisma();
  const extended = base.$extends({
    name: "g1-unwired-proposal-resolver-input",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return fixture.query(model, operation, args, (prepared) => {
            delegatedQueries++;
            return query(prepared as typeof args);
          });
        },
      },
    },
  });
  vi.doMock("@/lib/db", () => ({ prisma: extended, parseJsonColumn: native.parseJsonColumn }));
  const db = await import("@/lib/db");
  expect(db.prisma).toBe(extended);
  const [protocol, monitoring, session] = await Promise.all([
    import("@/app/api/protocols/proposals/[id]/resolve/route"),
    import("@/app/api/monitoring/proposals/[id]/resolve/route"),
    import("@/lib/session-token"),
  ]);
  prisma = db.prisma;
  sign = session.createSessionToken;
  handlers = {
    "api/protocols/proposals/[id]/resolve": async (request, context) =>
      protocol.POST(request, {
        params: Promise.resolve({ id: (await context?.params)?.id ?? "" }),
      }),
    "api/monitoring/proposals/[id]/resolve": async (request, context) =>
      monitoring.POST(request, {
        params: Promise.resolve({ id: (await context?.params)?.id ?? "" }),
      }),
  };
  const url = new URL(process.env.DATABASE_URL!);
  secrets.push(process.env.DATABASE_URL!, url.password, decodeURIComponent(url.password));
  for (const scenario of SCENARIOS) {
    if (scenario.session.case === "none") continue;
    if (scenario.session.case === "malformed") {
      secrets.push(cookieHeader(scenario.session, sign)!);
      continue;
    }
    const cookie = cookieHeader(scenario.session, sign)!;
    secrets.push(...auditRevokeCookieSecrets(cookie));
  }
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      evidence: {
        user: string;
        current: string;
        privileged: boolean;
        memberships: number;
        owned: number;
        publicCreate: boolean;
        privateExists: boolean;
        privateUsage: boolean;
        privateCreate: boolean;
        tables: unknown[];
        columns: unknown[];
      };
    }>
  >(`SELECT json_build_object(
 'user',session_user::text,'current',current_user::text,
 'privileged',(SELECT rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=session_user),
 'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=session_user)),
 'owned',(SELECT count(*) FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_type WHERE typowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=session_user)),
 'publicCreate',has_schema_privilege(session_user,'public','CREATE'),
 'privateExists',to_regnamespace('private_ws') IS NOT NULL,
 'privateUsage',CASE WHEN to_regnamespace('private_ws') IS NULL THEN false ELSE has_schema_privilege(session_user,'private_ws','USAGE') END,
 'privateCreate',CASE WHEN to_regnamespace('private_ws') IS NULL THEN false ELSE has_schema_privilege(session_user,'private_ws','CREATE') END,
 'tables',${tablePrivilegesSql("session_user")},'columns',${columnPrivilegesSql("session_user")}) AS evidence`);
  const posture = rows[0]!.evidence;
  guard(posture);
  expect(posture.user).toBe(new URL(process.env.DATABASE_URL!).username);
  expect(posture.current).toBe(posture.user);
  expect(posture.privileged).toBe(false);
  expect(posture.memberships).toBe(0);
  expect(posture.owned).toBe(0);
  expect(posture.publicCreate).toBe(false);
  expect(posture.privateUsage).toBe(false);
  expect(posture.privateCreate).toBe(false);
  expect(posture.privateExists).toBe(label.startsWith("after"));
  const sorted = (rows: unknown[]) => rows.map((row) => canonicalJson(row)).sort();
  const tables = PUBLIC_TABLE_GRANTS.flatMap(({ table, privileges }) =>
    privileges.map((p) => [table, p]),
  );
  const columns = [...PUBLIC_COLUMN_UPDATE_GRANTS, ...RESOLVER_COLUMN_UPDATES].flatMap(
    ({ table, columns }) => columns.map((c) => [table, c, "UPDATE"]),
  );
  expect(sorted(posture.tables)).toEqual(sorted(tables));
  expect(sorted(posture.columns)).toEqual(sorted(columns));
  authorityScope = {
    roleContract: "isolated-public-runtime-plus-eight-resolver-columns",
    tables: sorted(tables),
    columns: sorted(columns),
  };
});
afterAll(async () => {
  vi.doUnmock("@/lib/db");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
});
async function snapshot(): Promise<KnownPublicSqlState> {
  const result: Record<string, Record<string, unknown>[]> = {};
  for (const table of PUBLIC_SELECT_TABLES) {
    const rows = await prisma.$queryRawUnsafe<Array<{ rows: Record<string, unknown>[] }>>(
      publicTableSnapshotSql(table),
    );
    result[table] = rows[0]!.rows;
  }
  guard(result);
  return result;
}
it("captures real first resolutions and denied/repeat no-writes with exact full-row state", async () => {
  const before = await snapshot();
  const expected = JSON.parse(JSON.stringify(before)) as KnownPublicSqlState;
  const initialIds = new Set(before.AuditEvent!.map((row) => row.id));
  const expectedAdded: Array<Record<string, unknown>> = [];
  const check = (current: KnownPublicSqlState) => {
    for (const table of PUBLIC_SELECT_TABLES)
      if (table !== "AuditEvent") expect(current[table]).toEqual(expected[table]);
    expect(current.AuditEvent!.filter((row) => initialIds.has(row.id))).toEqual(before.AuditEvent);
    expect(
      current
        .AuditEvent!.filter((row) => !initialIds.has(row.id))
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)),
    ).toEqual(
      [...expectedAdded].sort((a, b) =>
        String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0,
      ),
    );
  };
  const transitions: Array<{ id: string; before: string; after: string }> = [];
  const records: HttpRecord[] = [];
  for (const scenario of SCENARIOS) {
    const beforeRequest = await snapshot();
    check(beforeRequest);
    const beforeDigest = sha256Text(canonicalJson(beforeRequest));
    const cookie = cookieHeader(scenario.session, sign);
    const body = requestBodyText(scenario);
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, {
      method: "POST",
      headers: { ...scenario.headers, ...(cookie ? { cookie } : {}) },
      body: body === null ? undefined : new TextEncoder().encode(body),
    });
    if (request.headers.get("cookie") !== (cookie ?? null))
      throw new Error("Actual cookie differs from synthetic session recipe");
    const actualCookie = request.headers.get("cookie");
    if (scenario.id.includes("missing-origin")) expect(request.headers.has("origin")).toBe(false);
    if (scenario.id.includes("missing-media"))
      expect(request.headers.has("content-type")).toBe(false);
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      handlers[scenario.route]!(request, { params: Promise.resolve({ id: scenario.params.id }) }),
    );
    if (response.headers.has("set-cookie") || response.headers.has("location"))
      throw Error("Unexpected proposal resolver response capability header refused");
    let responseBody: string;
    try {
      responseBody = new TextDecoder("utf-8", { fatal: true }).decode(
        await response.clone().arrayBuffer(),
      );
    } catch {
      throw Error("Audit revocation response UTF-8 refused");
    }
    guard({ headers: Object.fromEntries(response.headers), body: responseBody });
    const recorded = await captureHttp(
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
    );
    guard([recorded, bodyText(recorded)]);
    records.push(recorded);
    if (scenario.expect.status === 200) {
      const target = scenario.target;
      if (!scenario.changes) throw Error("Unexpected resolver success");
      const actorId = target.actor === "EDITOR" ? "g1-user-editor" : "g1-user-admin";
      expect(scenario.principal).toBe(target.actor);
      const table = target.kind === "protocol" ? "ProtocolDriftProposal" : "ClaimUpdateProposal";
      const row = expected[table]!.find((row) => row.id === target.id);
      if (!row || row.status !== "open") throw Error("Resolver fixture must be natively open");
      Object.assign(row, {
        status: resolverBody(target).resolution,
        resolvedById: actorId,
        resolutionNote: RESOLVER_NOTE,
        resolvedAt: "2026-04-01T00:00:00",
      });
      expectedAdded.push({
        id: RESOLVER_AUDIT_IDS[expectedAdded.length],
        actorId,
        action:
          target.kind === "protocol"
            ? "protocol.proposal-resolved"
            : "monitoring.proposal-resolved",
        subjectType:
          target.kind === "protocol" ? "protocol-drift-proposal" : "claim-update-proposal",
        subjectId: target.id,
        detailsJson: canonicalJson({ resolution: resolverBody(target).resolution }),
        idempotencyKey: null,
        platformVersion: PLATFORM_VERSION,
        // Native to_jsonb(timestamp without time zone), with zero fractional seconds.
        createdAt: "2026-04-01T00:00:00",
      });
    }
    const current = await snapshot();
    check(current);
    const afterDigest = sha256Text(canonicalJson(current));
    if (scenario.expect.status >= 400) expect(afterDigest, scenario.id).toBe(beforeDigest);
    else expect(afterDigest, scenario.id).not.toBe(beforeDigest);
    transitions.push({ id: scenario.id, before: beforeDigest, after: afterDigest });
  }
  expect(attempts).toBe(0);
  const after = await snapshot();
  check(after);
  expect(expectedAdded).toHaveLength(4);
  guard(fixture.trace);
  expect(fixture.trace.filter((row) => row.operation === "create")).toHaveLength(4);
  expect(
    fixture.trace.filter((row) => row.operation === "create").map((row) => row.injected),
  ).toEqual(Array(4).fill(["id", "createdAt"]));
  expect(fixture.trace.every((row) => row.queryCalls === 1)).toBe(true);
  expect(delegatedQueries).toBe(fixture.trace.length);
  const capture: CaptureFile = {
    version: G1_CAPTURE_VERSION,
    label,
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records,
  };
  const state = {
    authorityScope,
    tables: PUBLIC_SELECT_TABLES,
    before,
    after,
    transitions,
    outboundAttempts: attempts,
    expectedAdded,
    queryTrace: fixture.trace,
  };
  guard([capture, state, ...records.map(bodyText)]);
  expect(validateCapture(capture, SCENARIOS, sign)).toEqual([]);
  writeFileSync(out, JSON.stringify(capture, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  writeFileSync(out + ".state.json", JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
}, 120_000);
