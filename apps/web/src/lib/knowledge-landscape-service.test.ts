import { describe, expect, it } from "vitest";
import type { PublicGraphNode, PublicGraphResponse } from "@oratlas/contracts";
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
  it("returns the versioned GUI algorithm without scientific scoring", async () => {
    const response = await createKnowledgeLandscapeResponse(index, {
      q: "model",
      interests: ["methods-models"],
    });

    expect(response.schemaVersion).toBe("2.0.0");
    expect(response.algorithm).toMatchObject({
      id: "explicit-interest-graph-landscape",
      purpose: "navigation",
    });
    expect(response.algorithm.limitations).toContain("not-a-truth-score");
    expect(response.landscape.nodes.find((node) => node.kind === "claim")?.reasons).toContain(
      "Matches your methods & models interest",
    );
  });

  it("turns explicit claim identities into explainable confirmed graph recommendations", async () => {
    const graphIndex: KnowledgeIndexData = {
      ...index,
      claims: [{ ...index.claims[0]!, knowledgeNodeId: "node-claim" }],
    };
    const response = await createKnowledgeLandscapeResponse(
      graphIndex,
      { q: "model", interests: ["data-code"] },
      { graphProvider: async () => graphResponse() },
    );

    expect(response.landscape).toMatchObject({ graphSeedCount: 1, graphNodeCount: 2 });
    expect(response.landscape.nodes.find((node) => node.kind === "dataset")).toMatchObject({
      graphNodeId: "node-dataset",
      graphNodeVersionId: "version-dataset",
      href: "/nodes/node-dataset/versions/version-dataset",
      graphHref: "/graph?seed=node-dataset",
    });
    expect(response.landscape.nodes.find((node) => node.kind === "dataset")?.reasons).toContain(
      "Matches your data & code interest as a dataset node",
    );
    expect(response.landscape.nodes.find((node) => node.id === "claim:claim-1")?.reasons).toContain(
      "Its confirmed graph neighborhood matches your data & code interest",
    );
    expect(response.landscape.edges).toContainEqual(
      expect.objectContaining({
        sourceId: "claim:claim-1",
        targetId: "graph:node-dataset",
        relationType: "uses-dataset",
        status: "confirmed",
      }),
    );
  });

  it("does not expose a graph link when the bridged node has no readable public version", async () => {
    const response = await createKnowledgeLandscapeResponse(
      {
        ...index,
        claims: [{ ...index.claims[0]!, knowledgeNodeId: "unreadable-node" }],
      },
      { q: "model", interests: [] },
      { graphProvider: async () => undefined },
    );

    const claim = response.landscape.nodes.find((node) => node.kind === "claim");
    expect(claim).toBeDefined();
    expect(claim).not.toHaveProperty("graphNodeId");
    expect(claim).not.toHaveProperty("graphHref");
    expect(response.landscape.graphNodeCount).toBe(0);
  });

  it("trusts only requested seeds and confirmed provider edges", async () => {
    const mixedStatusGraph = graphResponse();
    mixedStatusGraph.seedNodeIds = [
      "node-claim",
      "unrequested-1",
      "unrequested-2",
      "unrequested-3",
    ];
    mixedStatusGraph.edges.push({
      id: "edge-proposed",
      sourceNodeId: "node-claim",
      sourceVersionId: "version-claim",
      targetNodeId: "node-dataset",
      targetVersionId: "version-dataset",
      relationType: "contradicts",
      status: "proposed",
      provenance: "proposed-by-agent",
      proposedAt: "2026-08-04T12:00:00.000Z",
    });

    const response = await createKnowledgeLandscapeResponse(
      {
        ...index,
        claims: [
          {
            ...index.claims[0]!,
            text: "A model produced an estimate.",
            knowledgeNodeId: "node-claim",
          },
        ],
      },
      { q: "model", interests: ["data-code", "disagreements"] },
      { graphProvider: async () => mixedStatusGraph },
    );

    expect(response.landscape.graphSeedCount).toBe(1);
    expect(response.landscape.edges).not.toContainEqual(
      expect.objectContaining({ relationType: "contradicts" }),
    );
    expect(
      response.landscape.nodes.find((node) => node.id === "claim:claim-1")?.reasons,
    ).not.toContain("Its confirmed graph neighborhood matches your disagreements interest");
  });
});

function graphNode(
  id: string,
  versionId: string,
  kind: PublicGraphNode["kind"],
  title: string,
): PublicGraphNode {
  return {
    id,
    localNodeId: id,
    kind,
    repository: { owner: "example", name: "review", url: "https://github.com/example/review" },
    versionId,
    snapshotId: `snapshot-${id}`,
    commitSha: "b".repeat(40),
    title,
    provenance: {
      sourcePath: `nodes/${id}.json`,
      repositoryUrl: "https://github.com/example/review",
      commitSha: "b".repeat(40),
      declaredAt: "2026-08-04T12:00:00.000Z",
    },
    identifiers: [],
    createdAt: "2026-08-04T12:00:00.000Z",
  };
}

function graphResponse(): PublicGraphResponse {
  return {
    schemaVersion: "1.0.0",
    seedNodeIds: ["node-claim"],
    depth: 1,
    nodes: [
      graphNode("node-claim", "version-claim", "claim", "A model claim"),
      graphNode("node-dataset", "version-dataset", "dataset", "Evaluation dataset"),
    ],
    edges: [
      {
        id: "edge-1",
        sourceNodeId: "node-claim",
        sourceVersionId: "version-claim",
        targetNodeId: "node-dataset",
        targetVersionId: "version-dataset",
        relationType: "uses-dataset",
        status: "confirmed",
        provenance: "confirmed-by-editor",
        confirmedAt: "2026-08-04T12:00:00.000Z",
      },
    ],
    page: { limit: 25 },
  };
}
