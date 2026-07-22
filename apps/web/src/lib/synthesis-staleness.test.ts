import { describe, expect, it, vi } from "vitest";
import {
  synthesisFreshnessSchema,
  SYNTHESIS_STALENESS_AFFECTED_REFERENCE_MAX,
  type SubgraphEvidencePacket,
} from "@oratlas/contracts";
import { compareSynthesisPackets } from "./synthesis-staleness";

vi.mock("server-only", () => ({}));

function packet(input?: {
  nodes?: Array<{ id: string; versionId: string }>;
  edges?: Array<Record<string, unknown>>;
}): SubgraphEvidencePacket {
  return {
    nodes: input?.nodes ?? [
      { id: "node-a", versionId: "node-a-v1" },
      { id: "node-b", versionId: "node-b-v1" },
    ],
    edges: input?.edges ?? [
      {
        id: "edge-1",
        sourceNodeId: "node-a",
        sourceVersionId: "node-a-v1",
        targetNodeId: "node-b",
        targetVersionId: "node-b-v1",
        relationType: "supports",
        status: "confirmed",
        provenance: "confirmed-by-editor",
        confirmedAt: "2026-01-01T00:00:00.000Z",
        trust: { assessmentId: "trust-1", aggregateScore: 0.5 },
      },
    ],
  } as unknown as SubgraphEvidencePacket;
}

describe("synthesis packet staleness deltas", () => {
  it("classifies membership and confirmed-edge additions/removals deterministically", () => {
    const accepted = packet();
    const reduced = packet({ nodes: [{ id: "node-a", versionId: "node-a-v1" }], edges: [] });
    const removed = compareSynthesisPackets(accepted, reduced);
    expect([...removed.reasons]).toEqual(["membership-removed", "confirmed-edge-removed"]);
    expect(removed.affected).toEqual([
      {
        kind: "node",
        id: "node-b",
        change: "removed",
        previousVersionId: "node-b-v1",
      },
      { kind: "edge", id: "edge-1", change: "removed" },
    ]);
    const added = compareSynthesisPackets(reduced, accepted);
    expect([...added.reasons]).toEqual(["membership-added", "confirmed-edge-added"]);
  });

  it("accepts the exact 1,201-reference disjoint-packet plus policy boundary", () => {
    const oldNodes = Array.from({ length: 100 }, (_, index) => ({
      id: `old-node-${index}`,
      versionId: `old-node-${index}-v1`,
    }));
    const newNodes = Array.from({ length: 100 }, (_, index) => ({
      id: `new-node-${index}`,
      versionId: `new-node-${index}-v1`,
    }));
    const edge = (prefix: string, index: number) => ({
      id: `${prefix}-edge-${index}`,
      sourceNodeId: `${prefix}-source-${index}`,
      sourceVersionId: `${prefix}-source-${index}-v1`,
      targetNodeId: `${prefix}-target-${index}`,
      targetVersionId: `${prefix}-target-${index}-v1`,
      relationType: "supports",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedAt: "2026-01-01T00:00:00.000Z",
    });
    const delta = compareSynthesisPackets(
      packet({ nodes: oldNodes, edges: Array.from({ length: 500 }, (_, i) => edge("old", i)) }),
      packet({ nodes: newNodes, edges: Array.from({ length: 500 }, (_, i) => edge("new", i)) }),
    );
    expect(delta.affected).toHaveLength(1_200);
    expect(SYNTHESIS_STALENESS_AFFECTED_REFERENCE_MAX).toBe(1_201);
    expect(
      synthesisFreshnessSchema.safeParse({
        status: "stale",
        policyVersion: "synthesis-staleness/1.0.0",
        evaluatedAt: "2026-07-16T12:00:00.000Z",
        reasonCodes: [
          "materialization-policy-changed",
          "membership-added",
          "membership-removed",
          "confirmed-edge-added",
          "confirmed-edge-removed",
        ],
        affectedReferenceCount: delta.affected.length + 1,
      }).success,
    ).toBe(true);
  });

  it("separates exact edge drift from relation-specific TRUST drift", () => {
    const accepted = packet();
    const changedTrust = packet({
      edges: [{ ...(accepted.edges[0] as object), trust: { assessmentId: "trust-2" } }],
    });
    expect([...compareSynthesisPackets(accepted, changedTrust).reasons]).toEqual(["trust-changed"]);
    const changedAssessmentSet = packet({
      edges: [
        {
          ...(accepted.edges[0] as object),
          trust: undefined,
          trustAssessments: [{ assessmentId: "trust-1" }, { assessmentId: "trust-2" }],
        },
      ],
    });
    expect([...compareSynthesisPackets(accepted, changedAssessmentSet).reasons]).toEqual([
      "trust-changed",
    ]);
    const changedEdge = packet({
      edges: [{ ...(accepted.edges[0] as object), relationType: "contradicts" }],
    });
    expect([...compareSynthesisPackets(accepted, changedEdge).reasons]).toEqual([
      "confirmed-edge-changed",
    ]);
  });
});
