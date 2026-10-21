import { writeFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { assertPublicChildEnv } from "./child-env.js";
import {
  G1_BASE_URL,
  G1_FIXED_CLOCK,
  G1_CAPTURE_VERSION,
  captureHttp,
  type HttpRecord,
} from "./capture.js";
import { validateCapture } from "./compare.js";
import { invokeRouteHandler, nextInternals } from "./next-request-context.js";
import { cookieHeader, sha256Text, type SessionSigner } from "./principals.js";
import { SYNTHESIS_SCENARIOS } from "./synthesis-scenarios.js";
import { SYNTHESIS_SELECT_TABLES } from "./synthesis-routes.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import type { prisma as AppPrisma } from "@/lib/db";
let output: string;
let prisma: typeof AppPrisma;
let sign: SessionSigner;
let routes: Record<string, Record<string, unknown>>;
beforeAll(async () => {
  output = assertPublicChildEnv(process.env, "G1_SYNTHESIS_OUT");
  nextInternals();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  vi.stubGlobal("fetch", () => {
    throw new Error("Outbound HTTP forbidden in synthetic synthesis probe");
  });
  routes = {
    "api/federation/notifications/[id]":
      await import("@/app/api/federation/notifications/[id]/route"),
    "api/syntheses/[slug]": await import("@/app/api/syntheses/[slug]/route"),
    "api/synthesis/contradictions": await import("@/app/api/synthesis/contradictions/route"),
    "api/federation/inbox": await import("@/app/api/federation/inbox/route"),
    "api/search": await import("@/app/api/search/route"),
    "api/feeds/atom": await import("@/app/api/feeds/atom/route"),
    "api/claims/[versionId]/[localClaimId]":
      await import("@/app/api/claims/[versionId]/[localClaimId]/route"),
  };
  ({ prisma } = await import("@/lib/db"));
  ({ createSessionToken: sign } = await import("@/lib/session-token"));
});
afterAll(async () => {
  await prisma?.$disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function state() {
  const result: Record<string, unknown> = {};
  for (const table of [...new Set([...PUBLIC_SELECT_TABLES, ...SYNTHESIS_SELECT_TABLES])])
    result[table] = await prisma.$queryRawUnsafe(
      `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`,
    );
  return result;
}
it("executes the separately seeded synthesis reads under restricted authority with exact state preservation", async () => {
  const before = await state();
  const records: HttpRecord[] = [];
  for (const scenario of SYNTHESIS_SCENARIOS) {
    const cookie = cookieHeader(scenario.session, sign);
    const headers = { ...scenario.headers, ...(cookie ? { cookie } : {}) };
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, { method: "GET", headers });
    const handler = routes[scenario.route]!.GET as (
      request: Request,
      context?: { params: Promise<Record<string, string | string[]>> },
    ) => Promise<Response>;
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      handler(
        request,
        scenario.params ? { params: Promise.resolve({ ...scenario.params }) } : undefined,
      ),
    );
    records.push(
      await captureHttp(
        {
          id: scenario.id,
          method: "GET",
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
  const after = await state();
  expect(after).toEqual(before);
  const capture = {
    version: G1_CAPTURE_VERSION,
    label: "synthesis-probe",
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records,
  };
  expect(validateCapture(capture, SYNTHESIS_SCENARIOS, sign)).toEqual([]);
  writeFileSync(output + ".state.json", JSON.stringify({ before, after }, null, 2) + "\n", {
    mode: 0o600,
  });
  writeFileSync(output, JSON.stringify(capture, null, 2) + "\n", { mode: 0o600 });
});
