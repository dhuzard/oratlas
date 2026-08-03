import { describe, expect, it } from "vitest";
import type { KnowledgeIndexData } from "@oratlas/knowledge";
import { buildKnowledgeLandscape, normalizeExplorationInterests } from "./knowledge-landscape.js";

const index: KnowledgeIndexData = {
  reviews: [],
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
    const landscape = buildKnowledgeLandscape(index, index.claims, ["disagreements"]);

    expect(landscape.shownClaimCount).toBe(1);
    expect(landscape.nodes.map((node) => node.kind)).toEqual(["review", "claim", "evidence"]);
    expect(landscape.edges.map((edge) => edge.label)).toEqual(["asserts", "contradicts"]);
  });

  it("does not present unrelated claims for a selected interest", () => {
    const landscape = buildKnowledgeLandscape(index, index.claims, ["reproducibility"]);

    expect(landscape.nodes).toEqual([]);
    expect(landscape.matchedClaimCount).toBe(0);
  });
});
