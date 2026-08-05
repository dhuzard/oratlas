import { describe, expect, it } from "vitest";
import {
  knowledgeRecommendationQuerySchema,
  knowledgeRecommendationResponseSchema,
} from "./knowledge-recommendation.js";

describe("knowledge recommendation contracts", () => {
  it("keeps reader input explicit and excludes landscape focus state", () => {
    expect(
      knowledgeRecommendationQuerySchema.parse({
        q: "replay",
        interests: ["data-code"],
        knownNodeIds: ["known-1"],
      }),
    ).toEqual({ q: "replay", interests: ["data-code"], knownNodeIds: ["known-1"] });
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
          "canonical-source-assertion-and-confirmed-edges",
          "bounded-to-three-entry-neighborhoods-and-twelve-exact-versions",
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
          anchors: [
            {
              edgeId: "edge-1",
              relationType: "contradicts",
              directionFromRecommendation: "incoming",
              recommendedNodeVersionId: "version-1",
              knownNodeId: "known-1",
              knownNodeVersionId: "known-version-1",
            },
          ],
        },
      ],
      omittedUnboundCount: 0,
    });
    expect(response.recommendations[0]).not.toHaveProperty("label");
    expect(response.recommendations[0]).not.toHaveProperty("href");
    expect(response.recommendations[0]).not.toHaveProperty("detail");
  });

  it("rejects a stable recommendation without an exact version", () => {
    const parsed = knowledgeRecommendationResponseSchema.safeParse({
      schemaVersion: "2.0.0",
      algorithm: {
        id: "explicit-interest-recommendation",
        version: "2.0.0",
        purpose: "recommendation",
        limitations: [
          "not-a-truth-score",
          "not-a-quality-score",
          "canonical-source-assertion-and-confirmed-edges",
          "bounded-to-three-entry-neighborhoods-and-twelve-exact-versions",
        ],
      },
      query: { interests: [] },
      recommendations: [
        { nodeId: "work-node", rank: 1, score: 1, reasons: ["Evidence"], anchors: [] },
      ],
      omittedUnboundCount: 0,
    });
    expect(parsed.success).toBe(false);
  });
});
