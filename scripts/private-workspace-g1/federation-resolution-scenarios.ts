import type { SupplementalProgram } from "./supplemental-channel.js";
import { readFileSync } from "node:fs";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { G1_BASE_URL } from "./capture.js";
import {
  NO_SESSION,
  NEGATIVE_SESSIONS,
  PRINCIPAL_LABELS,
  validSession,
  type PrincipalLabel,
} from "./principals.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";
export const FEDERATION_RESOLUTION_NATIVE = JSON.parse(
  readFileSync(new URL("./fixtures/federation-resolution-native.json", import.meta.url), "utf8"),
) as {
  inputs: Record<string, unknown>[];
  receipts: Array<{ id: string; activityId: string; status: string }>;
  notifications: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  outbound: number;
};
export const FEDERATION_RESOLUTION_TARGETS = [
  {
    id: FEDERATION_RESOLUTION_NATIVE.receipts[0]!.id,
    actorId: "g1-user-editor",
    principal: "EDITOR",
    decision: "accepted",
    note: "Synthetic request accepted for metadata testing; no scientific endorsement.",
  },
  {
    id: FEDERATION_RESOLUTION_NATIVE.receipts[1]!.id,
    actorId: "g1-user-admin",
    principal: "ADMIN",
    decision: "rejected",
    note: "Synthetic request rejected for metadata testing; no scientific assessment.",
  },
] as const;
export const FEDERATION_RESOLUTION_EXTRA_COLUMNS = [
  "status",
  "resolutionNote",
  "resolvedById",
  "resolvedAt",
] as const;
export const FEDERATION_RESOLUTION_ADDED_ROWS = { FederationNotification: 2, AuditEvent: 2 };
export type FederationResolutionScenario = HttpScenario & {
  readonly params: Readonly<{ id: string }>;
};
const route = "api/editorial/federation/[id]/resolve";
const headers = {
  "content-type": "application/json",
  origin: G1_BASE_URL,
  "sec-fetch-site": "same-origin",
};
const denied = (status: number, code: string, message: string): HttpExpectation => ({
  status,
  denial: { code, message },
});
const auth = (p: PrincipalLabel) =>
  p === "anonymous"
    ? denied(401, "unauthorized", "Sign in required.")
    : denied(403, "forbidden", "Editor role required.");
function make(
  principal: PrincipalLabel,
  name: string,
  id: string,
  expect: HttpExpectation,
  body: unknown,
  requestHeaders: Record<string, string> = headers,
): FederationResolutionScenario {
  return {
    kind: "http",
    id: `federation-resolve-${name}-${principal}`,
    route,
    method: "POST",
    path: `/api/editorial/federation/${id}/resolve`,
    params: { id },
    principal,
    session: principal === "anonymous" ? NO_SESSION : validSession(principal),
    headers: requestHeaders,
    body,
    expect: {
      ...expect,
      headers: { "content-type": "application/json" },
      absentHeaders: ["set-cookie", "location"],
    },
  };
}
const mutations = PRINCIPAL_LABELS.flatMap((principal) => {
  const target =
    FEDERATION_RESOLUTION_TARGETS.find((t) => t.principal === principal) ??
    FEDERATION_RESOLUTION_TARGETS[0];
  const editor = principal === "EDITOR" || principal === "ADMIN";
  const body = { decision: target.decision, note: target.note };
  return [
    make(
      principal,
      "pending",
      target.id,
      editor
        ? { status: 200, bodyEquals: JSON.stringify({ id: target.id, status: target.decision }) }
        : auth(principal),
      body,
    ),
    make(
      principal,
      "replay",
      target.id,
      editor ? denied(409, "conflict", "Notification is no longer pending.") : auth(principal),
      body,
      { ...headers, "x-g1-observation": "exact-replay" },
    ),
    make(
      principal,
      "missing",
      "g1-federation-resolution-missing",
      editor ? denied(404, "not-found", "Notification not found.") : auth(principal),
      body,
    ),
    make(
      principal,
      "outbound",
      "g1-read-federation-outbound",
      editor ? denied(409, "conflict", "Notification is no longer pending.") : auth(principal),
      body,
    ),
    make(
      principal,
      "resolved",
      "g1-read-federation-accepted-new",
      editor ? denied(409, "conflict", "Notification is no longer pending.") : auth(principal),
      body,
    ),
    make(
      principal,
      "invalid-decision",
      target.id,
      principal === "anonymous"
        ? auth(principal)
        : denied(400, "bad-request", "Invalid request payload."),
      { ...body, decision: "publish" },
    ),
    make(
      principal,
      "missing-origin",
      target.id,
      denied(403, "forbidden", "A matching same-origin request is required."),
      body,
      { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    ),
    make(
      principal,
      "foreign-origin",
      target.id,
      denied(403, "forbidden", "A matching same-origin request is required."),
      body,
      { ...headers, origin: "https://foreign.g1.example" },
    ),
    make(
      principal,
      "cross-site",
      target.id,
      denied(403, "forbidden", "Cross-site mutation requests are refused."),
      body,
      { ...headers, "sec-fetch-site": "cross-site" },
    ),
    make(
      principal,
      "wrong-media",
      target.id,
      denied(400, "bad-request", "Content-Type application/json is required."),
      body,
      { ...headers, "content-type": "text/plain" },
    ),
    make(
      principal,
      "missing-media",
      target.id,
      denied(400, "bad-request", "Content-Type application/json is required."),
      body,
      { origin: G1_BASE_URL, "sec-fetch-site": "same-origin" },
    ),
  ];
});
for (const session of NEGATIVE_SESSIONS)
  mutations.push({
    ...make(
      "anonymous",
      `session-${session.case}`,
      FEDERATION_RESOLUTION_TARGETS[0].id,
      auth("anonymous"),
      { decision: "accepted", note: FEDERATION_RESOLUTION_TARGETS[0].note },
    ),
    session,
  });
function payloadExpectation(index: number): HttpExpectation {
  if (index === 0)
    return {
      status: 200,
      bodyEquals: canonicalJson(FEDERATION_RESOLUTION_NATIVE.inputs[0]),
      headers: {
        "content-type": "application/ld+json; charset=utf-8",
        "cache-control": "no-store, must-revalidate",
      },
      absentHeaders: ["set-cookie", "location"],
    };
  return {
    ...denied(404, "not-found", "Federation notification not found."),
    headers: { "content-type": "application/json" },
    absentHeaders: ["set-cookie", "location"],
  };
}
const observations = PRINCIPAL_LABELS.flatMap<FederationResolutionScenario>((principal) => [
  {
    kind: "http" as const,
    id: `federation-resolve-observer-inbox-${principal}`,
    route: "api/federation/inbox",
    method: "GET" as const,
    path: "/api/federation/inbox?limit=100",
    params: { id: "" },
    principal,
    session: principal === "anonymous" ? NO_SESSION : validSession(principal),
    expect: {
      status: 200,
      bodyIncludes: [FEDERATION_RESOLUTION_TARGETS[0].id],
      bodyExcludes: [FEDERATION_RESOLUTION_TARGETS[1].id],
      headers: {
        "content-type": "application/ld+json; charset=utf-8",
        "cache-control": "no-store, must-revalidate",
      },
      absentHeaders: ["set-cookie", "location"],
    },
  },
  ...FEDERATION_RESOLUTION_TARGETS.map<FederationResolutionScenario>((target, index) => ({
    kind: "http" as const,
    id: `federation-resolve-observer-${target.decision}-${principal}`,
    route: "api/federation/notifications/[id]",
    method: "GET" as const,
    path: `/api/federation/notifications/${target.id}`,
    params: { id: target.id },
    principal,
    session: principal === "anonymous" ? NO_SESSION : validSession(principal),
    expect: payloadExpectation(index),
  })),
]);
export const FEDERATION_RESOLUTION_SCENARIOS: readonly FederationResolutionScenario[] = [
  ...mutations,
  ...observations,
];

/** Fixed native program; every activation still requires four-label evidence and manual golden review. */
export const FEDERATION_RESOLUTION_PROGRAM: SupplementalProgram = {
  name: "federation-resolutions",
  spec: "federation-resolution.g1.spec.ts",
  outVariable: "G1_FEDERATION_RESOLUTION_OUT",
  scenarios: FEDERATION_RESOLUTION_SCENARIOS,
  fixtures: ["fixtures/federation-resolution-fixtures.sql"],
  addedRows: FEDERATION_RESOLUTION_ADDED_ROWS,
  stateSuffix: ".state.json",
};
