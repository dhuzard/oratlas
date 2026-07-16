import { describe, expect, it } from "vitest";
import {
  NodeEdgeTransitionError,
  oppositeNodeIdForProjection,
  prepareNodeEdgeProposal,
  transitionNodeEdgeProposal,
} from "./node-edge-lifecycle.js";

describe("node edge lifecycle", () => {
  it.each([
    ["proposed", "confirmed"],
    ["proposed", "rejected"],
    ["proposed", "superseded"],
    ["confirmed", "superseded"],
  ] as const)("allows %s → %s", (current, requested) => {
    expect(transitionNodeEdgeProposal(current, requested)).toEqual({
      status: requested,
      idempotent: false,
    });
  });

  it.each([
    ["confirmed", "rejected"],
    ["confirmed", "confirmed"],
    ["rejected", "confirmed"],
    ["rejected", "superseded"],
    ["superseded", "confirmed"],
  ] as const)("rejects or idempotently handles %s → %s", (current, requested) => {
    if (current === requested) {
      expect(transitionNodeEdgeProposal(current, requested)).toEqual({
        status: requested,
        idempotent: true,
      });
    } else {
      expect(() => transitionNodeEdgeProposal(current, requested)).toThrow(NodeEdgeTransitionError);
    }
  });

  it("assigns stable keys but preserves independent origins", () => {
    const base = {
      sourceNodeId: "source",
      sourceNodeVersionId: "version-source",
      targetNodeId: "target",
      targetNodeVersionId: "version-target",
      sourceStableKey: "repo-1:source@commit",
      targetStableKey: "repo-2:target@commit",
      sourceKind: "claim" as const,
      targetKind: "claim" as const,
      relationType: "contradicts" as const,
      rationale: "Explicitly bounded evidence.",
    };
    const author = prepareNodeEdgeProposal({
      ...base,
      origin: "asserted-by-author",
      originReference: "capture:path:line:1",
    });
    expect(
      prepareNodeEdgeProposal({
        ...base,
        origin: "asserted-by-author",
        originReference: "capture:path:line:1",
      }).originKey,
    ).toBe(author.originKey);
    expect(
      prepareNodeEdgeProposal({
        ...base,
        origin: "proposed-by-agent",
        originReference: "agent-run-1",
      }).originKey,
    ).not.toBe(author.originKey);
  });

  it("enforces typed targets", () => {
    expect(() =>
      prepareNodeEdgeProposal({
        sourceNodeId: "source-node",
        sourceNodeVersionId: "source",
        targetNodeId: "target",
        targetNodeVersionId: "target-version",
        sourceStableKey: "source-stable",
        targetStableKey: "target-stable",
        sourceKind: "claim",
        targetKind: "code",
        relationType: "uses-dataset",
        origin: "proposed-by-agent",
        originReference: "run",
      }),
    ).toThrow("must target a dataset");
  });

  it("canonicalizes reciprocal contradictions to one stored orientation", () => {
    const common = {
      sourceKind: "claim" as const,
      targetKind: "claim" as const,
      relationType: "contradicts" as const,
      origin: "proposed-by-agent" as const,
      originReference: "same-run",
    };
    const forward = prepareNodeEdgeProposal({
      ...common,
      sourceNodeId: "node-a",
      sourceNodeVersionId: "version-a",
      sourceStableKey: "a",
      targetNodeId: "node-b",
      targetNodeVersionId: "version-b",
      targetStableKey: "b",
    });
    const reciprocal = prepareNodeEdgeProposal({
      ...common,
      sourceNodeId: "node-b",
      sourceNodeVersionId: "version-b",
      sourceStableKey: "b",
      targetNodeId: "node-a",
      targetNodeVersionId: "version-a",
      targetStableKey: "a",
    });
    expect(reciprocal).toMatchObject({
      sourceNodeVersionId: forward.sourceNodeVersionId,
      targetNodeVersionId: forward.targetNodeVersionId,
      targetNodeId: forward.targetNodeId,
      originKey: forward.originKey,
    });
  });

  it("projects one contradiction from both endpoints", () => {
    const edge = { sourceNodeId: "a", targetNodeId: "b", relationType: "contradicts" as const };
    expect(oppositeNodeIdForProjection(edge, "a")).toBe("b");
    expect(oppositeNodeIdForProjection(edge, "b")).toBe("a");
  });
});
