import { describe, expect, it } from "vitest";
import type { SubgraphEvidencePacket } from "@oratlas/contracts";
import { compareSynthesisPackets } from "./synthesis-staleness.js";

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

describe("compareSynthesisPackets", () => {
  it("reports deterministic membership and confirmed-edge deltas", () => {
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

    expect([...compareSynthesisPackets(reduced, accepted).reasons]).toEqual([
      "membership-added",
      "confirmed-edge-added",
    ]);
  });

  it("separates exact edge drift from TRUST assessment drift", () => {
    const accepted = packet();
    const changedTrust = packet({
      edges: [{ ...(accepted.edges[0] as object), trust: { assessmentId: "trust-2" } }],
    });
    expect([...compareSynthesisPackets(accepted, changedTrust).reasons]).toEqual(["trust-changed"]);

    const changedEdge = packet({
      edges: [{ ...(accepted.edges[0] as object), relationType: "contradicts" }],
    });
    expect([...compareSynthesisPackets(accepted, changedEdge).reasons]).toEqual([
      "confirmed-edge-changed",
    ]);
  });
});
