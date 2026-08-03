import { describe, expect, it } from "vitest";
import type { KnowledgeIndexData } from "@oratlas/knowledge";
import { buildKnowledgeLandscape, normalizeExplorationInterests } from "./knowledge-landscape.js";

const index: KnowledgeIndexData = {
  reviews: [
    {
      reviewSlug: "review-one",
      reviewId: "review-1",
      reviewVersionId: "version-1",
      title: "Review one",
      keywords: [],
      domains: [],
      authors: [],
      publicationYear: 2024,
      commitSha: "a".repeat(40),
      hasDoi: false,
      hasTrustData: false,
      hasEvidenceData: true,
      hasHumanReviewedTrust: false,
      status: "accepted",
    },
  ],
  identifierConflicts: [],
  citations: [
    {
      citationId: "citation-1",
      localCitationId: "ref-1",
      reviewVersionId: "version-1",
      workId: "doi:10.1000/example",
      canonicalWorkAliases: ["doi:10.1000/example"],
      title: "Earlier evidence",
      year: 2019,
    },
  ],
  claims: [
    {
      claimId: "claim-1",
      localClaimId: "claim-1",
      reviewSlug: "review-one",
      reviewId: "review-1",
      reviewVersionId: "version-1",
      reviewTitle: "Review one",
      text: "A computational model produces a conflicting result.",
      anchor: "claim-claim-1",
      claimType: "empirical",
      commitSha: "a".repeat(40),
      relations: [{ citationId: "citation-1", relationType: "contradicts" }],
    },
  ],
};

describe("knowledge landscape", () => {
  it("normalizes supported, unique interests", () => {
    expect(
      normalizeExplorationInterests(["disagreements", "unknown", "disagreements", "data-code"]),
    ).toEqual(["disagreements", "data-code"]);
  });

  it("builds a bounded review → claim → evidence path", () => {
    const landscape = buildKnowledgeLandscape(index, index.claims, ["disagreements"], {
      query: "computational model",
    });

    expect(landscape.shownClaimCount).toBe(1);
    expect(landscape.nodes.map((node) => node.kind)).toEqual(["review", "claim", "evidence"]);
    expect(landscape.edges.map((edge) => edge.label)).toEqual(["asserts", "contradicts"]);
    expect(landscape.nodes.find((node) => node.kind === "claim")?.reasons).toEqual([
      "Matches the search “computational model”",
      "Matches your disagreements interest",
      "1 contradicting evidence link",
      "1 linked evidence record",
    ]);
    expect(landscape.timeline).toEqual([
      { year: 2019, reviewCount: 0, evidenceCount: 1 },
      { year: 2024, reviewCount: 1, evidenceCount: 0 },
    ]);
  });

  it("focuses on a node and only its direct connections", () => {
    const landscape = buildKnowledgeLandscape(index, index.claims, ["disagreements"], {
      focusNodeId: "claim:claim-1",
    });

    expect(landscape.focusedNodeId).toBe("claim:claim-1");
    expect(landscape.nodes.map((node) => node.id)).toEqual([
      "review:version-1",
      "claim:claim-1",
      "evidence:doi:10.1000/example",
    ]);
  });

  it("does not present unrelated claims for a selected interest", () => {
    const landscape = buildKnowledgeLandscape(index, index.claims, ["reproducibility"]);

    expect(landscape.nodes).toEqual([]);
    expect(landscape.matchedClaimCount).toBe(0);
  });
});
