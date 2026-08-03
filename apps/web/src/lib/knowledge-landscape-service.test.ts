import { describe, expect, it } from "vitest";
import type { KnowledgeIndexData } from "@oratlas/knowledge";
import { createKnowledgeLandscapeResponse } from "./knowledge-landscape-service.js";

const index: KnowledgeIndexData = {
  reviews: [],
  identifierConflicts: [],
  citations: [],
  claims: [
    {
      claimId: "claim-1",
      localClaimId: "claim-1",
      reviewSlug: "review-one",
      reviewId: "review-1",
      reviewVersionId: "version-1",
      reviewTitle: "Review one",
      text: "A model has a reproducibility disagreement.",
      anchor: "claim-claim-1",
      claimType: "empirical",
      commitSha: "a".repeat(40),
      relations: [],
    },
  ],
};

describe("knowledge landscape service", () => {
  it("returns the versioned GUI algorithm without scientific scoring", () => {
    const response = createKnowledgeLandscapeResponse(index, {
      q: "model",
      interests: ["methods-models"],
    });

    expect(response.schemaVersion).toBe("1.0.0");
    expect(response.algorithm).toMatchObject({
      id: "explicit-interest-landscape",
      purpose: "navigation",
    });
    expect(response.algorithm.limitations).toContain("not-a-truth-score");
    expect(response.landscape.nodes.find((node) => node.kind === "claim")?.reasons).toContain(
      "Matches your methods & models interest",
    );
  });
});
