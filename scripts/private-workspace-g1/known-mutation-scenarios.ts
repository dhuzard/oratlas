import { G1_BASE_URL, G1_FIXED_CLOCK } from "./capture.js";
import { PRINCIPAL_LABELS, NO_SESSION, validSession, type PrincipalLabel } from "./principals.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";

export const KNOWN_NOTIFICATION_TARGETS = {
  "A-only": "g1-notification-a-only-2",
  "B-only": "g1-notification-b-only-1",
  "A+B": "g1-notification-a-and-b-1",
  EDITOR: "g1-notification-editor-1",
  ADMIN: "g1-notification-admin-1",
} as const;
export type KnownNotificationState = readonly {
  id: string;
  userId: string;
  readAt: string | null;
}[];
export type KnownMutationStep = {
  readonly scenario: HttpScenario;
  readonly newlyRead: readonly string[];
  readonly newRemoval?: { id: string; actorId: string; by: "author" | "editor" };
};
const integrity = {
  "content-type": "application/json",
  origin: G1_BASE_URL,
  "sec-fetch-site": "same-origin",
};
const denial = (status: number, code: string, message: string): HttpExpectation => ({
  status,
  denial: { code, message },
});
const notFound = denial(404, "not-found", "Notification not found or already read.");
const unauthorized = denial(401, "unauthorized", "Sign in required.");
const readIds: string[] = [];
const make = (
  id: string,
  route: string,
  path: string,
  method: HttpScenario["method"],
  principal: PrincipalLabel,
  expect: HttpExpectation,
  body?: unknown,
  params?: Record<string, string>,
  headers: Record<string, string> = integrity,
): HttpScenario => ({
  kind: "http",
  id: `known-mutation-${id}`,
  route,
  path,
  method,
  principal,
  session: principal === "anonymous" ? NO_SESSION : validSession(principal),
  expect,
  headers,
  ...(body === undefined ? {} : { body }),
  ...(params ? { params } : {}),
});
const steps: KnownMutationStep[] = [];
function add(scenario: HttpScenario) {
  if (scenario.id.includes("notification-repeat-"))
    scenario = {
      ...scenario,
      repeatOf: scenario.id.replace("notification-repeat-", "notification-own-"),
    };
  if (scenario.id === "known-mutation-notification-own-anonymous")
    scenario = { ...scenario, repeatOf: "known-mutation-notification-cross-anonymous" };
  steps.push({ scenario, newlyRead: [...readIds] });
}

// Appended after the reviewed1165 program: A-only-1 is already read, all five targets remain unread.
for (const principal of PRINCIPAL_LABELS) {
  const label = principal.toLowerCase().replaceAll("+", "-and-");
  const own =
    principal === "anonymous"
      ? KNOWN_NOTIFICATION_TARGETS["A-only"]
      : KNOWN_NOTIFICATION_TARGETS[principal];
  const cross =
    principal === "A-only"
      ? KNOWN_NOTIFICATION_TARGETS["B-only"]
      : KNOWN_NOTIFICATION_TARGETS["A-only"];
  // All cross-owner denials precede the writes, so rejection cannot be explained by already-read state.
  add(
    make(
      `notification-cross-${label}`,
      "api/notifications",
      "/api/notifications",
      "POST",
      principal,
      principal === "anonymous" ? unauthorized : notFound,
      { notificationId: cross },
    ),
  );
  add(
    make(
      `notification-missing-${label}`,
      "api/notifications",
      "/api/notifications",
      "POST",
      principal,
      principal === "anonymous" ? unauthorized : notFound,
      { notificationId: "g1-known-missing" },
    ),
  );
  add(
    make(
      `notification-origin-${label}`,
      "api/notifications",
      "/api/notifications",
      "POST",
      principal,
      denial(403, "forbidden", "A matching same-origin request is required."),
      { notificationId: own },
      undefined,
      { ...integrity, origin: "https://untrusted.example.org" },
    ),
  );
}
for (const principal of PRINCIPAL_LABELS) {
  const label = principal.toLowerCase().replaceAll("+", "-and-");
  const own =
    principal === "anonymous"
      ? KNOWN_NOTIFICATION_TARGETS["A-only"]
      : KNOWN_NOTIFICATION_TARGETS[principal];
  if (principal !== "anonymous") readIds.push(own);
  add(
    make(
      `notification-own-${label}`,
      "api/notifications",
      "/api/notifications",
      "POST",
      principal,
      principal === "anonymous"
        ? unauthorized
        : { status: 200, json: [{ pointer: "/status", equals: "read" }] },
      { notificationId: own },
    ),
  );
  add(
    make(
      `notification-repeat-${label}`,
      "api/notifications",
      "/api/notifications",
      "POST",
      principal,
      principal === "anonymous" ? unauthorized : notFound,
      { notificationId: own },
    ),
  );
  if (principal !== "anonymous")
    add(
      make(
        `notification-unread-${label}`,
        "api/notifications",
        "/api/notifications?unread=1",
        "GET",
        principal,
        { status: 200, json: [{ pointer: "/notifications", length: 0 }] },
        undefined,
        undefined,
        {},
      ),
    );
}

// Native existing removed row exercises owner/editor idempotence without a new clock-dependent update.
for (const principal of PRINCIPAL_LABELS) {
  const label = principal.toLowerCase().replaceAll("+", "-and-");
  const allowed = ["A-only", "EDITOR", "ADMIN"].includes(principal);
  const comment = (id: string, target: string, expect: HttpExpectation, headers = integrity) =>
    make(
      `comment-${id}-${label}`,
      "api/comments/[id]",
      `/api/comments/${target}`,
      "DELETE",
      principal,
      expect,
      undefined,
      { id: target },
      headers,
    );
  add(
    comment(
      "cross-origin",
      "g1-comment-visible",
      denial(403, "forbidden", "A matching same-origin request is required."),
      { ...integrity, origin: "https://untrusted.example.org" },
    ),
  );
  add(
    comment(
      "missing",
      "g1-known-missing",
      principal === "anonymous" ? unauthorized : denial(404, "not-found", "Comment not found."),
    ),
  );
  add(
    comment(
      "removed",
      "g1-comment-removed-parent",
      principal === "anonymous"
        ? unauthorized
        : allowed
          ? { status: 200, json: [{ pointer: "/status", equals: "removed" }] }
          : denial(403, "forbidden", "Only the author or an editor can remove a comment."),
    ),
  );
  if (!allowed)
    add(
      comment(
        "visible-forbidden",
        "g1-comment-visible",
        principal === "anonymous"
          ? unauthorized
          : denial(403, "forbidden", "Only the author or an editor can remove a comment."),
      ),
    );
}
for (const principal of PRINCIPAL_LABELS) {
  const suffix = principal.toLowerCase().replaceAll("+", "-and-");
  add(
    make(
      `comment-public-read-${suffix}`,
      "api/reviews/[slug]/versions/[versionId]/comments",
      "/api/reviews/g1-fixture-review/versions/g1-version-2/comments",
      "GET",
      principal,
      {
        status: 200,
        json: [
          { pointer: "/commentCount", equals: 2 },
          { pointer: "/comments", length: 2 },
          { pointer: "/comments/0/id", equals: "g1-comment-visible" },
          { pointer: "/comments/1/body", equals: "" },
        ],
        bodyExcludes: [
          "G1_REMOVED_COMMENT_CANARY",
          "G1_REMOVED_ALONE_CANARY",
          "G1_TOMBSTONE_COMMENT_CANARY",
        ],
      },
      undefined,
      { slug: "g1-fixture-review", versionId: "g1-version-2" },
      {},
    ),
  );
}
export const KNOWN_MUTATION_STEPS: readonly KnownMutationStep[] = steps;
export const KNOWN_MUTATION_SCENARIOS = steps.map((step) => step.scenario);
export function expectedKnownNotifications(
  base: KnownNotificationState,
  newlyRead: readonly string[],
): KnownNotificationState {
  return base.map((row) => ({
    ...row,
    readAt: newlyRead.includes(row.id) ? G1_FIXED_CLOCK : row.readAt,
  }));
}
