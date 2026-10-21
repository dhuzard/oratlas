import { G1_BASE_URL } from "./capture.js";
import { PRINCIPAL_LABELS, NO_SESSION, validSession } from "./principals.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";

/** Read-only public/editorial surfaces. No provider calls, generated IDs or state mutations. */
export const EDITORIAL_READ_SCENARIOS: readonly HttpScenario[] = PRINCIPAL_LABELS.flatMap(
  (principal) => {
    const suffix = principal.toLowerCase().replaceAll("+", "-and-");
    const session = principal === "anonymous" ? NO_SESSION : validSession(principal);
    const make = (
      id: string,
      route: string,
      path: string,
      expect: HttpExpectation,
      params?: Record<string, string>,
      method: HttpScenario["method"] = "GET",
      headers?: Record<string, string>,
    ): HttpScenario => ({
      kind: "http",
      id: `editorial-read-${id}-${suffix}`,
      route,
      method,
      path,
      principal,
      session,
      expect:
        principal !== "anonymous" && route !== "api/editorial/federation"
          ? { ...expect, sameResponseAs: `editorial-read-${id}-anonymous` }
          : expect,
      ...(params ? { params } : {}),
      ...(headers ? { headers } : {}),
    });
    const missing = (message: string): HttpExpectation => ({
      status: 404,
      denial: { code: "not-found", message },
    });
    const bad = (message: string): HttpExpectation => ({
      status: 400,
      denial: { code: "bad-request", message },
    });
    const proposals = "api/reviews/[slug]/update-proposals";
    const proposal = (slug: string, expect: HttpExpectation) =>
      make(`proposals-${slug}`, proposals, `/api/reviews/${slug}/update-proposals`, expect, {
        slug,
      });
    const inbox = (id: string, query: string, expect: HttpExpectation) =>
      make(`inbox-${id}`, "api/federation/inbox", `/api/federation/inbox${query}`, expect);
    const notification = (id: string) =>
      `${G1_BASE_URL}/api/federation/notifications/g1-read-federation-${id}`;
    const capabilities: HttpExpectation = {
      status: 204,
      bodyEquals: "",
      absentHeaders: ["access-control-allow-origin"],
      headers: {
        allow: "GET, HEAD, OPTIONS, POST",
        "accept-post": "application/ld+json, application/json",
      },
    };
    const privileged = principal === "EDITOR" || principal === "ADMIN";
    return [
      make(
        "process",
        "api/editorial/process",
        "/api/editorial/process?submissionId=g1-read-submission",
        {
          status: 200,
          json: [
            { pointer: "/history", length: 1 },
            { pointer: "/history/0/submissionId", equals: "g1-read-submission" },
            { pointer: "/history/0/submitterLogin", equals: "g1-fixture-a-only" },
            { pointer: "/history/0/rounds", length: 1 },
            { pointer: "/history/0/rounds/0/reports", length: 1 },
            { pointer: "/history/0/rounds/0/reports/0/reviewerLogin", equals: "g1-fixture-b-only" },
            { pointer: "/history/0/rounds/0/responses", length: 1 },
          ],
          bodyExcludes: ["g1-read-internal-note", '"githubUserId"', '"submittedPayloadJson"'],
        },
      ),
      make(
        "process-missing",
        "api/editorial/process",
        "/api/editorial/process?submissionId=g1-read-missing",
        missing("Submission not found."),
      ),
      make(
        "process-required",
        "api/editorial/process",
        "/api/editorial/process",
        bad("submissionId is required."),
      ),
      make(
        "federation-queue",
        "api/editorial/federation",
        "/api/editorial/federation",
        privileged
          ? {
              status: 200,
              headers: { "cache-control": "no-store" },
              json: [
                { pointer: "/notifications", length: 4 },
                { pointer: "/notifications/0/id", equals: "g1-read-federation-rejected" },
              ],
              bodyExcludes: [
                "g1-read-federation-outbound",
                "g1-read-queue-private-payload",
                '"payloadJson"',
                '"resolutionNote"',
              ],
            }
          : {
              status: principal === "anonymous" ? 401 : 403,
              denial: {
                code: principal === "anonymous" ? "unauthorized" : "forbidden",
                message: principal === "anonymous" ? "Sign in required." : "Editor role required.",
              },
            },
      ),
      proposal("g1-fixture-review", {
        status: 200,
        headers: { "cache-control": "no-store, must-revalidate" },
        json: [
          { pointer: "/openCount", equals: 1 },
          { pointer: "/proposals", length: 2 },
          { pointer: "/proposals/0/id", equals: "g1-read-proposal-resolved" },
          { pointer: "/proposals/0/resolvedByLogin", equals: "g1-fixture-editor" },
          { pointer: "/proposals/1/id", equals: "g1-read-proposal-open" },
          { pointer: "/proposals/1/citationStatus", equals: "retracted" },
        ],
        bodyExcludes: ["g1-read-tombstone-proposal", "g1-read-hidden-proposal", '"resolvedById"'],
      }),
      proposal("g1-second-review", {
        status: 200,
        json: [
          { pointer: "/openCount", equals: 0 },
          { pointer: "/proposals", length: 0 },
        ],
      }),
      proposal("g1-control-review", missing("Review not found.")),
      proposal("g1-read-missing", missing("Review not found.")),
      inbox("list", "", {
        status: 200,
        headers: { "content-type": "application/ld+json; charset=utf-8" },
        json: [
          {
            pointer: "/contains",
            equals: [notification("accepted-new"), notification("accepted-old")],
          },
        ],
        bodyExcludes: ["pending", "rejected", "outbound", "g1-read-queue-private-payload"],
      }),
      inbox("first", "?limit=1", {
        status: 200,
        headers: {
          link: `<${G1_BASE_URL}/api/federation/inbox?cursor=g1-read-federation-accepted-new&limit=1>; rel="next"`,
        },
        json: [{ pointer: "/contains", equals: [notification("accepted-new")] }],
      }),
      inbox("next", "?cursor=g1-read-federation-accepted-new&limit=1", {
        status: 200,
        json: [{ pointer: "/contains", equals: [notification("accepted-old")] }],
      }),
      ...["g1-read-federation-rejected", "g1-read-federation-outbound", "g1-read-missing"].map(
        (cursor) =>
          inbox(
            `cursor-${cursor}`,
            `?cursor=${cursor}`,
            bad("Federation inbox cursor is invalid."),
          ),
      ),
      inbox("invalid-limit", "?limit=0", bad("Invalid inbox page.")),
      inbox("unknown-query", "?unexpected=1", bad("Invalid inbox page.")),
      make(
        "inbox-options",
        "api/federation/inbox",
        "/api/federation/inbox",
        capabilities,
        undefined,
        "OPTIONS",
      ),
      // The actual OPTIONS handler has no origin-specific CORS grant or authentication gate.
      make(
        "inbox-options-cross-origin",
        "api/federation/inbox",
        "/api/federation/inbox",
        capabilities,
        undefined,
        "OPTIONS",
        { origin: "https://untrusted.example.org" },
      ),
    ];
  },
);
