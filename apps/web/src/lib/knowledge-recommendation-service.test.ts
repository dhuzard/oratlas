import { describe, expect, it, vi } from "vitest";
import type { KnowledgeIndexData } from "@oratlas/knowledge";
import { createKnowledgeRecommendationResponse } from "./knowledge-recommendation-service.js";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ prisma: {} }));
vi.mock("./knowledge-landscape-service", () => ({
  createKnowledgeLandscapeResponse: vi.fn(async (_index, query) => ({
    schemaVersion: "2.0.0",
    algorithm: {
      id: "explicit-interest-graph-landscape",
      version: "2.0.0",
      purpose: "navigation",
      limitations: [
        "not-a-truth-score",
        "not-a-quality-score",
        "confirmed-graph-edges-only",
        "bounded-to-six-claims-ten-evidence-and-twelve-graph-nodes",
      ],
    },
    query,
    landscape: {
      nodes: [
        {
          id: "claim:claim-1",
          kind: "claim",
          label: "Hidden rendering label",
          detail: "Hidden rendering detail",
          href: "/claims/version/claim-1",
          reasons: ["Matches your disagreements interest"],
        },
        {
          id: "evidence:doi:10.1000/example",
          kind: "evidence",
          label: "Hidden work title",
          detail: "Hidden work detail",
          href: "/claims/version/claim-1#linked-evidence",
          reasons: ["Linked as evidence for a claim in this landscape"],
        },
      ],
      edges: [],
      matchedClaimCount: 1,
      shownClaimCount: 1,
      graphSeedCount: 0,
      graphNodeCount: 0,
      timeline: [],
    },
  })),
}));

describe("knowledge recommendation service", () => {
  it("projects ranked canonical references without rendering fields", async () => {
    const response = await createKnowledgeRecommendationResponse(
      {} as KnowledgeIndexData,
      { interests: ["disagreements"], knownNodeIds: [] },
      {
        resolveReferences: vi.fn(
          async () =>
            new Map([
              ["claim:claim-1", { nodeId: "claim-node", nodeVersionId: "claim-version" }],
              ["evidence:doi:10.1000/example", { nodeId: "work-node" }],
            ]),
        ),
      },
    );

    expect(response.algorithm).toMatchObject({
      id: "explicit-interest-recommendation",
      version: "2.0.0",
      purpose: "recommendation",
    });
    expect(response.recommendations).toEqual([
      {
        nodeId: "claim-node",
        nodeVersionId: "claim-version",
        rank: 1,
        score: 1,
        reasons: ["Matches your disagreements interest"],
        anchors: [],
      },
      {
        nodeId: "work-node",
        rank: 2,
        score: 0,
        reasons: ["Linked as evidence for a claim in this landscape"],
        anchors: [],
      },
    ]);
    expect(JSON.stringify(response)).not.toMatch(/Hidden|href|label|detail/);
  });

  it("attaches only confirmed anchor proofs supplied for the explicit known set", async () => {
    const resolveAnchors = vi.fn(
      async () =>
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
            ],
          ],
        ]),
    );
    const response = await createKnowledgeRecommendationResponse(
      {} as KnowledgeIndexData,
      { interests: ["disagreements"], knownNodeIds: ["known-node"] },
      {
        resolveReferences: vi.fn(
          async () =>
            new Map([["claim:claim-1", { nodeId: "claim-node", nodeVersionId: "claim-version" }]]),
        ),
        resolveAnchors,
      },
    );

    expect(resolveAnchors).toHaveBeenCalledWith(
      [{ nodeId: "claim-node", nodeVersionId: "claim-version" }],
      ["known-node"],
    );
    expect(response.recommendations[0]?.anchors).toEqual([
      expect.objectContaining({ edgeId: "edge-1", knownNodeId: "known-node" }),
    ]);
  });
});
