import { writeFileSync } from "node:fs";
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
import { EDITORIAL_READ_SCENARIOS } from "./editorial-read-scenarios.js";

// Opt-in restricted PostgreSQL probe. The orchestrator integration and golden remain root-owned.
type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[]>> },
) => Response | Promise<Response>;
let out: string;
let sign: SessionSigner;
let disconnect: () => Promise<void>;
let modules: Record<string, Record<string, unknown>>;
beforeAll(async () => {
  out = assertPublicChildEnv(process.env, "G1_EDITORIAL_READ_OUT");
  nextInternals();
  vi.stubGlobal("fetch", () => {
    throw new Error("External HTTP blocked in synthetic editorial reads");
  });
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  modules = {
    "api/editorial/process": await import("@/app/api/editorial/process/route"),
    "api/editorial/federation": await import("@/app/api/editorial/federation/route"),
    "api/reviews/[slug]/update-proposals":
      await import("@/app/api/reviews/[slug]/update-proposals/route"),
    "api/federation/inbox": await import("@/app/api/federation/inbox/route"),
  };
  const [token, db] = await Promise.all([import("@/lib/session-token"), import("@/lib/db")]);
  sign = token.createSessionToken;
  disconnect = () => db.prisma.$disconnect();
});
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await disconnect?.();
});
it("captures populated native editorial/federation reads and role/visibility controls", async () => {
  const records: HttpRecord[] = [];
  for (const scenario of EDITORIAL_READ_SCENARIOS) {
    const cookie = cookieHeader(scenario.session, sign);
    const headers = { ...(scenario.headers ?? {}), ...(cookie ? { cookie } : {}) };
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, {
      method: scenario.method,
      headers,
    });
    const handler = modules[scenario.route]?.[scenario.method] as Handler | undefined;
    if (!handler) throw new Error(`Missing real handler ${scenario.route}`);
    const context = scenario.params
      ? { params: Promise.resolve({ ...scenario.params }) }
      : undefined;
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      handler(request, context),
    );
    if (scenario.method === "OPTIONS")
      expect(response.headers.has("access-control-allow-origin")).toBe(false);
    records.push(
      await captureHttp(
        {
          id: scenario.id,
          method: scenario.method,
          path: scenario.path,
          headers: scenario.headers ?? {},
          body: null,
          principal: scenario.principal,
          sessionCase: scenario.session.case,
          session: scenario.session,
          cookieSha256: cookie ? sha256Text(cookie) : null,
        },
        response,
      ),
    );
  }
  const capture: CaptureFile = {
    version: G1_CAPTURE_VERSION,
    label: "editorial-read-probe",
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records,
  };
  writeFileSync(out, `${JSON.stringify(capture, null, 2)}\n`, { mode: 0o600 });
  expect(validateCapture(capture, EDITORIAL_READ_SCENARIOS, sign)).toEqual([]);
});
