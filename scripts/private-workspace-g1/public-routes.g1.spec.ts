import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  captureHttp,
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
type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => unknown;

const ROUTE_MODULES: Readonly<Record<string, () => Promise<RouteModule>>> = {
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

beforeAll(async () => {
  config = captureConfig();
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
});

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  if ("cookie" in headers) throw new Error(`${scenario.id}: cookies come from the session recipe`);
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
    headers: { ...headers, ...(cookie === undefined ? {} : { cookie }) },
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
  const response = await invokeRouteHandler(
    request,
    `/${scenario.route}/route`,
    async () => (await handler(request, context)) as Response,
  );
  return captureHttp(captured, response);
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
          ...textRecord("metadata-loader", scenario.id, deterministicJson(output)),
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
  return records;
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
    mkdirSync(dirname(config.out), { recursive: true });
    writeFileSync(config.out, `${JSON.stringify(capture, null, 2)}\n`, { mode: 0o600 });
    // No request context survives the program.
    expect(activeNextStores()).toEqual({ work: false, workUnit: false });
    expect(validateCapture(capture, SCENARIOS, sign)).toEqual([]);
  });
});
