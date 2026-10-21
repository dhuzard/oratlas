import type { prisma as AppPrisma } from "@/lib/db";
import { PLATFORM_VERSION } from "@oratlas/config";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
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
import { nativeClockUpdateProblems } from "./native-clock-observation.js";
import { FRESH_REMOVAL_STEPS, FRESH_REMOVAL_SCENARIOS } from "./fresh-removal-scenarios.js";

// Standalone observational evidence, never the shared G1 exact state/golden program.
const CLOCK_SKEW_BUDGET_MS = 1000;
type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[]>> },
) => Response | Promise<Response>;
let output: string;
let prisma: typeof AppPrisma;
let sign: SessionSigner;
let modules: Record<string, Record<string, unknown>>;
beforeAll(async () => {
  output = assertPublicChildEnv(process.env, "G1_FRESH_REMOVAL_OUT");
  nextInternals();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  vi.stubGlobal("fetch", () => {
    throw new Error("Outbound HTTP forbidden in synthetic removal observation");
  });
  modules = {
    "api/comments/[id]": await import("@/app/api/comments/[id]/route"),
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
const epochNow = () => performance.timeOrigin + performance.now();
const snapshot = async () => ({
  comments: await prisma.reviewComment.findMany({ orderBy: { id: "asc" } }),
  notifications: await prisma.notification.findMany({ orderBy: { id: "asc" } }),
  users: await prisma.user.findMany({ orderBy: { id: "asc" } }),
  audit: await prisma.auditEvent.findMany({ orderBy: { id: "asc" } }),
});
it("retains raw native clocks and audit identity while observing three real soft-deletion transitions", async () => {
  const initial = await snapshot();
  const records: HttpRecord[] = [];
  const observations: unknown[] = [];
  for (const step of FRESH_REMOVAL_STEPS) {
    const scenario = step.scenario;
    const before = await snapshot();
    const cookie = cookieHeader(scenario.session, sign);
    const request = new Request(`${G1_BASE_URL}${scenario.path}`, {
      method: scenario.method,
      headers: { ...scenario.headers, ...(cookie ? { cookie } : {}) },
    });
    const handler = modules[scenario.route]?.[scenario.method] as Handler;
    const beforeEpochMs = epochNow();
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      handler(request, { params: Promise.resolve({ ...scenario.params }) }),
    );
    const after = await snapshot();
    const afterEpochMs = epochNow();
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
    if (!step.removal) {
      expect(after, scenario.id).toEqual(before); // all native times, retained bytes and audit IDs included
    } else {
      const target = step.removal;
      const old = before.comments.find((row) => row.id === target.id)!;
      const updated = after.comments.find((row) => row.id === target.id)!;
      expect(old.status).toBe("visible");
      expect(
        nativeClockUpdateProblems({
          beforeUpdatedAt: old.updatedAt.toISOString(),
          afterUpdatedAt: updated.updatedAt.toISOString(),
          beforeEpochMs,
          afterEpochMs,
          skewBudgetMs: CLOCK_SKEW_BUDGET_MS,
        }),
        scenario.id,
      ).toEqual([]);
      expect(after.comments, scenario.id).toEqual(
        before.comments.map((row) =>
          row.id === target.id
            ? {
                ...row,
                status: "removed",
                removedById: target.actorId,
                removedAt: new Date(G1_FIXED_CLOCK),
                updatedAt: updated.updatedAt,
              }
            : row,
        ),
      );
      expect(after.notifications).toEqual(before.notifications);
      expect(after.users).toEqual(before.users);
      const oldIds = new Set(before.audit.map((row) => row.id));
      const appended = after.audit.filter((row) => !oldIds.has(row.id));
      expect(appended, scenario.id).toHaveLength(1);
      const event = appended[0]!;
      expect(event.id).toMatch(/^c[0-9a-z]{24,25}$/u);
      expect(
        nativeClockUpdateProblems({
          beforeUpdatedAt: "1970-01-01T00:00:00.000Z",
          afterUpdatedAt: event.createdAt.toISOString(),
          beforeEpochMs,
          afterEpochMs,
          skewBudgetMs: CLOCK_SKEW_BUDGET_MS,
        }),
        scenario.id,
      ).toEqual([]);
      expect(event).toEqual({
        id: event.id,
        actorId: target.actorId,
        action: "comment.removed",
        subjectType: "reviewComment",
        subjectId: target.id,
        detailsJson: JSON.stringify({ reviewSlug: "g1-fixture-review", removedBy: target.by }),
        idempotencyKey: null,
        platformVersion: PLATFORM_VERSION,
        createdAt: event.createdAt,
      });
      expect(after.audit.filter((row) => oldIds.has(row.id))).toEqual(before.audit);
      expect(after.audit).toHaveLength(before.audit.length + 1);
    }
    observations.push({
      id: scenario.id,
      beforeEpochMs,
      afterEpochMs,
      skewBudgetMs: CLOCK_SKEW_BUDGET_MS,
      before,
      after,
    });
  }
  expect((await snapshot()).audit.length - initial.audit.length).toBe(3);
  const capture: CaptureFile = {
    version: G1_CAPTURE_VERSION,
    label: "fresh-removal-observation",
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records,
  };
  writeFileSync(output, JSON.stringify(capture, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(
    output + ".native.json",
    JSON.stringify(
      { scope: "observational; strict native clock equality unresolved", initial, observations },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  expect(validateCapture(capture, FRESH_REMOVAL_SCENARIOS, sign)).toEqual([]);
});
