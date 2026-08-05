import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_LANDSCAPE_ALGORITHM_VERSION,
  KNOWLEDGE_LANDSCAPE_SCHEMA_VERSION,
  knowledgeLandscapeQuerySchema,
  knowledgeLandscapeResponseSchema,
} from "./knowledge-landscape.js";

describe("knowledge landscape contracts", () => {
  it("rejects unknown interests and hidden free-form personalization", () => {
    expect(knowledgeLandscapeQuerySchema.safeParse({ interests: ["unknown"] }).success).toBe(false);
    expect(
      knowledgeLandscapeQuerySchema.safeParse({ interests: [], inferredProfile: "expert" }).success,
    ).toBe(false);
  });

  it("publishes an explicitly bounded navigation response", () => {
    const response = knowledgeLandscapeResponseSchema.parse({
      schemaVersion: KNOWLEDGE_LANDSCAPE_SCHEMA_VERSION,
      algorithm: {
        id: "explicit-interest-graph-landscape",
        version: KNOWLEDGE_LANDSCAPE_ALGORITHM_VERSION,
        purpose: "navigation",
        limitations: [
          "not-a-truth-score",
          "not-a-quality-score",
          "canonical-source-assertion-and-confirmed-edges",
          "bounded-to-three-entry-neighborhoods-and-twelve-exact-versions",
        ],
      },
      query: { q: "replication", interests: ["reproducibility"] },
      landscape: {
        nodes: [],
        edges: [],
        matchedClaimCount: 0,
        shownClaimCount: 0,
        graphSeedCount: 0,
        graphNodeCount: 0,
        timeline: [],
      },
    });

    expect(response.algorithm.purpose).toBe("navigation");
    expect(response.algorithm.limitations).toContain("not-a-truth-score");
  });
});
