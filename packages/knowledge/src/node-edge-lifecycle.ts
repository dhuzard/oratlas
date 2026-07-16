import { createHash } from "node:crypto";
import {
  canonicalJson,
  nodeRelationTypeSchema,
  type KnowledgeNodeKind,
  type NodeEdgeStatus,
  type NodeRelationType,
} from "@oratlas/contracts";

export type NodeEdgeProposalOrigin = "asserted-by-author" | "proposed-by-agent";
export type NodeEdgeDecisionStatus = "confirmed" | "rejected" | "superseded";

export class NodeEdgeTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeEdgeTransitionError";
  }
}

export interface PrepareNodeEdgeProposalInput {
  sourceNodeId: string;
  sourceNodeVersionId: string;
  targetNodeId: string;
  targetNodeVersionId: string;
  sourceKind: KnowledgeNodeKind;
  targetKind: KnowledgeNodeKind;
  relationType: NodeRelationType;
  origin: NodeEdgeProposalOrigin;
  originReference: string;
  sourceStableKey: string;
  targetStableKey: string;
  rationale?: string;
  evidence?: unknown;
}

export interface PreparedNodeEdgeProposal extends PrepareNodeEdgeProposalInput {
  originKey: string;
  evidenceJson: string;
}

/** Validate a typed candidate and assign a deterministic, source-scoped idempotency key. */
export function prepareNodeEdgeProposal(
  input: PrepareNodeEdgeProposalInput,
): PreparedNodeEdgeProposal {
  const relationType = nodeRelationTypeSchema.parse(input.relationType);
  if (relationType === "uses-dataset" && input.targetKind !== "dataset") {
    throw new NodeEdgeTransitionError("uses-dataset edges must target a dataset node.");
  }
  if (relationType === "uses-code" && input.targetKind !== "code") {
    throw new NodeEdgeTransitionError("uses-code edges must target a code node.");
  }
  if (!input.originReference.trim()) {
    throw new NodeEdgeTransitionError("An attributable proposal origin is required.");
  }
  const evidenceJson = canonicalJson(input.evidence ?? {});
  const canonical = canonicalizeContradiction(input, relationType);
  const originKey = createHash("sha256")
    .update(
      canonicalJson({
        origin: input.origin,
        originReference: input.originReference,
        sourceStableKey: canonical.sourceStableKey,
        targetStableKey: canonical.targetStableKey,
        relationType,
      }),
    )
    .digest("hex");
  return { ...canonical, relationType, evidenceJson, originKey };
}

function canonicalizeContradiction(
  input: PrepareNodeEdgeProposalInput,
  relationType: NodeRelationType,
): PrepareNodeEdgeProposalInput {
  if (relationType !== "contradicts" || input.sourceStableKey <= input.targetStableKey)
    return input;
  return {
    ...input,
    sourceNodeId: input.targetNodeId,
    sourceNodeVersionId: input.targetNodeVersionId,
    targetNodeId: input.sourceNodeId,
    targetNodeVersionId: input.sourceNodeVersionId,
    sourceKind: input.targetKind,
    targetKind: input.sourceKind,
    sourceStableKey: input.targetStableKey,
    targetStableKey: input.sourceStableKey,
  };
}

/** Pure lifecycle gate used by persistence and exhaustive unit tests. */
export function transitionNodeEdgeProposal(
  current: NodeEdgeStatus,
  requested: NodeEdgeDecisionStatus,
): { status: NodeEdgeDecisionStatus; idempotent: boolean } {
  if (current === requested) return { status: requested, idempotent: true };
  const allowed =
    current === "proposed"
      ? (["confirmed", "rejected", "superseded"] as const)
      : current === "confirmed"
        ? (["superseded"] as const)
        : ([] as const);
  if (!allowed.includes(requested as never)) {
    throw new NodeEdgeTransitionError(`Illegal node-edge transition ${current} → ${requested}.`);
  }
  return { status: requested, idempotent: false };
}

/** One stored contradiction is projected from both endpoints, never duplicated. */
export function oppositeNodeIdForProjection(
  edge: {
    sourceNodeId: string;
    targetNodeId: string;
    relationType: NodeRelationType;
  },
  seedNodeId: string,
): string | undefined {
  if (edge.sourceNodeId === seedNodeId) return edge.targetNodeId;
  if (edge.relationType === "contradicts" && edge.targetNodeId === seedNodeId) {
    return edge.sourceNodeId;
  }
  return undefined;
}
