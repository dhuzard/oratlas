import { z } from "zod";
import { knowledgeNodeKindSchema, nodeRelationTypeSchema } from "./enums.js";

export const GRAPH_CURATION_PACKET_VERSION = "1.0.0" as const;
export const GRAPH_CURATION_OUTPUT_VERSION = "1.0.0" as const;

export const graphCurationNodeSchema = z
  .object({
    landscapeNodeId: z.string().min(1).max(500),
    nodeId: z.string().min(1).max(200),
    nodeVersionId: z.string().min(1).max(200),
    kind: knowledgeNodeKindSchema,
    title: z.string().min(1).max(2_000),
  })
  .strict();

export const graphCurationExistingEdgeSchema = z
  .object({
    sourceNodeVersionId: z.string().min(1).max(200),
    targetNodeVersionId: z.string().min(1).max(200),
    relationType: nodeRelationTypeSchema,
  })
  .strict();

export const graphCurationPacketSchema = z
  .object({
    schemaVersion: z.literal(GRAPH_CURATION_PACKET_VERSION),
    question: z.string().min(3).max(1_000),
    nodes: z.array(graphCurationNodeSchema).min(2).max(12),
    confirmedEdges: z.array(graphCurationExistingEdgeSchema).max(100),
  })
  .strict();
export type GraphCurationPacket = z.infer<typeof graphCurationPacketSchema>;

export const graphCurationCandidateSchema = z
  .object({
    sourceNodeVersionId: z.string().min(1).max(200),
    targetNodeVersionId: z.string().min(1).max(200),
    relationType: nodeRelationTypeSchema,
    rationale: z.string().trim().min(20).max(2_000),
    evidenceNodeIds: z.array(z.string().min(1).max(500)).min(1).max(12),
  })
  .strict();
export type GraphCurationCandidate = z.infer<typeof graphCurationCandidateSchema>;

export const graphCurationOutputSchema = z
  .object({
    schemaVersion: z.literal(GRAPH_CURATION_OUTPUT_VERSION),
    proposals: z.array(graphCurationCandidateSchema).max(12),
  })
  .strict();
export type GraphCurationOutput = z.infer<typeof graphCurationOutputSchema>;

export interface GraphCurationValidationResult {
  ok: boolean;
  output?: GraphCurationOutput;
  issues: string[];
}

/** Reject every candidate that escapes the exact packet or duplicates a confirmed edge. */
export function validateGraphCurationOutput(
  value: unknown,
  packet: GraphCurationPacket,
): GraphCurationValidationResult {
  const parsedPacket = graphCurationPacketSchema.parse(packet);
  const parsed = graphCurationOutputSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.message).slice(0, 20) };
  }
  const versionIds = new Set(parsedPacket.nodes.map((node) => node.nodeVersionId));
  const landscapeIds = new Set(parsedPacket.nodes.map((node) => node.landscapeNodeId));
  const existing = new Set(
    parsedPacket.confirmedEdges.map((edge) =>
      edgeKey(edge.sourceNodeVersionId, edge.targetNodeVersionId, edge.relationType),
    ),
  );
  const candidates = new Set<string>();
  const issues: string[] = [];
  for (const [index, candidate] of parsed.data.proposals.entries()) {
    if (!versionIds.has(candidate.sourceNodeVersionId))
      issues.push(`proposal ${index}: unknown source`);
    if (!versionIds.has(candidate.targetNodeVersionId))
      issues.push(`proposal ${index}: unknown target`);
    if (candidate.sourceNodeVersionId === candidate.targetNodeVersionId) {
      issues.push(`proposal ${index}: self edge`);
    }
    if (candidate.evidenceNodeIds.some((id) => !landscapeIds.has(id))) {
      issues.push(`proposal ${index}: unknown evidence node`);
    }
    const key = edgeKey(
      candidate.sourceNodeVersionId,
      candidate.targetNodeVersionId,
      candidate.relationType,
    );
    if (existing.has(key)) issues.push(`proposal ${index}: already confirmed`);
    if (candidates.has(key)) issues.push(`proposal ${index}: duplicate candidate`);
    candidates.add(key);
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, output: parsed.data, issues: [] };
}

function edgeKey(source: string, target: string, relationType: string): string {
  const endpoints = relationType === "contradicts" ? [source, target].sort() : [source, target];
  return JSON.stringify([...endpoints, relationType]);
}
