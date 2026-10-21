import { globalClaimId, globalCitationId } from "../../packages/contracts/src/evidence-identity.js";
import { readFileSync } from "node:fs";
import type { DiscussionTraversalScope } from "../../packages/contracts/src/discussion.js";
import { NO_SESSION, PRINCIPAL_LABELS, validSession } from "./principals.js";
import { G1_BASE_URL } from "./capture.js";
import type { HttpExpectation, HttpScenario } from "./scenarios.js";
import type { SupplementalProgram } from "./supplemental-channel.js";
export type PostInputs = {
  scopes: Record<
    "visible" | "hidden" | "tombstone" | "missing" | "stale" | "detached",
    DiscussionTraversalScope
  >;
  inbox: { id: string; payload: Record<string, unknown>; hash: string };
  announcement: { id: string; payload: Record<string, unknown>; hash: string };
  addedRows: Record<string, number>;
  fixtureUpdates: Record<string, Array<{ id: string; fields: string[] }>>;
};
/** Frozen public native producer output, independently reissued/validated by the real child. */
export const POST_INPUTS = JSON.parse(
  readFileSync(new URL("./fixtures/deterministic-post-inputs.json", import.meta.url), "utf8"),
) as PostInputs;
const denial = (status: number, code: string, message: string): HttpExpectation => ({
  status,
  denial: { code, message },
});
export type DeterministicPostScenario = HttpScenario & {
  readonly params?: Readonly<Record<string, string>>;
};
const question = "What evidence supports the synthetic public claim?";
export const DETERMINISTIC_POST_SCENARIOS: readonly DeterministicPostScenario[] =
  PRINCIPAL_LABELS.flatMap((principal) => {
    const suffix = principal.toLowerCase().replaceAll("+", "-and-");
    const make = (
      id: string,
      route: string,
      path: string,
      body: unknown,
      expect: HttpExpectation,
      params?: Record<string, string>,
    ): DeterministicPostScenario => ({
      kind: "http",
      id: `deterministic-post-${id}-${suffix}`,
      route,
      method: "POST",
      path,
      body,
      principal,
      session: principal === "anonymous" ? NO_SESSION : validSession(principal),
      headers: { "content-type": "application/json", origin: G1_BASE_URL },
      ...(params ? { params } : {}),
      expect: {
        ...expect,
        bodyExcludes: [
          "Control claim that must stay hidden.",
          "g1-read-internal-note",
          ...(expect.bodyExcludes ?? []),
        ],
        ...(!route.includes("federation/announce") && principal !== "anonymous"
          ? { sameResponseAs: `deterministic-post-${id}-anonymous` }
          : {}),
      },
    });
    const discussion = (
      id: string,
      scope: DiscussionTraversalScope,
      expect: HttpExpectation,
      q = question,
    ) => make(`discuss-${id}`, "api/discuss", "/api/discuss", { question: q, scope }, expect);
    const modified = {
      ...POST_INPUTS.scopes.visible,
      signature:
        (POST_INPUTS.scopes.visible.signature[0] === "a" ? "b" : "a") +
        POST_INPUTS.scopes.visible.signature.slice(1),
    };
    const cases: DeterministicPostScenario[] = [
      discussion("visible", POST_INPUTS.scopes.visible, {
        status: 200,
        json: [
          { pointer: "/mode", equals: "deterministic" },
          { pointer: "/llmAvailable", equals: false },
          { pointer: "/result/insufficientEvidence", equals: false },
          { pointer: "/result/matchedClaimCount", equals: 1 },
          { pointer: "/result/groups", minLength: 1 },
          { pointer: "/result/groups/0/relationType", equals: "supports" },
          {
            pointer: "/result/groups/0/claims/0/claimId",
            equals: globalClaimId("g1-version-2", "claim-1"),
          },
          { pointer: "/scope/claimIds", equals: [globalClaimId("g1-version-2", "claim-1")] },
          { pointer: "/references", length: 2 },
          { pointer: "/references/0/id", equals: globalClaimId("g1-version-2", "claim-1") },
          { pointer: "/references/1/id", equals: globalCitationId("g1-version-2", "ref-1") },
          { pointer: "/scope/landscapeNodeVersionIds", length: 2 },
        ],
      }),
      discussion(
        "tampered",
        modified,
        denial(400, "bad-request", "Atlas Discuss traversal scope is invalid or was modified."),
      ),
    ];
    for (const kind of ["hidden", "tombstone", "missing", "stale"] as const)
      cases.push(
        discussion(
          kind,
          POST_INPUTS.scopes[kind],
          denial(
            409,
            "conflict",
            "A selected graph occurrence is missing, stale, or no longer public.",
          ),
        ),
      );
    cases.push(
      discussion(
        "detached",
        POST_INPUTS.scopes.detached,
        denial(
          409,
          "conflict",
          "A selected graph edge does not connect the exact visible occurrences.",
        ),
      ),
      discussion(
        "invalid-question",
        POST_INPUTS.scopes.visible,
        denial(
          400,
          "bad-request",
          "A valid question, exact traversed graph scope, and optional Anthropic/OpenAI key configuration are required.",
        ),
        "x",
      ),
    );
    const payload = POST_INPUTS.inbox.payload;
    const collision = {
      ...payload,
      object: {
        ...(payload.object as object),
        id: "https://example.org/synthetic-modified-object",
      },
    };
    const wrongTarget = {
      ...payload,
      target: { ...(payload.target as object), inbox: "https://example.org/wrong-inbox" },
    };
    cases.push(
      make("inbox-duplicate", "api/federation/inbox", "/api/federation/inbox", payload, {
        status: 200,
        json: [
          { pointer: "/id", equals: POST_INPUTS.inbox.id },
          { pointer: "/deduplicated", equals: true },
          { pointer: "/status", equals: "pending" },
          { pointer: "/pattern", equals: "request-review" },
        ],
        headers: {
          location: `/api/federation/notifications/${POST_INPUTS.inbox.id}`,
          "cache-control": "no-store",
        },
      }),
      make(
        "inbox-collision",
        "api/federation/inbox",
        "/api/federation/inbox",
        collision,
        denial(
          409,
          "conflict",
          "Activity id was already received with different immutable content.",
        ),
      ),
      make(
        "inbox-wrong-target",
        "api/federation/inbox",
        "/api/federation/inbox",
        wrongTarget,
        denial(
          400,
          "bad-request",
          "Notification target inbox does not identify this ORAtlas service.",
        ),
      ),
      make(
        "inbox-malformed",
        "api/federation/inbox",
        "/api/federation/inbox",
        {},
        denial(400, "bad-request", "Invalid or unsupported COAR Notify payload."),
      ),
    );
    const privileged = principal === "EDITOR" || principal === "ADMIN";
    const allowed = (expect: HttpExpectation) =>
      principal === "anonymous"
        ? denial(401, "unauthorized", "Sign in required.")
        : privileged
          ? expect
          : denial(403, "forbidden", "Editor role required.");
    const announce = (
      id: string,
      reply: string,
      expect: HttpExpectation,
      slug = "g1-fixture-review",
      versionId = "g1-version-2",
    ) =>
      make(
        `announce-${id}`,
        "api/reviews/[slug]/versions/[versionId]/federation/announce",
        `/api/reviews/${slug}/versions/${versionId}/federation/announce`,
        { inReplyTo: reply },
        allowed(expect),
        { slug, versionId },
      );
    cases.push(
      announce("prepared", "https://example.org/g1-notify/accepted-old", {
        status: 200,
        json: [
          { pointer: "/id", equals: POST_INPUTS.announcement.payload.id },
          { pointer: "/inReplyTo", equals: "https://example.org/g1-notify/accepted-old" },
          {
            pointer: "/object/id",
            equals: "https://g1.oratlas.example/reviews/g1-fixture-review/versions/g1-version-2",
          },
        ],
        headers: {
          "content-type": "application/ld+json; charset=utf-8",
          "cache-control": "no-store",
        },
      }),
      announce(
        "pending",
        "https://example.org/g1-notify/pending",
        denial(404, "not-found", "Accepted Request Review notification not found."),
      ),
      announce(
        "missing",
        "https://example.org/g1-notify/missing",
        denial(404, "not-found", "Accepted Request Review notification not found."),
      ),
      announce(
        "hidden",
        "https://example.org/g1-notify/accepted-old",
        denial(404, "not-found", "Readable review version not found."),
        "g1-control-review",
        "g1-version-3",
      ),
    );
    return cases;
  });
export const DETERMINISTIC_POST_PROGRAM: SupplementalProgram = {
  name: "deterministic-posts",
  spec: "deterministic-posts.g1.spec.ts",
  outVariable: "G1_DETERMINISTIC_POST_OUT",
  scenarios: DETERMINISTIC_POST_SCENARIOS,
  fixtures: ["fixtures/deterministic-post-fixtures.sql"],
  addedRows: POST_INPUTS.addedRows,
  stateSuffix: ".state.json",
};
/** Setup-only native compatibility binding updates; none is a runtime mutation grant. */
export const DETERMINISTIC_POST_FIXTURE_UPDATES = POST_INPUTS.fixtureUpdates;
