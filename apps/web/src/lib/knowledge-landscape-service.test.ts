import { describe, expect, it, vi } from "vitest";
import type { CanonicalGraphNodeVersion, CanonicalGraphResponse } from "@oratlas/contracts";
import {
  createKnowledgeLandscapeResponse,
  selectGraphNativeLandscape,
} from "./knowledge-landscape-service.js";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ prisma: {} }));

describe("graph-native knowledge selection", () => {
  it("renders exact canonical references and source assertions without relational landscape rows", async () => {
    const response = await createKnowledgeLandscapeResponse(
      { q: "model", interests: ["data-code"] },
      {
        entryProvider: async () => [{ nodeId: "claim-node", nodeVersionId: "claim-version" }],
        graphProvider: async () => graphResponse(),
      },
    );

    expect(response.landscape.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "claim",
          graphNodeId: "claim-node",
          graphNodeVersionId: "claim-version",
        }),
        expect.objectContaining({
          kind: "dataset",
          graphNodeId: "dataset-node",
          graphNodeVersionId: "dataset-version",
          href: "/graph/occurrences/dataset-node/versions/dataset-version",
        }),
      ]),
    );
    expect(response.landscape.edges).toContainEqual(
      expect.objectContaining({ relationType: "uses-dataset", status: "confirmed" }),
    );
  });

  it("applies relation and TRUST criterion filters to canonical edges", async () => {
    const options = {
      entryProvider: async () => [{ nodeId: "claim-node", nodeVersionId: "claim-version" }],
      graphProvider: async () => graphResponse(),
    };
    const matching = await selectGraphNativeLandscape(
      {
        interests: [],
        relationType: "uses-dataset",
        trustCriterion: "entailment",
      },
      options,
    );
    const wrongRelation = await selectGraphNativeLandscape(
      { interests: [], relationType: "contradicts" },
      options,
    );
    const wrongCriterion = await selectGraphNativeLandscape(
      { interests: [], trustCriterion: "sourceAccess" },
      options,
    );
    expect(matching.matchedClaimCount).toBe(1);
    expect(wrongRelation.nodes).toEqual([]);
    expect(wrongCriterion.nodes).toEqual([]);
  });

  it("passes canonical entry filters to discovery and counts all matches before display caps", async () => {
    let activeLoads = 0;
    let peakLoads = 0;
    const entryProvider = vi.fn(async (query) => {
      expect(query).toMatchObject({
        q: "model",
        reviewSlug: "review-one",
        claimType: "empirical",
      });
      return Array.from({ length: 8 }, (_, index) => ({
        nodeId: `claim-${index}`,
        nodeVersionId: `version-${index}`,
      }));
    });
    const result = await selectGraphNativeLandscape(
      {
        q: "model",
        interests: [],
        reviewSlug: "review-one",
        claimType: "empirical",
      },
      {
        entryProvider,
        graphProvider: async (nodeId, nodeVersionId) => {
          activeLoads += 1;
          peakLoads = Math.max(peakLoads, activeLoads);
          await new Promise((resolve) => setTimeout(resolve, 1));
          activeLoads -= 1;
          return graphResponse(nodeId, nodeVersionId);
        },
      },
    );
    expect(entryProvider).toHaveBeenCalledOnce();
    expect(result.matchedClaimCount).toBe(8);
    expect(result.seedNodeIds).toHaveLength(3);
    expect(peakLoads).toBeLessThanOrEqual(2);
  });

  it("treats focus as the exclusive stable-node seed", async () => {
    const entryProvider = vi.fn(async () => {
      throw new Error("focus must not query default entry candidates");
    });
    const graphProvider = vi.fn(async (nodeId: string) => graphResponse(nodeId));
    const result = await selectGraphNativeLandscape(
      { interests: [], focusNodeId: "focused-node" },
      { entryProvider, graphProvider },
    );
    expect(entryProvider).not.toHaveBeenCalled();
    expect(graphProvider).toHaveBeenCalledWith("focused-node", undefined);
    expect(result.seedNodeIds).toEqual(["focused-node"]);
  });

  it("uses a compact identifier instead of raw citation JSON for untitled work nodes", async () => {
    const rawCitation = '{"doi":"10.14573/altex.2504091","id":"Hartung2025a","source":"primary"}';
    const response = await createKnowledgeLandscapeResponse(
      { interests: [], focusNodeId: "claim-node" },
      {
        entryProvider: async () => [],
        graphProvider: async () => {
          const claim = graphNode("claim-node", "claim-version", "claim", "A model claim");
          const work: CanonicalGraphNodeVersion = {
            ...graphNode("work-node", "work-version", "work", undefined),
            originType: "canonical-work",
            source: { type: "citation-occurrence", citationId: "citation-one" },
            text: rawCitation,
            payload: {
              doi: "10.14573/altex.2504091",
              id: "Hartung2025a",
              source: "primary",
            },
          };
          return {
            schemaVersion: "2.0.0",
            seed: { nodeId: claim.nodeId, nodeVersionId: claim.nodeVersionId },
            nodes: [claim, work],
            edges: [
              {
                id: "edge-claim-work",
                sourceNodeId: claim.nodeId,
                sourceNodeVersionId: claim.nodeVersionId,
                targetNodeId: work.nodeId,
                targetNodeVersionId: work.nodeVersionId,
                relationType: "supports",
                status: "source-assertion",
                provenance: "imported-from-review",
                trustAssessments: [],
              },
            ],
            page: { limit: 100 },
          };
        },
      },
    );

    const evidence = response.landscape.nodes.find((node) => node.kind === "evidence");
    expect(evidence?.label).toBe("DOI 10.14573/altex.2504091");
    expect(JSON.stringify(response.landscape)).not.toContain(rawCitation);
  });

  it("bounds focused human rendering without truncating graph-native selection", async () => {
    const review = graphNode("review-node", "review-version", "review", "A preserved review");
    const claims = Array.from({ length: 11 }, (_, index) =>
      graphNode(`claim-${index}`, `claim-version-${index}`, "claim", `Claim ${index}`),
    );
    const graph: CanonicalGraphResponse = {
      schemaVersion: "2.0.0",
      seed: { nodeId: review.nodeId, nodeVersionId: review.nodeVersionId },
      nodes: [review, ...claims],
      edges: claims.map((claim, index) => ({
        id: `edge-review-claim-${index}`,
        sourceNodeId: review.nodeId,
        sourceNodeVersionId: review.nodeVersionId,
        targetNodeId: claim.nodeId,
        targetNodeVersionId: claim.nodeVersionId,
        relationType: "asserts" as const,
        status: "source-assertion" as const,
        provenance: "imported-from-review" as const,
        trustAssessments: [],
      })),
      page: { limit: 100 },
    };
    const options = {
      entryProvider: async () => [],
      graphProvider: async () => graph,
    };

    const selection = await selectGraphNativeLandscape(
      { interests: [], focusNodeId: review.nodeId },
      options,
    );
    const response = await createKnowledgeLandscapeResponse(
      { interests: [], focusNodeId: review.nodeId },
      options,
    );

    expect(selection.nodes.filter((node) => node.kind === "claim")).toHaveLength(11);
    expect(response.landscape.shownClaimCount).toBe(6);
    expect(response.landscape.nodes.filter((node) => node.kind === "claim")).toHaveLength(6);
    expect(response.landscape.nodes).toContainEqual(
      expect.objectContaining({ graphNodeId: review.nodeId }),
    );
    const visibleIds = new Set(response.landscape.nodes.map((node) => node.id));
    expect(
      response.landscape.edges.every(
        (edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId),
      ),
    ).toBe(true);
  });
});

function graphNode(
  nodeId: string,
  nodeVersionId: string,
  kind: CanonicalGraphNodeVersion["kind"],
  title: string | undefined,
): CanonicalGraphNodeVersion {
  return {
    nodeId,
    nodeVersionId,
    stableKey: `${kind}:${nodeId}`,
    localNodeId: nodeId,
    originType:
      kind === "claim"
        ? "claim-occurrence"
        : kind === "review"
          ? "review-record"
          : kind === "work"
            ? "canonical-work"
            : "repository-object",
    kind,
    source:
      kind === "claim"
        ? { type: "claim-occurrence", claimId: `source-${nodeId}` }
        : { type: "repository-snapshot", snapshotId: `snapshot-${nodeId}` },
    ...(title ? { title } : {}),
    contributors: [],
    provenance: {},
    payload: kind === "claim" ? { statement: title, claimType: "empirical" } : {},
    aliases: [],
    isExample: false,
    createdAt: "2026-08-05T12:00:00.000Z",
  };
}

function graphResponse(
  seedNodeId = "claim-node",
  seedNodeVersionId = "claim-version",
): CanonicalGraphResponse {
  const claim = graphNode(seedNodeId, seedNodeVersionId, "claim", "A model claim");
  const dataset = graphNode("dataset-node", "dataset-version", "dataset", "Dataset");
  return {
    schemaVersion: "2.0.0",
    seed: { nodeId: seedNodeId, nodeVersionId: seedNodeVersionId },
    nodes: [claim, dataset],
    edges: [
      {
        id: `edge-${seedNodeId}`,
        sourceNodeId: seedNodeId,
        sourceNodeVersionId: seedNodeVersionId,
        targetNodeId: dataset.nodeId,
        targetNodeVersionId: dataset.nodeVersionId,
        relationType: "uses-dataset",
        status: "confirmed",
        provenance: "confirmed-by-editor",
        confirmedAt: "2026-08-05T12:00:00.000Z",
        trustAssessments: [
          {
            protocolVersion: "TRUST-1.0",
            conflictOfInterest: { status: "not-provided" },
            reviewStatus: "unverified-import",
            verificationState: "unverified-import",
            assessedCriteria: ["entailment"],
          },
        ],
      },
    ],
    page: { limit: 100 },
  };
}
