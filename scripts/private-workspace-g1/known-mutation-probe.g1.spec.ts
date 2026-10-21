import { createNativeEvidenceGuard, type NativeEvidenceGuard } from "./native-evidence-guard.js";
import { workerOutputProblems } from "./worker-capture-safety.js";
import type { prisma as AppPrisma } from "@/lib/db";
import { writeFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import {
  G1_BASE_URL,
  G1_FIXED_CLOCK,
  G1_CAPTURE_VERSION,
  type CaptureFile,
  type HttpRecord,
} from "./capture.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import { KNOWN_MUTATION_PROGRAM } from "./known-mutation-descriptor.js";
import {
  publicTableSnapshotSql,
  rowsById,
  knownPublicStateProblems,
  knownMutationLabel,
  type KnownPublicSqlState,
} from "./known-mutation-state.js";
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
let label: string;
let prisma: typeof AppPrisma;
let sign: SessionSigner;
let guard: NativeEvidenceGuard;
let modules: Record<string, Record<string, unknown>>;
beforeAll(async () => {
  output = assertPublicChildEnv(process.env, KNOWN_MUTATION_PROGRAM.outVariable);
  label = knownMutationLabel(process.env.G1_CAPTURE_LABEL);
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
  guard = createNativeEvidenceGuard(sign, process.env.DATABASE_URL!);
});
afterAll(async () => {
  await prisma?.$disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const snapshot = async () =>
  guard.value({
    comments: rowsById(await prisma.reviewComment.findMany({ orderBy: { id: "asc" } })),
    notifications: rowsById(await prisma.notification.findMany({ orderBy: { id: "asc" } })),
    users: rowsById(await prisma.user.findMany({ orderBy: { id: "asc" } })),
    audit: rowsById(await prisma.auditEvent.findMany({ orderBy: { id: "asc" } })),
  });
const publicSnapshot = async (): Promise<KnownPublicSqlState> => {
  const state: Record<string, readonly Record<string, unknown>[]> = {};
  for (const table of PUBLIC_SELECT_TABLES) {
    const result = await prisma.$queryRawUnsafe<Array<{ rows: Record<string, unknown>[] }>>(
      publicTableSnapshotSql(table),
    );
    if (result.length !== 1 || !Array.isArray(result[0]!.rows))
      throw new Error("Invalid public snapshot result");
    state[table] = result[0]!.rows;
  }
  return guard.value(state);
};
it("executes known-ID updates and proves complete rows unchanged after every denial/repeat", async () => {
  // Dedicated program initialized from the six base fixtures. Establish its one read marker
  // using the real handler; this spec is not appended to or a claim to execute1165 requests.
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
  const publicBeforePrefix = await publicSnapshot();
  guard.cookie(prefix.headers.get("cookie"));
  const prefixResponse = await invokeRouteHandler(prefix, "/api/notifications/route", () =>
    handler(prefix),
  );
  await guard.response(prefixResponse);
  expect(prefixResponse.status).toBe(200);
  expect(await prefixResponse.json()).toEqual({ status: "read" });
  const initial = await snapshot();
  const publicInitial = await publicSnapshot();
  expect(
    knownPublicStateProblems(publicBeforePrefix, publicInitial, "g1-notification-a-only-1"),
  ).toEqual([]);
  let publicBefore = publicInitial;
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
    guard.cookie(request.headers.get("cookie"));
    const response = await invokeRouteHandler(request, `/${scenario.route}/route`, () =>
      route(
        request,
        scenario.params ? { params: Promise.resolve({ ...scenario.params }) } : undefined,
      ),
    );
    records.push(
      await guard.capture(
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
    const publicAfter = await publicSnapshot();
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
    expect(
      knownPublicStateProblems(publicBefore, publicAfter, changed ? target : undefined),
      scenario.id,
    ).toEqual([]);
    states.push({ id: scenario.id, state: after, publicState: publicAfter });
    publicBefore = publicAfter;
  }
  const capture: CaptureFile = {
    version: G1_CAPTURE_VERSION,
    label,
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records,
  };
  const stateEvidence = {
    tables: PUBLIC_SELECT_TABLES,
    beforePrefix,
    publicBeforePrefix,
    initial,
    publicInitial,
    states,
  };
  if (workerOutputProblems(JSON.stringify(stateEvidence)).length)
    throw new Error("Worker capability state disclosure refused");
  guard.value([capture, stateEvidence]);
  expect(validateCapture(capture, KNOWN_MUTATION_SCENARIOS, sign)).toEqual([]);
  writeFileSync(output, JSON.stringify(capture, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(output + ".states.json", JSON.stringify(stateEvidence, null, 2) + "\n", {
    mode: 0o600,
  });
});
