import { G1_BASE_URL } from "./capture.js";
import { NO_SESSION, PRINCIPAL_LABELS, validSession } from "./principals.js";
import type { HttpExpectation, HttpScenario } from "./scenarios.js";
import { SYNTHESIS_SLUG, SYNTHESIS_VERSION } from "./synthesis-routes.js";

/** Separate supplementary fixture lifecycle: never append these expectations to the old dataset. */
export const SYNTHESIS_SCENARIOS: readonly HttpScenario[] = PRINCIPAL_LABELS.flatMap(
  (principal) => {
    const label = principal.toLowerCase().replaceAll("+", "-and-");
    const make = (
      id: string,
      route: string,
      path: string,
      expect: HttpExpectation,
      params?: Record<string, string>,
    ): HttpScenario => ({
      kind: "http",
      id: `synthesis-${id}-${label}`,
      route,
      path,
      method: "GET",
      principal,
      session: principal === "anonymous" ? NO_SESSION : validSession(principal),
      expect:
        principal === "anonymous"
          ? expect
          : { ...expect, sameResponseAs: `synthesis-${id}-anonymous` },
      ...(params ? { params } : {}),
    });
    const missing = (message: string): HttpExpectation => ({
      status: 404,
      denial: { code: "not-found", message },
    });
    const notification = (id: string, expect: HttpExpectation) =>
      make(
        `notification-${id}`,
        "api/federation/notifications/[id]",
        `/api/federation/notifications/${id}`,
        expect,
        { id },
      );
    const synthesis = (id: string, slug: string, expect: HttpExpectation) =>
      make(id, "api/syntheses/[slug]", `/api/syntheses/${slug}`, expect, { slug });
    return [
      notification("g1-read-federation-accepted-old", {
        status: 200,
        headers: { "content-type": "application/ld+json; charset=utf-8" },
        json: [
          { pointer: "/type", equals: ["Offer", "coar-notify:ReviewAction"] },
          { pointer: "/id", equals: "https://example.org/g1-notify/accepted-old" },
          { pointer: "/summary", equals: "g1-read-queue-private-payload" },
        ],
        bodyExcludes: ['"resolvedById"', '"resolutionNote"', '"payloadJson"'],
      }),
      notification("g1-synthesis-announce", {
        status: 200,
        json: [
          { pointer: "/type", equals: ["Announce", "coar-notify:ReviewAction"] },
          { pointer: "/object/id", equals: `${G1_BASE_URL}/reviews/${SYNTHESIS_SLUG}` },
        ],
        bodyExcludes: ['"resolvedById"', '"payloadHash"'],
      }),
      ...["pending", "rejected", "outbound", "missing"].map((id) =>
        notification(`g1-read-federation-${id}`, missing("Federation notification not found.")),
      ),
      synthesis("accepted", SYNTHESIS_SLUG, {
        status: 200,
        json: [
          { pointer: "/reviewType", equals: "ai-synthesis" },
          { pointer: "/document/sections", length: 6 },
          { pointer: "/citations", length: 1 },
          { pointer: "/citations/0/nodeVersionId", equals: "g1-synthesis-source-v2" },
          { pointer: "/version/id", equals: SYNTHESIS_VERSION },
          { pointer: "/provenance/generationMode", equals: "deterministic-template" },
          { pointer: "/provenance/pipelineSoftware/kind", equals: "software-agent" },
          { pointer: "/provenance/approvingEditor/githubLogin", equals: "g1-fixture-admin" },
          { pointer: "/provenance/licenseSpdx", equals: "CC-BY-4.0" },
          { pointer: "/freshness/status", equals: "unchecked" },
        ],
        bodyExcludes: [
          '"packetJson"',
          '"checklistJson"',
          '"inputReferencesJson"',
          '"acceptedById"',
          '"versionDoi"',
          '"conceptDoi"',
        ],
      }),
      ...["g1-fixture-review", "g1-control-review", "g1-synthesis-missing"].map((slug) =>
        synthesis(`unavailable-${slug}`, slug, {
          status: 404,
          denial: { code: "not-found", message: "Synthesis not found.", envelope: "root" },
        }),
      ),
      make("contradictions", "api/synthesis/contradictions", "/api/synthesis/contradictions", {
        status: 200,
        headers: { "cache-control": "no-store, must-revalidate" },
        json: [
          { pointer: "/contradictions", length: 1 },
          { pointer: "/counts/genuine-contradiction", equals: 1 },
          { pointer: "/contradictions/0/sharedFamilyCount", equals: 1 },
        ],
        bodyIncludes: ["g1-synthetic-support", "g1-synthetic-oppose"],
        bodyExcludes: ["g1-synthetic-hidden", "g1-synthetic-tombstone", "Control claim"],
      }),
      make(
        "archive",
        "api/search",
        "/api/search?contentType=synthesis&q=Synthetic%20bounded&pageSize=20",
        {
          status: 200,
          json: [
            { pointer: "/total", equals: 1 },
            { pointer: "/items", length: 1 },
            { pointer: "/items/0/contentType", equals: "synthesis" },
            { pointer: "/items/0/slug", equals: SYNTHESIS_SLUG },
            { pointer: "/items/0/freshness/status", equals: "unchecked" },
          ],
          bodyExcludes: ['"packetJson"', '"acceptedById"'],
        },
      ),
      make("inbox", "api/federation/inbox", "/api/federation/inbox", {
        status: 200,
        json: [{ pointer: "/contains", length: 3 }],
        bodyIncludes: ["g1-synthesis-announce", "g1-read-federation-accepted-old"],
        bodyExcludes: [
          "g1-read-federation-pending",
          "g1-read-federation-rejected",
          "g1-read-queue-private-payload",
        ],
      }),
      make("feed", "api/feeds/atom", "/api/feeds/atom", {
        status: 200,
        bodyIncludes: ["G1 fixture review"],
        bodyExcludes: [
          SYNTHESIS_SLUG,
          SYNTHESIS_VERSION,
          "g1-control-review",
          "g1-version-tombstoned",
        ],
      }),
      ...["support", "oppose"].map((id) => {
        const versionId = id === "support" ? "g1-version-2" : "g1-version-4";
        const localClaimId = `g1-synthetic-${id}`;
        return make(
          `claim-${id}`,
          "api/claims/[versionId]/[localClaimId]",
          `/api/claims/${versionId}/${localClaimId}`,
          {
            status: 200,
            bodyIncludes: [`Synthetic ${id} evidence declaration`],
            bodyExcludes: ["g1-synthetic-hidden", "g1-synthetic-tombstone"],
          },
          { versionId, localClaimId },
        );
      }),
      ...[
        ["g1-version-3", "hidden"],
        ["g1-version-tombstoned", "tombstone"],
      ].map(([versionId, id]) => {
        const localClaimId = `g1-synthetic-${id}`;
        return make(
          `claim-${id}`,
          "api/claims/[versionId]/[localClaimId]",
          `/api/claims/${versionId}/${localClaimId}`,
          missing("Claim not found."),
          { versionId: versionId!, localClaimId },
        );
      }),
    ];
  },
);
