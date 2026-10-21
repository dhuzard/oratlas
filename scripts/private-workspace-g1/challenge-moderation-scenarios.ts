import { RESPONSE_MODERATION_NATIVE } from "./response-moderation-scenarios.js";
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
export const CHALLENGE_MODERATION_NATIVE = RESPONSE_MODERATION_NATIVE;
export const CHALLENGE_MODERATION_TARGETS = (["A+B", "EDITOR", "ADMIN"] as const).map(
  (principal, index) => {
    const receipt = CHALLENGE_MODERATION_NATIVE.receipts[index]!;
    const challenge = CHALLENGE_MODERATION_NATIVE.rows.Challenge!.find(
      (r) => r.id === receipt.challenge.id,
    )!;
    return {
      principal,
      id: receipt.challenge.id,
      challengeId: receipt.challenge.id,
      actorId:
        principal === "A+B"
          ? "g1-user-a-and-b"
          : principal === "EDITOR"
            ? "g1-user-editor"
            : "g1-user-admin",
      role: principal === "A+B" ? "USER" : principal,
      contentHash: String(challenge.filedContentHash),
      body: String(challenge.body),
    };
  },
);
export const CHALLENGE_MODERATION_EXTRA_COLUMNS = [
  "contentStatus",
  "contentRevision",
  "removedAt",
  "removedById",
  "removedByRoleSnapshot",
  "updatedAt",
] as const;
export const CHALLENGE_MODERATION_ADDED_ROWS = {
  Person: 1,
  ReviewContributor: 1,
  Challenge: 3,
  ChallengeResponse: 3,
  ChallengeTransition: 9,
  AuditEvent: 12,
};
export const CHALLENGE_MODERATION_AUDIT_IDS = [
  "g1-challenge-moderation-audit-responder",
  "g1-challenge-moderation-audit-editor",
  "g1-challenge-moderation-audit-admin",
] as const;
export type ChallengeModerationScenario = HttpScenario & {
  readonly params: Readonly<{ id: string }>;
};
const route = "api/challenges/[id]/moderation";
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
    : denied(403, "forbidden", "Only the filer or an editor may remove this challenge text.");
function make(
  principal: PrincipalLabel,
  name: string,
  id: string,
  expect: HttpExpectation,
  body: unknown,
  requestHeaders: Record<string, string> = headers,
): ChallengeModerationScenario {
  return {
    kind: "http",
    id: `challenge-moderation-${name}-${principal}`,
    route,
    method: "POST",
    path: `/api/challenges/${id}/moderation`,
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
    CHALLENGE_MODERATION_TARGETS.find((t) => t.principal === principal) ??
    CHALLENGE_MODERATION_TARGETS[0]!;
  const authorized = ["A+B", "EDITOR", "ADMIN"].includes(principal);
  return [
    make(
      principal,
      "stale-before",
      target.id,
      authorized
        ? denied(409, "conflict", "Challenge content changed. Refresh and retry.")
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
        ? denied(409, "conflict", "Challenge content changed. Refresh and retry.")
        : auth(principal),
      { expectedContentRevision: 0 },
      { ...headers, "x-g1-observation": "exact-replay" },
    ),
    make(
      principal,
      "missing",
      "g1-challenge-moderation-missing",
      principal === "anonymous"
        ? auth(principal)
        : denied(404, "not-found", "Challenge not found."),
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
      CHALLENGE_MODERATION_TARGETS[0]!.id,
      auth("anonymous"),
      { expectedContentRevision: 0 },
    ),
    session,
  });
const observers = PRINCIPAL_LABELS.map<ChallengeModerationScenario>((principal) => ({
  kind: "http",
  id: `challenge-moderation-observer-${principal}`,
  route: "api/reviews/[slug]/versions/[versionId]/challenges",
  method: "GET",
  path: "/api/reviews/g1-fixture-review/versions/g1-version-2/challenges",
  params: { id: "" },
  principal,
  session: principal === "anonymous" ? NO_SESSION : validSession(principal),
  expect: {
    status: 200,
    bodyIncludes: [...CHALLENGE_MODERATION_TARGETS.map((t) => t.id), '"contentStatus":"removed"'],
    bodyExcludes: [
      ...CHALLENGE_MODERATION_TARGETS.map((t) => t.body),
      "G1_REMOVED_CHALLENGE_CANARY",
    ],
    headers: { "content-type": "application/json" },
    absentHeaders: ["set-cookie", "location"],
  },
}));
export const CHALLENGE_MODERATION_SCENARIOS: readonly ChallengeModerationScenario[] = [
  ...mutations,
  ...observers,
];
export const CHALLENGE_MODERATION_PROGRAM: SupplementalProgram = {
  name: "challenge-moderations",
  spec: "challenge-moderation.g1.spec.ts",
  outVariable: "G1_CHALLENGE_MODERATION_OUT",
  scenarios: CHALLENGE_MODERATION_SCENARIOS,
  fixtures: ["fixtures/response-moderation-fixtures.sql"],
  addedRows: CHALLENGE_MODERATION_ADDED_ROWS,
  stateSuffix: ".state.json",
};
