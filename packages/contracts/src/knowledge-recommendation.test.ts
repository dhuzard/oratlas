import { describe, expect, it } from "vitest";
import {
  knowledgeRecommendationQuerySchema,
  knowledgeRecommendationResponseSchema,
} from "./knowledge-recommendation.js";

describe("knowledge recommendation contracts", () => {
  it("keeps reader input explicit and excludes landscape focus state", () => {
    expect(
      knowledgeRecommendationQuerySchema.parse({ q: "replay", interests: ["data-code"] }),
    ).toEqual({ q: "replay", interests: ["data-code"] });
    expect(
      knowledgeRecommendationQuerySchema.safeParse({ interests: [], focusNodeId: "claim:1" })
        .success,
    ).toBe(false);
  });

  it("accepts references and explanations without presentation fields", () => {
    const response = knowledgeRecommendationResponseSchema.parse({
      schemaVersion: "2.0.0",
      algorithm: {
        id: "explicit-interest-recommendation",
        version: "2.0.0",
        purpose: "recommendation",
        limitations: [
          "not-a-truth-score",
          "not-a-quality-score",
          "confirmed-graph-edges-only",
          "bounded-to-six-claims-ten-evidence-and-twelve-graph-nodes",
        ],
      },
      query: { interests: ["disagreements"] },
      recommendations: [
        {
          nodeId: "node-1",
          nodeVersionId: "version-1",
          rank: 1,
          score: 1,
          reasons: ["Connected by a confirmed contradicts relation"],
        },
      ],
      omittedUnboundCount: 0,
    });
    expect(response.recommendations[0]).not.toHaveProperty("label");
    expect(response.recommendations[0]).not.toHaveProperty("href");
    expect(response.recommendations[0]).not.toHaveProperty("detail");
  });
});
