import type { prisma as AppPrisma } from "@/lib/db";
import { writeFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
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
import { cookieHeader, sha256Text, validSession, type SessionSigner } from "./principals.js";
import { KNOWN_MUTATION_STEPS, KNOWN_MUTATION_SCENARIOS } from "./known-mutation-scenarios.js";

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[]>> },
) => Response | Promise<Response>;
let output: string;
let prisma: typeof AppPrisma;
let sign: SessionSigner;
let modules: Record<string, Record<string, unknown>>;
beforeAll(async () => {
  output = assertPublicChildEnv(process.env, "G1_KNOWN_MUTATION_OUT");
  nextInternals();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  vi.stubGlobal("fetch", () => {
    throw new Error("Outbound HTTP forbidden in synthetic mutation probe");
  });
  modules = {
    "api/comments/[id]": await import("@/app/api/comments/[id]/route"),
    "api/notifications": await import("@/app/api/notifications/route"),
    "api/reviews/[slug]/versions/[versionId]/comments":
      await import("@/app/api/reviews/[slug]/versions/[versionId]/comments/route"),
  };
  ({ prisma } = await import("@/lib/db"));
  ({ createSessionToken: sign } = await import("@/lib/session-token"));
});
afterAll(async () => {
  await prisma?.$disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const snapshot = async () => ({
  comments: await prisma.reviewComment.findMany({ orderBy: { id: "asc" } }),
  notifications: await prisma.notification.findMany({ orderBy: { id: "asc" } }),
  users: await prisma.user.findMany({ orderBy: { id: "asc" } }),
  audit: await prisma.auditEvent.findMany({ orderBy: { id: "asc" } }),
});
it("executes known-ID updates and proves complete rows unchanged after every denial/repeat", async () => {
  // The integrated1165 program already marks this one row. Establish that precondition here
  // with the real handler, rather than modifying seed SQL or claiming this standalone probe ran1165.
  const headers = {
    "content-type": "application/json",
    origin: G1_BASE_URL,
    "sec-fetch-site": "same-origin",
    cookie: cookieHeader(validSession("A-only"), sign)!,
  };
  const prefix = new Request(`${G1_BASE_URL}/api/notifications`, {
    method: "POST",
    headers,
    body: JSON.stringify({ notificationId: "g1-notification-a-only-1" }),
  });
  const handler = modules["api/notifications"]!.POST as Handler;
  const beforePrefix = await snapshot();
  const prefixResponse = await invokeRouteHandler(prefix, "/api/notifications/route", () =>
    handler(prefix),
  );
  expect(prefixResponse.status).toBe(200);
  const initial = await snapshot();
  expect(initial).toEqual({
    ...beforePrefix,
    notifications: beforePrefix.notifications.map((row) => ({
      ...row,
      readAt: row.id === "g1-notification-a-only-1" ? new Date(G1_FIXED_CLOCK) : row.readAt,
    })),
  });
  const records: HttpRecord[] = [];
  const states: unknown[] = [];
  for (const step of KNOWN_MUTATION_STEPS) {
    const scenario = step.scenario;
    const before = await snapshot();
    const cookie = cookieHeader(scenario.session, sign);
    const body = scenario.body === undefined ? null : JSON.stringify(scenario.body);
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, {
      method: scenario.method,
      headers: { ...scenario.headers, ...(cookie ? { cookie } : {}) },
      ...(body === null ? {} : { body }),
    });
    const route = modules[scenario.route]?.[scenario.method] as Handler;
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      route(
        request,
        scenario.params ? { params: Promise.resolve({ ...scenario.params }) } : undefined,
      ),
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
          cookieSha256: cookie ? sha256Text(cookie) : null,
        },
        response,
      ),
    );
    const after = await snapshot();
    const changed = scenario.id.includes("notification-own-") && scenario.principal !== "anonymous";
    const target = (scenario.body as { notificationId?: string } | undefined)?.notificationId;
    expect(after, scenario.id).toEqual(
      changed
        ? {
            ...before,
            notifications: before.notifications.map((row) => ({
              ...row,
              readAt: row.id === target ? new Date(G1_FIXED_CLOCK) : row.readAt,
            })),
          }
        : before,
    );
    expect(after.comments, scenario.id).toEqual(initial.comments); // includes native updatedAt and retained body bytes
    expect(after.audit, scenario.id).toEqual(initial.audit); // no opaque audit ID/time is excluded in this deterministic subset
    states.push({ id: scenario.id, state: after });
  }
  const capture: CaptureFile = {
    version: G1_CAPTURE_VERSION,
    label: "known-mutation-probe",
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records,
  };
  writeFileSync(output, JSON.stringify(capture, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(output + ".states.json", JSON.stringify({ initial, states }, null, 2) + "\n", {
    mode: 0o600,
  });
  expect(validateCapture(capture, KNOWN_MUTATION_SCENARIOS, sign)).toEqual([]);
});
