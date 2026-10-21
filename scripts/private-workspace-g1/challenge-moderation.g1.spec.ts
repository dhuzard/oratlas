import { readPublicSnapshot } from "./public-snapshot.js";
import { writeFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import type { prisma as AppPrisma } from "@/lib/db";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import {
  G1_BASE_URL,
  G1_FIXED_CLOCK,
  G1_CAPTURE_VERSION,
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
import { type KnownPublicSqlState } from "./known-mutation-state.js";

import {
  CHALLENGE_MODERATION_SCENARIOS,
  CHALLENGE_MODERATION_TARGETS,
  CHALLENGE_MODERATION_AUDIT_IDS,
} from "./challenge-moderation-scenarios.js";
import { createNativeEvidenceGuard, type NativeEvidenceGuard } from "./native-evidence-guard.js";
import { ChallengeModerationInputFixture } from "./challenge-moderation-audit.js";
import { CHALLENGE_MODERATION_EXTRA_COLUMNS } from "./challenge-moderation-scenarios.js";
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
const fixture = new ChallengeModerationInputFixture();
let evidence: NativeEvidenceGuard;
function guard(value: unknown): void {
  evidence.value(value);
}
let authorityScope: { roleContract: string; tables: unknown[]; columns: unknown[] };
beforeAll(async () => {
  out = assertPublicChildEnv(process.env, "G1_CHALLENGE_MODERATION_OUT");
  label = process.env.G1_CAPTURE_LABEL ?? "";
  if (!["baseline", "baseline-repeat", "after", "after-repeat"].includes(label))
    throw new Error("Invalid challenge moderation capture label");
  nextInternals();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  vi.stubGlobal("fetch", () => {
    attempts++;
    throw new Error("Outbound HTTP forbidden in challenge moderation probe");
  });
  const native = await import("../../packages/db/src/index.js");
  const base = native.getPrisma();
  const extended = base.$extends({
    name: "g1-unwired-challenge-moderation-input",
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
  const [moderation, listing, session] = await Promise.all([
    import("@/app/api/challenges/[id]/moderation/route"),
    import("@/app/api/reviews/[slug]/versions/[versionId]/challenges/route"),
    import("@/lib/session-token"),
  ]);
  expect(db.prisma).toBe(extended);
  prisma = db.prisma;
  sign = session.createSessionToken;
  evidence = createNativeEvidenceGuard(
    sign,
    process.env.DATABASE_URL!,
    CHALLENGE_MODERATION_SCENARIOS.map((s) => s.session),
  );
  handlers = {
    "api/challenges/[id]/moderation": async (request, context) =>
      moderation.POST(request, {
        params: Promise.resolve({ id: (await context?.params)?.id ?? "" }),
      }),
    "api/reviews/[slug]/versions/[versionId]/challenges": (request) =>
      listing.GET(request, {
        params: Promise.resolve({ slug: "g1-fixture-review", versionId: "g1-version-2" }),
      }),
  };
  for (const target of CHALLENGE_MODERATION_TARGETS) {
    const row = await prisma.challenge.findUnique({
      where: { id: target.id },
      include: { response: true },
    });
    guard(row);
    expect(row?.contentStatus).toBe("visible");
    expect(row?.contentRevision).toBe(0);
    expect(row?.status).toBe("dismissed");
    expect(row?.revision).toBe(2);
    expect(row?.activeChallengerSubjectKey).toBe(null);
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
  const declaredColumns = [
    ...PUBLIC_COLUMN_UPDATE_GRANTS.flatMap(({ table, columns }) =>
      columns.map((c) => [table, c, "UPDATE"]),
    ),
    ...CHALLENGE_MODERATION_EXTRA_COLUMNS.map((c) => ["Challenge", c, "UPDATE"]),
  ];
  // Exact union permits later explicitly reviewed global activation without duplicate tuples.
  const columns = [...new Map(declaredColumns.map((row) => [canonicalJson(row), row])).values()];
  expect(sorted(posture.tables)).toEqual(sorted(tables));
  expect(sorted(posture.columns)).toEqual(sorted(columns));
  authorityScope = {
    roleContract: "public-runtime",
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
  const result = await readPublicSnapshot(prisma);
  guard(result);
  return result;
}
it("captures native terminal-challenge tombstones and public observers with exact cumulative writes", async () => {
  const before = await snapshot();
  const initialIds = new Set(before.AuditEvent!.map((row) => row.id));
  const expectedAdded: Array<Record<string, unknown>> = [];
  const check = (current: KnownPublicSqlState) => {
    for (const table of PUBLIC_SELECT_TABLES) {
      if (table === "AuditEvent") continue;
      const expected = before[table]!.map((row) => {
        if (table !== "Challenge") return row;
        const target = CHALLENGE_MODERATION_TARGETS.find((t) => t.id === row.id);
        if (!target || !expectedAdded.some((a) => a.subjectId === target.id)) return row;
        return {
          ...row,
          contentStatus: "removed",
          contentRevision: 1,
          removedAt: "2026-04-01T00:00:00",
          updatedAt: "2026-04-01T00:00:00",
          removedById: target.actorId,
          removedByRoleSnapshot: target.role,
        };
      });
      expect(current[table]).toEqual(expected);
    }
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
  for (const scenario of CHALLENGE_MODERATION_SCENARIOS) {
    const beforeRequest = await snapshot();
    check(beforeRequest);
    const beforeDigest = sha256Text(canonicalJson(beforeRequest));
    const cookie = cookieHeader(scenario.session, sign);
    const body = requestBodyText(scenario);
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, {
      method: scenario.method,
      headers: { ...scenario.headers, ...(cookie ? { cookie } : {}) },
      body: body === null ? undefined : new TextEncoder().encode(body),
    });
    if (request.headers.get("cookie") !== (cookie ?? null))
      throw new Error("Actual cookie differs from synthetic session recipe");
    const actualCookie = request.headers.get("cookie");
    evidence.cookie(actualCookie);
    if (scenario.id.includes("missing-origin")) expect(request.headers.has("origin")).toBe(false);
    if (scenario.id.includes("missing-media"))
      expect(request.headers.has("content-type")).toBe(false);
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      handlers[scenario.route]!(request, { params: Promise.resolve({ id: scenario.params.id }) }),
    );
    if (response.headers.has("set-cookie") || response.headers.has("location"))
      throw Error("Unexpected challenge moderation response capability header refused");
    let responseBody: string;
    try {
      responseBody = new TextDecoder("utf-8", { fatal: true }).decode(
        await response.clone().arrayBuffer(),
      );
    } catch {
      throw Error("Response moderation UTF-8 refused");
    }
    guard({ headers: Object.fromEntries(response.headers), body: responseBody });
    const recorded = await evidence.capture(
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
      },
      response,
      request.headers,
    );
    guard([recorded, bodyText(recorded)]);
    records.push(recorded);
    if (scenario.method === "POST" && scenario.expect.status === 200) {
      const target = CHALLENGE_MODERATION_TARGETS.find(
        (target) => target.id === scenario.params.id,
      )!;
      expect(scenario.principal).toBe(target.principal);
      expectedAdded.push({
        id: CHALLENGE_MODERATION_AUDIT_IDS[expectedAdded.length],
        actorId: target.actorId,
        action: "challenge.content-removed",
        subjectType: "challenge",
        subjectId: target.id,
        detailsJson: canonicalJson({
          contentHash: target.contentHash,
          contentRevision: 1,
        }),
        idempotencyKey: null,
        platformVersion: PLATFORM_VERSION,
        // Native to_jsonb(timestamp without time zone), with zero fractional seconds.
        createdAt: "2026-04-01T00:00:00",
      });
    }
    const current = await snapshot();
    check(current);
    const afterDigest = sha256Text(canonicalJson(current));
    if (scenario.expect.status >= 400 || scenario.method === "GET")
      expect(afterDigest, scenario.id).toBe(beforeDigest);
    else expect(afterDigest, scenario.id).not.toBe(beforeDigest);
    transitions.push({ id: scenario.id, before: beforeDigest, after: afterDigest });
  }
  expect(attempts).toBe(0);
  const after = await snapshot();
  check(after);
  expect(expectedAdded).toHaveLength(3);
  expect(fixture.updateTrace).toEqual(
    CHALLENGE_MODERATION_TARGETS.map((target) => ({ target: target.id, injected: ["updatedAt"] })),
  );
  guard(fixture.trace);
  expect(fixture.trace.filter((row) => row.operation === "create")).toHaveLength(3);
  expect(
    fixture.trace.filter((row) => row.operation === "create").map((row) => row.injected),
  ).toEqual([
    ["id", "createdAt"],
    ["id", "createdAt"],
    ["id", "createdAt"],
  ]);
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
    suppliedUpdateInputs: fixture.updateTrace,
  };
  guard([capture, state, ...records.map(bodyText)]);
  expect(validateCapture(capture, CHALLENGE_MODERATION_SCENARIOS, sign)).toEqual([]);
  writeFileSync(out, JSON.stringify(capture, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  writeFileSync(out + ".state.json", JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
}, 120_000);
