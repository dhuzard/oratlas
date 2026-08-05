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
      { interests: ["disagreements"] },
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
      },
      {
        nodeId: "work-node",
        rank: 2,
        score: 0,
        reasons: ["Linked as evidence for a claim in this landscape"],
      },
    ]);
    expect(JSON.stringify(response)).not.toMatch(/Hidden|href|label|detail/);
  });
});
