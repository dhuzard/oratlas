import { G1_BASE_URL } from "./capture.js";
import { PRINCIPAL_LABELS, NO_SESSION, validSession, type PrincipalLabel } from "./principals.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";
export const FRESH_REMOVAL_ROUTE_MODULES = {
  "api/comments/[id]": "@/app/api/comments/[id]/route",
  "api/reviews/[slug]/versions/[versionId]/comments":
    "@/app/api/reviews/[slug]/versions/[versionId]/comments/route",
} as const;
export const FRESH_REMOVAL_TARGETS = [
  { id: "g1-comment-visible", principal: "A-only", actorId: "g1-user-a-only", by: "author" },
  { id: "g1-comment-reply", principal: "EDITOR", actorId: "g1-user-editor", by: "editor" },
  { id: "g1-comment-historical", principal: "ADMIN", actorId: "g1-user-admin", by: "editor" },
] as const;
export type FreshRemovalStep = {
  readonly scenario: HttpScenario;
  readonly removal?: (typeof FRESH_REMOVAL_TARGETS)[number];
};
const integrity = {
  "content-type": "application/json",
  origin: G1_BASE_URL,
  "sec-fetch-site": "same-origin",
};
const deny = (status: number, code: string, message: string): HttpExpectation => ({
  status,
  denial: { code, message },
});
const steps: FreshRemovalStep[] = [];
for (const target of FRESH_REMOVAL_TARGETS) {
  const make = (
    suffix: string,
    principal: PrincipalLabel,
    expect: HttpExpectation,
    headers: Record<string, string> = integrity,
  ): HttpScenario => ({
    kind: "http",
    id: `fresh-removal-${target.id}-${suffix}`,
    route: "api/comments/[id]",
    method: "DELETE",
    path: `/api/comments/${target.id}`,
    params: { id: target.id },
    headers,
    principal,
    session: principal === "anonymous" ? NO_SESSION : validSession(principal),
    expect,
  });
  steps.push({
    scenario: make("anonymous", "anonymous", deny(401, "unauthorized", "Sign in required.")),
  });
  steps.push({
    scenario: make(
      "wrong-owner",
      "B-only",
      deny(403, "forbidden", "Only the author or an editor can remove a comment."),
    ),
  });
  steps.push({
    scenario: make(
      "cross-origin",
      target.principal,
      deny(403, "forbidden", "A matching same-origin request is required."),
      { ...integrity, origin: "https://untrusted.example.org" },
    ),
  });
  const success = make("first", target.principal, {
    status: 200,
    json: [{ pointer: "/status", equals: "removed" }],
  });
  steps.push({ scenario: success, removal: target });
  const repeat = make("repeat", target.principal, {
    status: 200,
    json: [{ pointer: "/status", equals: "removed" }],
  });
  steps.push({ scenario: { ...repeat, repeatOf: success.id } });
  const wrongAfter = make(
    "wrong-owner-after",
    "B-only",
    deny(403, "forbidden", "Only the author or an editor can remove a comment."),
  );
  steps.push({ scenario: { ...wrongAfter, repeatOf: `fresh-removal-${target.id}-wrong-owner` } });
}
for (const principal of PRINCIPAL_LABELS) {
  const label = principal.toLowerCase().replaceAll("+", "-and-");
  steps.push({
    scenario: {
      kind: "http",
      id: `fresh-removal-public-read-${label}`,
      route: "api/reviews/[slug]/versions/[versionId]/comments",
      method: "GET",
      path: "/api/reviews/g1-fixture-review/versions/g1-version-2/comments",
      params: { slug: "g1-fixture-review", versionId: "g1-version-2" },
      principal,
      session: principal === "anonymous" ? NO_SESSION : validSession(principal),
      expect: {
        status: 200,
        json: [
          { pointer: "/commentCount", equals: 1 },
          { pointer: "/comments", length: 1 },
          { pointer: "/comments/0/id", equals: "g1-fresh-remaining" },
          {
            pointer: "/comments/0/body",
            equals:
              "Synthetic remaining public comment after the three independent removal operations.",
          },
        ],
        bodyExcludes: [
          "Visible synthetic scholarly comment.",
          "Visible synthetic reply under removed parent.",
          "Historical synthetic comment for exact version.",
          "G1_REMOVED_COMMENT_CANARY",
          "G1_REMOVED_ALONE_CANARY",
          "G1_TOMBSTONE_COMMENT_CANARY",
        ],
        ...(principal === "anonymous"
          ? {}
          : { sameResponseAs: "fresh-removal-public-read-anonymous" }),
      },
    },
  });
}
/** Observational standalone program only; no shared scenario/exclusion activation. */
export const FRESH_REMOVAL_STEPS: readonly FreshRemovalStep[] = steps;
export const FRESH_REMOVAL_SCENARIOS = steps.map((step) => step.scenario);
