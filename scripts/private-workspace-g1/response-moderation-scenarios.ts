import { readFileSync } from "node:fs";
import type { SupplementalProgram } from "./supplemental-channel.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";
import { G1_BASE_URL } from "./capture.js";
import {
  NO_SESSION,
  NEGATIVE_SESSIONS,
  PRINCIPAL_LABELS,
  validSession,
  type PrincipalLabel,
} from "./principals.js";
export const RESPONSE_MODERATION_NATIVE = JSON.parse(
  readFileSync(new URL("./fixtures/response-moderation-native.json", import.meta.url), "utf8"),
) as {
  receipts: Array<{
    label: string;
    challenge: { id: string };
    response: { id: string };
    terminal: { status: string; revision: number };
  }>;
  rows: Record<string, Array<Record<string, unknown>>>;
  person: Record<string, unknown>;
  contributor: Record<string, unknown>;
  outbound: number;
};
export const RESPONSE_MODERATION_TARGETS = (["B-only", "EDITOR", "ADMIN"] as const).map(
  (principal, index) => {
    const receipt = RESPONSE_MODERATION_NATIVE.receipts[index]!;
    const response = RESPONSE_MODERATION_NATIVE.rows.ChallengeResponse!.find(
      (r) => r.id === receipt.response.id,
    )!;
    return {
      principal,
      id: receipt.response.id,
      challengeId: receipt.challenge.id,
      actorId:
        principal === "B-only"
          ? "g1-user-b-only"
          : principal === "EDITOR"
            ? "g1-user-editor"
            : "g1-user-admin",
      role: principal === "B-only" ? "USER" : principal,
      contentHash: String(response.contentHash),
      body: String(response.body),
    };
  },
);
export const RESPONSE_MODERATION_EXTRA_COLUMNS = [
  "contentStatus",
  "contentRevision",
  "removedAt",
  "removedById",
  "removedByRoleSnapshot",
] as const;
export const RESPONSE_MODERATION_ADDED_ROWS = {
  Person: 1,
  ReviewContributor: 1,
  Challenge: 3,
  ChallengeResponse: 3,
  ChallengeTransition: 9,
  AuditEvent: 12,
};
export const RESPONSE_MODERATION_AUDIT_IDS = [
  "g1-response-moderation-audit-responder",
  "g1-response-moderation-audit-editor",
  "g1-response-moderation-audit-admin",
] as const;
export type ResponseModerationScenario = HttpScenario & {
  readonly params: Readonly<{ id: string }>;
};
const route = "api/challenge-responses/[id]/moderation";
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
    : denied(403, "forbidden", "Only the responder or an editor may remove this response.");
function make(
  principal: PrincipalLabel,
  name: string,
  id: string,
  expect: HttpExpectation,
  body: unknown,
  requestHeaders: Record<string, string> = headers,
): ResponseModerationScenario {
  return {
    kind: "http",
    id: `response-moderation-${name}-${principal}`,
    route,
    method: "POST",
    path: `/api/challenge-responses/${id}/moderation`,
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
    RESPONSE_MODERATION_TARGETS.find((t) => t.principal === principal) ??
    RESPONSE_MODERATION_TARGETS[0]!;
  const authorized = ["B-only", "EDITOR", "ADMIN"].includes(principal);
  return [
    make(
      principal,
      "stale-before",
      target.id,
      authorized
        ? denied(409, "conflict", "Response content changed. Refresh and retry.")
        : auth(principal),
      { expectedContentRevision: 7 },
    ),
    make(
      principal,
      "visible",
      target.id,
      authorized
        ? {
            status: 200,
            bodyEquals: JSON.stringify({ contentRevision: 1, contentStatus: "removed" }),
          }
        : auth(principal),
      { expectedContentRevision: 0 },
    ),
    make(
      principal,
      "replay",
      target.id,
      authorized
        ? denied(409, "conflict", "Response content changed. Refresh and retry.")
        : auth(principal),
      { expectedContentRevision: 0 },
      { ...headers, "x-g1-observation": "exact-replay" },
    ),
    make(
      principal,
      "missing",
      "g1-response-moderation-missing",
      principal === "anonymous"
        ? auth(principal)
        : denied(404, "not-found", "Challenge response not found."),
      { expectedContentRevision: 0 },
    ),
    make(
      principal,
      "invalid-revision",
      target.id,
      principal === "anonymous"
        ? auth(principal)
        : denied(400, "bad-request", "Invalid request payload."),
      { expectedContentRevision: -1 },
    ),
    make(
      principal,
      "extra-field",
      target.id,
      principal === "anonymous"
        ? auth(principal)
        : denied(400, "bad-request", "Invalid request payload."),
      { expectedContentRevision: 0, reason: "unrecognized" },
    ),
    make(
      principal,
      "missing-origin",
      target.id,
      denied(403, "forbidden", "A matching same-origin request is required."),
      { expectedContentRevision: 0 },
      { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    ),
    make(
      principal,
      "foreign-origin",
      target.id,
      denied(403, "forbidden", "A matching same-origin request is required."),
      { expectedContentRevision: 0 },
      { ...headers, origin: "https://foreign.g1.example" },
    ),
    make(
      principal,
      "cross-site",
      target.id,
      denied(403, "forbidden", "Cross-site mutation requests are refused."),
      { expectedContentRevision: 0 },
      { ...headers, "sec-fetch-site": "cross-site" },
    ),
    make(
      principal,
      "wrong-media",
      target.id,
      denied(400, "bad-request", "Content-Type application/json is required."),
      { expectedContentRevision: 0 },
      { ...headers, "content-type": "text/plain" },
    ),
    make(
      principal,
      "missing-media",
      target.id,
      denied(400, "bad-request", "Content-Type application/json is required."),
      { expectedContentRevision: 0 },
      { origin: G1_BASE_URL, "sec-fetch-site": "same-origin" },
    ),
  ];
});
for (const session of NEGATIVE_SESSIONS)
  mutations.push({
    ...make(
      "anonymous",
      `session-${session.case}`,
      RESPONSE_MODERATION_TARGETS[0]!.id,
      auth("anonymous"),
      { expectedContentRevision: 0 },
    ),
    session,
  });
const observers = PRINCIPAL_LABELS.map<ResponseModerationScenario>((principal) => ({
  kind: "http",
  id: `response-moderation-observer-${principal}`,
  route: "api/reviews/[slug]/versions/[versionId]/challenges",
  method: "GET",
  path: "/api/reviews/g1-fixture-review/versions/g1-version-2/challenges",
  params: { id: "" },
  principal,
  session: principal === "anonymous" ? NO_SESSION : validSession(principal),
  expect: {
    status: 200,
    bodyIncludes: [...RESPONSE_MODERATION_TARGETS.map((t) => t.id), '"contentStatus":"removed"'],
    bodyExcludes: [...RESPONSE_MODERATION_TARGETS.map((t) => t.body), "G1_REMOVED_RESPONSE_CANARY"],
    headers: { "content-type": "application/json" },
    absentHeaders: ["set-cookie", "location"],
  },
}));
export const RESPONSE_MODERATION_SCENARIOS: readonly ResponseModerationScenario[] = [
  ...mutations,
  ...observers,
];
export const RESPONSE_MODERATION_PROGRAM: SupplementalProgram = {
  name: "response-moderations",
  spec: "response-moderation.g1.spec.ts",
  outVariable: "G1_RESPONSE_MODERATION_OUT",
  scenarios: RESPONSE_MODERATION_SCENARIOS,
  fixtures: ["fixtures/response-moderation-fixtures.sql"],
  addedRows: RESPONSE_MODERATION_ADDED_ROWS,
  stateSuffix: ".state.json",
};
