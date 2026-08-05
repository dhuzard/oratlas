import "server-only";
import {
  KNOWLEDGE_RECOMMENDATION_ALGORITHM_VERSION,
  KNOWLEDGE_RECOMMENDATION_SCHEMA_VERSION,
  knowledgeRecommendationQuerySchema,
  knowledgeRecommendationResponseSchema,
  type KnowledgeLandscapeNode,
  type KnowledgeRecommendationAnchor,
  type KnowledgeRecommendationQuery,
  type KnowledgeRecommendationResponse,
} from "@oratlas/contracts";
import type { KnowledgeIndexData } from "@oratlas/knowledge";
import { prisma } from "./db";
import { createKnowledgeLandscapeResponse } from "./knowledge-landscape-service";
import { publicConfirmedNodeEdgeWhere } from "./node-edge-publication";
import { readableCanonicalNodeVersionWhere } from "./public-snapshot-visibility";

export interface CanonicalNodeReference {
  nodeId: string;
  nodeVersionId?: string;
}

export type KnowledgeReferenceResolver = (
  nodes: readonly KnowledgeLandscapeNode[],
) => Promise<ReadonlyMap<string, CanonicalNodeReference>>;

export type KnowledgeAnchorResolver = (
  recommendations: readonly CanonicalNodeReference[],
  knownNodeIds: readonly string[],
) => Promise<ReadonlyMap<string, readonly KnowledgeRecommendationAnchor[]>>;

export interface KnowledgeRecommendationServiceOptions {
  resolveReferences?: KnowledgeReferenceResolver;
  resolveAnchors?: KnowledgeAnchorResolver;
}

export async function createKnowledgeRecommendationResponse(
  index: KnowledgeIndexData,
  input: KnowledgeRecommendationQuery,
  options: KnowledgeRecommendationServiceOptions = {},
): Promise<KnowledgeRecommendationResponse> {
  const query = knowledgeRecommendationQuerySchema.parse(input);
  const { knownNodeIds, ...landscapeQuery } = query;
  const landscape = await createKnowledgeLandscapeResponse(index, landscapeQuery);
  const resolveReferences = options.resolveReferences ?? resolveDatabaseReferences;
  const references = await resolveReferences(landscape.landscape.nodes);
  const ordered = uniqueResolvedNodes(landscape.landscape.nodes, references);
  const resolveAnchors = options.resolveAnchors ?? resolveDatabaseAnchors;
  const anchors = await resolveAnchors(
    ordered.map(({ reference }) => reference),
    knownNodeIds,
  );
  const denominator = Math.max(1, ordered.length - 1);

  return knowledgeRecommendationResponseSchema.parse({
    schemaVersion: KNOWLEDGE_RECOMMENDATION_SCHEMA_VERSION,
    algorithm: {
      id: "explicit-interest-recommendation",
      version: KNOWLEDGE_RECOMMENDATION_ALGORITHM_VERSION,
      purpose: "recommendation",
      limitations: [
        "not-a-truth-score",
        "not-a-quality-score",
        "confirmed-graph-edges-only",
        "bounded-to-six-claims-ten-evidence-and-twelve-graph-nodes",
      ],
    },
    query,
    recommendations: ordered.map(({ reference, reasons }, index) => ({
      ...reference,
      rank: index + 1,
      score: ordered.length === 1 ? 1 : 1 - index / denominator,
      reasons: reasons.slice(0, 10),
      anchors: anchors.get(reference.nodeId) ?? [],
    })),
    omittedUnboundCount: landscape.landscape.nodes.filter((node) => !references.has(node.id))
      .length,
  });
}

export async function resolveDatabaseAnchors(
  recommendations: readonly CanonicalNodeReference[],
  knownNodeIds: readonly string[],
): Promise<ReadonlyMap<string, readonly KnowledgeRecommendationAnchor[]>> {
  const recommendedById = new Map(
    recommendations.map((reference) => [reference.nodeId, reference]),
  );
  const recommendedNodeIds = [...recommendedById.keys()];
  const known = [...new Set(knownNodeIds)];
  const knownSet = new Set(known);
  if (recommendedNodeIds.length === 0 || known.length === 0) return new Map();

  const edges = await prisma.nodeEdge.findMany({
    where: {
      ...publicConfirmedNodeEdgeWhere,
      sourceNodeVersion: readableCanonicalNodeVersionWhere,
      confirmedTargetNodeVersion: readableCanonicalNodeVersionWhere,
      OR: [
        {
          sourceNodeVersion: { knowledgeNodeId: { in: recommendedNodeIds } },
          targetNodeId: { in: known },
        },
        {
          sourceNodeVersion: { knowledgeNodeId: { in: known } },
          targetNodeId: { in: recommendedNodeIds },
        },
      ],
    },
    select: {
      id: true,
      relationType: true,
      targetNodeId: true,
      sourceNodeVersion: { select: { id: true, knowledgeNodeId: true } },
      confirmedTargetNodeVersion: { select: { id: true, knowledgeNodeId: true } },
    },
    orderBy: { id: "asc" },
  });

  const output = new Map<string, KnowledgeRecommendationAnchor[]>();
  for (const edge of edges) {
    const target = edge.confirmedTargetNodeVersion;
    if (!target || target.knowledgeNodeId !== edge.targetNodeId) continue;
    const sourceReference = recommendedById.get(edge.sourceNodeVersion.knowledgeNodeId);
    const targetReference = recommendedById.get(target.knowledgeNodeId);
    if (sourceReference && knownSet.has(target.knowledgeNodeId)) {
      addAnchor(output, sourceReference, {
        edgeId: edge.id,
        relationType: edge.relationType as KnowledgeRecommendationAnchor["relationType"],
        directionFromRecommendation: "outgoing",
        recommendedNodeVersionId: edge.sourceNodeVersion.id,
        knownNodeId: target.knowledgeNodeId,
        knownNodeVersionId: target.id,
      });
    }
    if (targetReference && knownSet.has(edge.sourceNodeVersion.knowledgeNodeId)) {
      addAnchor(output, targetReference, {
        edgeId: edge.id,
        relationType: edge.relationType as KnowledgeRecommendationAnchor["relationType"],
        directionFromRecommendation: "incoming",
        recommendedNodeVersionId: target.id,
        knownNodeId: edge.sourceNodeVersion.knowledgeNodeId,
        knownNodeVersionId: edge.sourceNodeVersion.id,
      });
    }
  }
  return output;
}

function addAnchor(
  output: Map<string, KnowledgeRecommendationAnchor[]>,
  recommendation: CanonicalNodeReference,
  anchor: KnowledgeRecommendationAnchor,
): void {
  if (recommendation.nodeId === anchor.knownNodeId) return;
  if (
    recommendation.nodeVersionId &&
    recommendation.nodeVersionId !== anchor.recommendedNodeVersionId
  ) {
    return;
  }
  const list = output.get(recommendation.nodeId) ?? [];
  list.push(anchor);
  output.set(recommendation.nodeId, list);
}

function uniqueResolvedNodes(
  nodes: readonly KnowledgeLandscapeNode[],
  references: ReadonlyMap<string, CanonicalNodeReference>,
): Array<{ reference: CanonicalNodeReference; reasons: string[] }> {
  const output = new Map<string, { reference: CanonicalNodeReference; reasons: string[] }>();
  for (const node of nodes) {
    const reference = references.get(node.id);
    if (!reference) continue;
    const current = output.get(reference.nodeId);
    if (current) {
      current.reasons = [...new Set([...current.reasons, ...node.reasons])];
    } else {
      output.set(reference.nodeId, { reference, reasons: [...node.reasons] });
    }
  }
  return [...output.values()];
}

async function resolveDatabaseReferences(
  nodes: readonly KnowledgeLandscapeNode[],
): Promise<ReadonlyMap<string, CanonicalNodeReference>> {
  const references = new Map<string, CanonicalNodeReference>();
  const claimIds: string[] = [];
  const reviewVersionIds: string[] = [];
  const workStableKeys: string[] = [];

  for (const node of nodes) {
    if (node.graphNodeId) {
      references.set(node.id, {
        nodeId: node.graphNodeId,
        nodeVersionId: node.graphNodeVersionId,
      });
    } else if (node.id.startsWith("claim:")) {
      claimIds.push(node.id.slice("claim:".length));
    } else if (node.id.startsWith("review:")) {
      reviewVersionIds.push(node.id.slice("review:".length));
    } else if (node.id.startsWith("evidence:")) {
      workStableKeys.push(node.id.slice("evidence:".length));
    }
  }

  const [claims, reviewVersions, works] = await Promise.all([
    prisma.claim.findMany({
      where: { id: { in: claimIds } },
      select: { id: true, knowledgeNodeId: true, graphVersion: { select: { id: true } } },
    }),
    prisma.reviewVersion.findMany({
      where: { id: { in: reviewVersionIds } },
      select: {
        id: true,
        graphVersion: { select: { id: true } },
        review: { select: { knowledgeNodeId: true } },
      },
    }),
    prisma.knowledgeNode.findMany({
      where: { stableKey: { in: workStableKeys }, kind: "work" },
      select: { id: true, stableKey: true },
    }),
  ]);

  for (const claim of claims) {
    if (claim.knowledgeNodeId) {
      references.set(`claim:${claim.id}`, {
        nodeId: claim.knowledgeNodeId,
        nodeVersionId: claim.graphVersion?.id,
      });
    }
  }
  for (const version of reviewVersions) {
    if (version.review.knowledgeNodeId) {
      references.set(`review:${version.id}`, {
        nodeId: version.review.knowledgeNodeId,
        nodeVersionId: version.graphVersion?.id,
      });
    }
  }
  for (const work of works) {
    if (work.stableKey) references.set(`evidence:${work.stableKey}`, { nodeId: work.id });
  }
  return references;
}
