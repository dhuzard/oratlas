import { describe, expect, it, vi } from "vitest";
import {
  createKnowledgeRecommendationResponse,
  type CanonicalNodeReference,
} from "./knowledge-recommendation-service.js";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ prisma: {} }));

const selection = {
  nodes: [],
  edges: [],
  recommendations: [
    {
      nodeId: "claim-node",
      nodeVersionId: "claim-version",
      reasons: ["Canonical disagreement path"],
    },
    {
      nodeId: "work-node",
      nodeVersionId: "work-version",
      reasons: ["Canonical evidence path"],
    },
  ],
  matchedClaimCount: 1,
  seedNodeIds: ["claim-node"],
};

describe("knowledge recommendation service", () => {
  it("projects ranked exact canonical references without rendering fields", async () => {
    const response = await createKnowledgeRecommendationResponse(
      { interests: ["disagreements"], knownNodeIds: [] },
      { selectGraph: vi.fn(async () => selection) },
    );

    expect(response.recommendations).toEqual([
      {
        nodeId: "claim-node",
        nodeVersionId: "claim-version",
        rank: 1,
        score: 1,
        reasons: ["Canonical disagreement path"],
        anchors: [],
      },
      {
        nodeId: "work-node",
        nodeVersionId: "work-version",
        rank: 2,
        score: 0,
        reasons: ["Canonical evidence path"],
        anchors: [],
      },
    ]);
    expect(JSON.stringify(response)).not.toMatch(/href|label|detail/);
  });

  it("keeps distinct exact versions of one stable node", async () => {
    const response = await createKnowledgeRecommendationResponse(
      { interests: [], knownNodeIds: [] },
      {
        selectGraph: async () => ({
          ...selection,
          recommendations: [
            { nodeId: "work-node", nodeVersionId: "work-v1", reasons: ["First occurrence"] },
            { nodeId: "work-node", nodeVersionId: "work-v2", reasons: ["Second occurrence"] },
          ],
        }),
      },
    );
    expect(response.recommendations.map(({ nodeVersionId }) => nodeVersionId)).toEqual([
      "work-v1",
      "work-v2",
    ]);
  });

  it("attaches anchor proofs only to their exact recommended version", async () => {
    const resolveAnchors = vi.fn(
      async (_recommendations: readonly CanonicalNodeReference[]) =>
        new Map([
          [
            "claim-node",
            [
              {
                edgeId: "edge-1",
                relationType: "contradicts" as const,
                directionFromRecommendation: "incoming" as const,
                recommendedNodeVersionId: "claim-version",
                knownNodeId: "known-node",
                knownNodeVersionId: "known-version",
              },
              {
                edgeId: "edge-wrong",
                relationType: "contradicts" as const,
                directionFromRecommendation: "incoming" as const,
                recommendedNodeVersionId: "another-version",
                knownNodeId: "known-node",
                knownNodeVersionId: "known-version",
              },
            ],
          ],
        ]),
    );
    const response = await createKnowledgeRecommendationResponse(
      { interests: [], knownNodeIds: ["known-node"] },
      { selectGraph: async () => selection, resolveAnchors },
    );
    expect(response.recommendations[0]?.anchors).toEqual([
      expect.objectContaining({ edgeId: "edge-1" }),
    ]);
  });

  it("ranks anchored newcomers first without returning known nodes as new recommendations", async () => {
    const response = await createKnowledgeRecommendationResponse(
      { interests: [], knownNodeIds: ["known-node"] },
      {
        selectGraph: async () => ({
          ...selection,
          recommendations: [
            { nodeId: "disconnected", nodeVersionId: "disconnected-v1", reasons: ["Later"] },
            { nodeId: "anchored", nodeVersionId: "anchored-v1", reasons: ["Familiar path"] },
            { nodeId: "known-node", nodeVersionId: "known-v1", reasons: ["Already known"] },
          ],
        }),
        resolveAnchors: async () =>
          new Map([
            [
              "anchored",
              [
                {
                  edgeId: "anchor-edge",
                  relationType: "supports" as const,
                  directionFromRecommendation: "outgoing" as const,
                  recommendedNodeVersionId: "anchored-v1",
                  knownNodeId: "known-node",
                  knownNodeVersionId: "known-v1",
                },
              ],
            ],
          ]),
      },
    );
    expect(response.recommendations.map(({ nodeId }) => nodeId)).toEqual([
      "anchored",
      "disconnected",
    ]);
    expect(response.recommendations[0]?.anchors).toHaveLength(1);
  });
});
