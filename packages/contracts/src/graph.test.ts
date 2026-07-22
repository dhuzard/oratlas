import { describe, expect, it } from "vitest";
import {
  GRAPH_MAX_DEPTH,
  GRAPH_MAX_PAGE_SIZE,
  publicGraphEdgeSchema,
  publicGraphNodeSchema,
  publicGraphQuerySchema,
  publicGraphTrustSchema,
} from "./graph.js";

describe("public graph contracts", () => {
  it("applies bounded defaults", () => {
    expect(publicGraphQuerySchema.parse({ seed: "node-1" })).toMatchObject({
      depth: 1,
      limit: 25,
      edgeStatus: "confirmed",
    });
  });

  it.each([
    { seed: "node-1", depth: GRAPH_MAX_DEPTH + 1 },
    { seed: "node-1", limit: GRAPH_MAX_PAGE_SIZE + 1 },
    { seed: "node-1", edgeStatus: "rejected" },
    { seed: "node-1", q: "topic" },
    {},
  ])("rejects an unsafe graph query %#", (query) => {
    expect(publicGraphQuerySchema.safeParse(query).success).toBe(false);
  });

  it("requires immutable snapshot identity and keeps TRUST edge-scoped", () => {
    expect(
      publicGraphNodeSchema.safeParse({
        id: "n1",
        localNodeId: "claim-1",
        kind: "claim",
        repository: { owner: "lab", name: "repo", url: "https://github.com/lab/repo" },
        versionId: "v1",
        title: "Claim",
        provenance: { sourcePath: "nodes/claim.json" },
        identifiers: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      publicGraphTrustSchema.safeParse({
        protocolVersion: "TRUST-1.0",
        reviewStatus: "human-reviewed",
        verificationState: "platform-verified",
        aggregateScore: 0.8,
        aggregateMethod: "ordinal-mean-1.0",
      }).success,
    ).toBe(false);
    expect(
      publicGraphEdgeSchema.safeParse({
        id: "p1",
        sourceNodeId: "n1",
        sourceVersionId: "v1",
        targetNodeId: "n2",
        targetVersionId: "v2",
        relationType: "supports",
        status: "proposed",
        provenance: "proposed-by-agent",
        proposedAt: "2026-01-01T00:00:00.000Z",
        trust: {
          protocolVersion: "TRUST-1.0",
          reviewStatus: "human-reviewed",
          verificationState: "platform-verified",
        },
      }).success,
    ).toBe(false);
  });

  it("publishes only the bounded assessment COI snapshot", () => {
    const assessment = {
      protocolVersion: "TRUST-1.0",
      conflictOfInterest: { status: "not-provided" },
      reviewStatus: "unverified-import",
      verificationState: "unverified-import",
    };
    expect(publicGraphTrustSchema.safeParse(assessment).success).toBe(true);
    expect(
      publicGraphTrustSchema.safeParse({
        ...assessment,
        conflictOfInterest: { status: "conflict-declared", rationale: "private" },
      }).success,
    ).toBe(false);
  });
});
