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
import { workerOutputProblems } from "./worker-capture-safety.js";
import { POST_INPUTS, DETERMINISTIC_POST_SCENARIOS } from "./deterministic-post-scenarios.js";
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
let authorityScope: { roleContract: string; tables: unknown[]; columns: unknown[] };
beforeAll(async () => {
  out = assertPublicChildEnv(process.env, "G1_DETERMINISTIC_POST_OUT");
  label = process.env.G1_CAPTURE_LABEL ?? "";
  if (!["baseline", "baseline-repeat", "after", "after-repeat"].includes(label))
    throw new Error("Invalid deterministic POST capture label");
  nextInternals();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  vi.stubGlobal("fetch", () => {
    attempts++;
    throw new Error("Outbound HTTP forbidden in deterministic POST probe");
  });
  const [discuss, inbox, announcement, db, session, scope] = await Promise.all([
    import("@/app/api/discuss/route"),
    import("@/app/api/federation/inbox/route"),
    import("@/app/api/reviews/[slug]/versions/[versionId]/federation/announce/route"),
    import("@/lib/db"),
    import("@/lib/session-token"),
    import("@/lib/discussion-scope"),
  ]);
  prisma = db.prisma;
  sign = session.createSessionToken;
  handlers = {
    "api/discuss": discuss.POST,
    "api/federation/inbox": inbox.POST,
    "api/reviews/[slug]/versions/[versionId]/federation/announce": async (request, context) => {
      const p = await context?.params;
      if (!p?.slug || !p.versionId) throw new Error("Missing synthetic announcement parameters");
      return announcement.POST(request, {
        params: Promise.resolve({ slug: p.slug, versionId: p.versionId }),
      });
    },
  };
  for (const issued of Object.values(POST_INPUTS.scopes)) {
    expect(
      scope.issueDiscussionTraversalScope({
        nodes: issued.nodes,
        edges: issued.edgeIds.map((graphEdgeId) => ({ graphEdgeId })),
      }),
    ).toEqual(issued);
    expect(scope.verifyDiscussionTraversalScope(issued)).toEqual(issued);
  }
  // The signed denial controls refer to genuine persisted nonpublic source occurrences.
  const controls = await prisma.knowledgeNodeVersion.findMany({
    where: {
      id: {
        in: [
          POST_INPUTS.scopes.hidden.nodes[0]!.nodeVersionId,
          POST_INPUTS.scopes.tombstone.nodes[0]!.nodeVersionId,
        ],
      },
    },
    include: { sourceClaim: { include: { reviewVersion: { include: { review: true } } } } },
  });
  expect(controls).toHaveLength(2);
  for (const row of controls) {
    expect(row.sourceClaim).not.toBeNull();
    const version = row.sourceClaim!.reviewVersion;
    expect(version.publicState === "tombstoned" || version.review.status !== "published").toBe(
      true,
    );
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
  const columns = PUBLIC_COLUMN_UPDATE_GRANTS.flatMap(({ table, columns }) =>
    columns.map((c) => [table, c, "UPDATE"]),
  );
  expect(sorted(posture.tables)).toEqual(sorted(tables));
  expect(sorted(posture.columns)).toEqual(sorted(columns));
  authorityScope = {
    roleContract: "public-runtime",
    tables: sorted(tables),
    columns: sorted(columns),
  };
});
afterAll(async () => {
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
  return result;
}
it("captures native deterministic discussion and exact federation replays with unchanged complete public state", async () => {
  const before = await snapshot();
  const beforeDigest = sha256Text(canonicalJson(before));
  const transitions: Array<{ id: string; before: string; after: string }> = [];
  const records: HttpRecord[] = [];
  for (const scenario of DETERMINISTIC_POST_SCENARIOS) {
    const cookie = cookieHeader(scenario.session, sign);
    const body = requestBodyText(scenario);
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, {
      method: "POST",
      headers: { ...scenario.headers, ...(cookie ? { cookie } : {}) },
      body,
    });
    if (request.headers.get("cookie") !== (cookie ?? null))
      throw new Error("Actual cookie differs from synthetic session recipe");
    const actualCookie = request.headers.get("cookie");
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      handlers[scenario.route]!(
        request,
        scenario.params ? { params: Promise.resolve(scenario.params) } : undefined,
      ),
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
    if (scenario.id.includes("announce-prepared") && scenario.expect.status === 200)
      expect(sha256Text(canonicalJson(JSON.parse(bodyText(records.at(-1)!))))).toBe(
        POST_INPUTS.announcement.hash,
      );
    const afterDigest = sha256Text(canonicalJson(await snapshot()));
    expect(afterDigest, scenario.id).toBe(beforeDigest);
    transitions.push({ id: scenario.id, before: beforeDigest, after: afterDigest });
  }
  expect(attempts).toBe(0);
  const after = await snapshot();
  expect(after).toEqual(before);
  const capture: CaptureFile = {
    version: G1_CAPTURE_VERSION,
    label,
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records,
  };
  expect(validateCapture(capture, DETERMINISTIC_POST_SCENARIOS, sign)).toEqual([]);
  const state = {
    authorityScope,
    tables: PUBLIC_SELECT_TABLES,
    before,
    after,
    transitions,
    outboundAttempts: attempts,
  };
  if (workerOutputProblems(JSON.stringify(state)).length)
    throw new Error("Worker capability state disclosure refused");
  writeFileSync(out, JSON.stringify(capture, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(out + ".state.json", JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}, 120_000);
