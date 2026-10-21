import { createNativeEvidenceGuard, type NativeEvidenceGuard } from "./native-evidence-guard.js";
import { workerAuthorityHeaders, workerAuthorityDigests } from "./worker-authority.js";
import { capabilityHeaderProblems } from "./worker-capture-safety.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deterministicJson,
  G1_BASE_URL,
  G1_CAPTURE_VERSION,
  G1_FIXED_CLOCK,
  textRecord,
  type CaptureFile,
  type CaptureRecord,
  type CapturedRequest,
} from "./capture.js";
import { expectedRequest, validateCapture } from "./compare.js";
import { bindDiscoveryRoutes } from "./discovery-routes.js";
import { bindProtocolRoutes } from "./protocol-routes.js";
import { activeNextStores, invokeRouteHandler, nextInternals } from "./next-request-context.js";
import { assertPublicChildEnv } from "./child-env.js";
import { cookieHeader, sha256Text, type SessionSigner } from "./principals.js";
import {
  requestBodyText,
  SCENARIOS,
  STATE_EXCLUDED_FIELDS,
  type HttpScenario,
  type StateProjection,
} from "./scenarios.js";

// T-PUB capture of the reviewed ordered scenario program (scenarios.ts). Runs only in a fresh
// child process that the orchestrator starts after a fixture reset, holding the PUBLIC runtime URL
// as DATABASE_URL and nothing else. Real production route handlers, `getCurrentUser`, the session
// token functions and the real Prisma client run unmodified inside an actual Next 15.5 request
// context (next-request-context.ts); only `server-only` is aliased, Date (only) is fixed and
// outbound HTTP is blocked. This is handler + request-context evidence, not a running Next server.

function captureConfig(): { out: string; label: string } {
  const out = assertPublicChildEnv(process.env, "G1_CAPTURE_OUT");
  const label = process.env.G1_CAPTURE_LABEL;
  if (!label || !/^[a-z0-9-]{1,40}$/u.test(label)) throw new Error("G1_CAPTURE_LABEL is required");
  return { out, label };
}

type RouteModule = Record<string, unknown>;
type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[]>> },
) => unknown;

const ROUTE_MODULES: Readonly<Record<string, () => Promise<RouteModule>>> = {
  "api/auth/github/start": () => import("@/app/api/auth/github/start/route"),
  "api/auth/github/callback": () => import("@/app/api/auth/github/callback/route"),
  ...bindProtocolRoutes({
    "api/execution-passports/[id]": () => import("@/app/api/execution-passports/[id]/route"),
    "api/verification-runs/[id]": () => import("@/app/api/verification-runs/[id]/route"),
    "api/verification-runs/[id]/findings": () =>
      import("@/app/api/verification-runs/[id]/findings/route"),
    "api/verification-artifacts/[id]/content": () =>
      import("@/app/api/verification-artifacts/[id]/content/route"),
    "api/publication-versions/[id]/verifications": () =>
      import("@/app/api/publication-versions/[id]/verifications/route"),
    "api/certification-results/[id]": () => import("@/app/api/certification-results/[id]/route"),
    "api/publication-versions/[id]/certifications": () =>
      import("@/app/api/publication-versions/[id]/certifications/route"),
    "api/verification-runs/[id]/input": () =>
      import("@/app/api/verification-runs/[id]/input/route"),
    "api/verification-runs/[id]/source-artifacts/[artifactId]": () =>
      import("@/app/api/verification-runs/[id]/source-artifacts/[artifactId]/route"),
    "api/certification-runs/[id]": () => import("@/app/api/certification-runs/[id]/route"),
    "api/certification-runs/[id]/input": () =>
      import("@/app/api/certification-runs/[id]/input/route"),
  }),
  "api/editorial/process": () => import("@/app/api/editorial/process/route"),
  "api/editorial/federation": () => import("@/app/api/editorial/federation/route"),
  "api/reviews/[slug]/update-proposals": () =>
    import("@/app/api/reviews/[slug]/update-proposals/route"),
  "api/federation/inbox": () => import("@/app/api/federation/inbox/route"),
  ...bindDiscoveryRoutes({
    "api/graph": () => import("@/app/api/graph/route"),
    "api/search": () => import("@/app/api/search/route"),
    "api/nodes": () => import("@/app/api/nodes/route"),
    "api/nodes/[id]": () => import("@/app/api/nodes/[id]/route"),
    "api/nodes/[id]/versions": () => import("@/app/api/nodes/[id]/versions/route"),
    "api/nodes/[id]/versions/[versionId]": () =>
      import("@/app/api/nodes/[id]/versions/[versionId]/route"),
    "api/nodes/[id]/edges": () => import("@/app/api/nodes/[id]/edges/route"),
    "api/claims/[versionId]/[localClaimId]": () =>
      import("@/app/api/claims/[versionId]/[localClaimId]/route"),
    "api/landscape": () => import("@/app/api/landscape/route"),
    "api/reviews/[slug]": () => import("@/app/api/reviews/[slug]/route"),
    "api/reviews/[slug]/versions/[versionId]": () =>
      import("@/app/api/reviews/[slug]/versions/[versionId]/route"),
    "api/reviews/[slug]/diff": () => import("@/app/api/reviews/[slug]/diff/route"),
    "api/reviews/[slug]/versions/[versionId]/export/[format]": () =>
      import("@/app/api/reviews/[slug]/versions/[versionId]/export/[format]/route"),
    "api/publications/[id]": () => import("@/app/api/publications/[id]/route"),
    "api/publications/[id]/relations": () => import("@/app/api/publications/[id]/relations/route"),
    "api/publication-versions/[id]": () => import("@/app/api/publication-versions/[id]/route"),
    "api/publication-versions/[id]/content": () =>
      import("@/app/api/publication-versions/[id]/content/route"),
    "api/publication-versions/[id]/contributors": () =>
      import("@/app/api/publication-versions/[id]/contributors/route"),
    "api/publication-versions/[id]/production-provenance": () =>
      import("@/app/api/publication-versions/[id]/production-provenance/route"),
    "api/publication-claim-occurrences/[id]": () =>
      import("@/app/api/publication-claim-occurrences/[id]/route"),
  }),
  "api/nodes/[id]/exports/challenges.json": () =>
    import("@/app/api/nodes/[id]/exports/challenges.json/route"),
  "api/nodes/[id]/exports/challenges-ro-crate": () =>
    import("@/app/api/nodes/[id]/exports/challenges-ro-crate/route"),
  "api/reviews/[slug]/comments": () => import("@/app/api/reviews/[slug]/comments/route"),
  "api/reviews/[slug]/versions/[versionId]/comments": () =>
    import("@/app/api/reviews/[slug]/versions/[versionId]/comments/route"),
  "api/reviews/[slug]/versions/[versionId]/annotations": () =>
    import("@/app/api/reviews/[slug]/versions/[versionId]/annotations/route"),
  "api/reviews/[slug]/versions/[versionId]/challenges": () =>
    import("@/app/api/reviews/[slug]/versions/[versionId]/challenges/route"),
  "api/nodes/[id]/challenges": () => import("@/app/api/nodes/[id]/challenges/route"),
  "api/replications": () => import("@/app/api/replications/route"),
  "api/replications/[slug]": () => import("@/app/api/replications/[slug]/route"),
  "api/protocols/reviews/[versionId]": () =>
    import("@/app/api/protocols/reviews/[versionId]/route"),
  "api/certifiers": () => import("@/app/api/certifiers/route"),
  "api/certifiers/[id]": () => import("@/app/api/certifiers/[id]/route"),
  "api/verifiers": () => import("@/app/api/verifiers/route"),
  "api/verifiers/[id]": () => import("@/app/api/verifiers/[id]/route"),
  "api/certification-protocols": () => import("@/app/api/certification-protocols/route"),
  "api/certification-protocols/[id]": () => import("@/app/api/certification-protocols/[id]/route"),
  "api/verification-protocols": () => import("@/app/api/verification-protocols/route"),
  "api/verification-protocols/[id]": () => import("@/app/api/verification-protocols/[id]/route"),
  "api/editorial/verifiers/[id]/status": () =>
    import("@/app/api/editorial/verifiers/[id]/status/route"),
  "api/editorial/verification-protocols/[id]/retire": () =>
    import("@/app/api/editorial/verification-protocols/[id]/retire/route"),
  "api/editorial/certification-protocols/[id]/retire": () =>
    import("@/app/api/editorial/certification-protocols/[id]/retire/route"),
  "api/publication-captures/[id]": () => import("@/app/api/publication-captures/[id]/route"),
  "api/publication-versions/[id]/packet": () =>
    import("@/app/api/publication-versions/[id]/packet/route"),
  "api/reviews/[slug]/versions/[versionId]/files/[...path]": () =>
    import("@/app/api/reviews/[slug]/versions/[versionId]/files/[...path]/route"),
  "api/health/ready": () => import("@/app/api/health/ready/route"),
  "api/health": () => import("@/app/api/health/route"),
  "api/feeds/atom": () => import("@/app/api/feeds/atom/route"),
  "llms.txt": () => import("@/app/llms.txt/route"),
  "openapi.yaml": () => import("@/app/openapi.yaml/route"),
  "openapi.json": () => import("@/app/openapi.json/route"),
  "api/search": () => import("@/app/api/search/route"),
  "api/claims": () => import("@/app/api/claims/route"),
  "api/graph": () => import("@/app/api/graph/route"),
  "api/feeds/lifecycle": () => import("@/app/api/feeds/lifecycle/route"),
  "api/notifications": () => import("@/app/api/notifications/route"),
  "api/profile/orcid": () => import("@/app/api/profile/orcid/route"),
  "api/editorial/ora-certifications": () => import("@/app/api/editorial/ora-certifications/route"),
  "api/editorial/certifiers/[id]/status": () =>
    import("@/app/api/editorial/certifiers/[id]/status/route"),
};

type Prisma = {
  $disconnect(): Promise<void>;
  user: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
  notification: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
  certifier: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
  auditEvent: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
};

let config: { out: string; label: string };
let modules: Map<string, RouteModule>;
let loaders: { sitemap: () => Promise<unknown>; robots: () => unknown };
let prisma: Prisma;
let sign: SessionSigner;
let guard: NativeEvidenceGuard;

beforeAll(async () => {
  config = captureConfig();
  // Inherited provider trust remains forbidden. Only these committed public
  // synthetic verification keys are injected after the closed-env assertion.
  vi.stubEnv(
    "EXECUTION_PASSPORT_TRUSTED_KEYS_JSON",
    readFileSync(
      resolve(process.cwd(), "scripts/private-workspace-g1/fixtures/protocol-trusted-keys.json"),
      "utf8",
    ),
  );
  const { resetServerEnvCache } = await import("../../packages/config/src/index.js");
  resetServerEnvCache();
  nextInternals(); // fail fast before any capture if the request context cannot be real
  vi.stubGlobal("fetch", () => {
    throw new Error("External HTTP is blocked in the G1 capture");
  });
  modules = new Map();
  for (const [route, load] of Object.entries(ROUTE_MODULES)) modules.set(route, await load());
  const [sitemap, robots, db, token] = await Promise.all([
    import("@/app/sitemap"),
    import("@/app/robots"),
    import("@/lib/db"),
    import("@/lib/session-token"),
  ]);
  loaders = { sitemap: sitemap.default, robots: robots.default };
  prisma = db.prisma as unknown as Prisma;
  sign = token.createSessionToken;
  guard = createNativeEvidenceGuard(sign, process.env.DATABASE_URL!);
});

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const { resetServerEnvCache } = await import("../../packages/config/src/index.js");
  resetServerEnvCache();
  await prisma?.$disconnect();
});

function lowerCaseHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

async function runHttp(scenario: HttpScenario, earlier: Map<string, CaptureRecord>) {
  const derived = expectedRequest(scenario, earlier);
  if ("problem" in derived) throw new Error(`${scenario.id}: ${derived.problem}`);
  const headers = lowerCaseHeaders(derived.headers);
  if (capabilityHeaderProblems(headers).length)
    throw new Error("Raw request capability header refused");
  const cookie = cookieHeader(scenario.session, sign);
  const body = requestBodyText(scenario);
  const captured: CapturedRequest = {
    id: scenario.id,
    method: scenario.method,
    path: derived.path,
    headers,
    body,
    principal: scenario.principal,
    sessionCase: scenario.session.case,
    session: scenario.session,
    cookieSha256: cookie === undefined ? null : sha256Text(cookie),
  };
  const request = new Request(`${G1_BASE_URL}${derived.path}`, {
    method: scenario.method,
    headers: {
      ...headers,
      ...(cookie === undefined ? {} : { cookie }),
      ...(scenario.workerAuthority ? workerAuthorityHeaders(scenario.workerAuthority) : {}),
    },
    ...(body === null ? {} : { body }),
  });
  // The dispatched Cookie header is exactly the recipe's (no ambient cookie, no dropped identity).
  if (request.headers.get("cookie") !== (cookie ?? null)) {
    throw new Error(`${scenario.id}: dispatched cookie differs from the recipe`);
  }
  const handler = modules.get(scenario.route)?.[scenario.method] as Handler | undefined;
  if (!handler)
    throw new Error(`${scenario.id}: no ${scenario.method} handler for ${scenario.route}`);
  const context = scenario.params ? { params: Promise.resolve({ ...scenario.params }) } : undefined;
  guard.cookie(request.headers.get("cookie"));
  const response = await invokeRouteHandler(
    request,
    `/${scenario.route}/route`,
    async () => (await handler(request, context)) as Response,
  );
  return guard.capture(
    {
      ...captured,
      ...(scenario.workerAuthority
        ? { workerAuthority: scenario.workerAuthority, ...workerAuthorityDigests(request.headers) }
        : {}),
    },
    response,
    request.headers,
  );
}

const byCodeUnits = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** Deterministic state projection read through the same restricted public connection. */
async function stateProjection(): Promise<StateProjection> {
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);
  const [users, notifications, certifiers, audit] = await Promise.all([
    prisma.user.findMany({ select: { id: true, role: true, orcid: true, orcidVerifiedAt: true } }),
    prisma.notification.findMany({ select: { id: true, userId: true, readAt: true } }),
    prisma.certifier.findMany({
      select: { id: true, status: true, activatedAt: true, retiredAt: true },
    }),
    prisma.auditEvent.findMany({
      select: {
        actorId: true,
        action: true,
        subjectType: true,
        subjectId: true,
        detailsJson: true,
      },
    }),
  ]);
  guard.value([users, notifications, certifiers, audit]);
  const events = audit.map((event) => ({
    actorId: (event.actorId as string | null) ?? null,
    action: event.action as string,
    subjectType: event.subjectType as string,
    subjectId: event.subjectId as string,
    details: JSON.parse(event.detailsJson as string) as unknown,
  }));
  return {
    users: users
      .map((user) => ({
        id: user.id as string,
        role: user.role as string,
        orcid: (user.orcid as string | null) ?? null,
        orcidVerifiedAt: iso(user.orcidVerifiedAt),
      }))
      .sort((left, right) => byCodeUnits(left.id, right.id)),
    notifications: notifications
      .map((row) => ({
        id: row.id as string,
        userId: row.userId as string,
        readAt: iso(row.readAt),
      }))
      .sort((left, right) => byCodeUnits(left.id, right.id)),
    certifiers: certifiers
      .map((row) => ({
        id: row.id as string,
        status: row.status as string,
        activatedAt: iso(row.activatedAt),
        retiredAt: iso(row.retiredAt),
      }))
      .sort((left, right) => byCodeUnits(left.id, right.id)),
    audit: {
      count: events.length,
      events: events.sort((left, right) =>
        byCodeUnits(
          `${left.action}|${left.actorId}|${left.subjectId}`,
          `${right.action}|${right.actorId}|${right.subjectId}`,
        ),
      ),
    },
    excluded: STATE_EXCLUDED_FIELDS,
  };
}

async function runProgram(): Promise<CaptureRecord[]> {
  const records: CaptureRecord[] = [];
  const earlier = new Map<string, CaptureRecord>();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  try {
    for (const scenario of SCENARIOS) {
      let record: CaptureRecord;
      if (scenario.kind === "http") record = await runHttp(scenario, earlier);
      else if (scenario.kind === "metadata-loader") {
        const output =
          scenario.loader === "app/sitemap.ts" ? await loaders.sitemap() : loaders.robots();
        record = {
          ...textRecord("metadata-loader", scenario.id, deterministicJson(guard.value(output))),
          loader: scenario.loader,
        };
      } else {
        record = textRecord("db-state", scenario.id, deterministicJson(await stateProjection()));
      }
      records.push(record);
      earlier.set(record.id, record);
    }
  } finally {
    vi.useRealTimers();
  }
  return guard.value(records);
}

describe("G1 T-PUB scenario program (restricted public role, real handlers in a Next request context)", () => {
  it("captures the reviewed program exactly and writes it for comparison", async () => {
    const capture: CaptureFile = {
      version: G1_CAPTURE_VERSION,
      label: config.label,
      baseUrl: G1_BASE_URL,
      clock: G1_FIXED_CLOCK,
      records: await runProgram(),
    };
    guard.value(capture);
    // No request context survives the program; validate before creating a retained candidate.
    expect(activeNextStores()).toEqual({ work: false, workUnit: false });
    expect(validateCapture(capture, SCENARIOS, sign)).toEqual([]);
    mkdirSync(dirname(config.out), { recursive: true });
    writeFileSync(config.out, `${JSON.stringify(capture, null, 2)}\n`, { mode: 0o600 });
  });
});
