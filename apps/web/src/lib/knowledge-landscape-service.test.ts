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
          href: "/nodes/dataset-node/versions/dataset-version",
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
        graphProvider: async (nodeId, nodeVersionId) => graphResponse(nodeId, nodeVersionId),
      },
    );
    expect(entryProvider).toHaveBeenCalledOnce();
    expect(result.matchedClaimCount).toBe(8);
    expect(result.seedNodeIds).toHaveLength(3);
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
});

function graphNode(
  nodeId: string,
  nodeVersionId: string,
  kind: CanonicalGraphNodeVersion["kind"],
  title: string,
): CanonicalGraphNodeVersion {
  return {
    nodeId,
    nodeVersionId,
    stableKey: `${kind}:${nodeId}`,
    localNodeId: nodeId,
    originType: kind === "claim" ? "claim-occurrence" : "repository-object",
    kind,
    source:
      kind === "claim"
        ? { type: "claim-occurrence", claimId: `source-${nodeId}` }
        : { type: "repository-snapshot", snapshotId: `snapshot-${nodeId}` },
    title,
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
