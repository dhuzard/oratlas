import "server-only";
import {
  KNOWLEDGE_RECOMMENDATION_ALGORITHM_VERSION,
  KNOWLEDGE_RECOMMENDATION_SCHEMA_VERSION,
  knowledgeRecommendationQuerySchema,
  knowledgeRecommendationResponseSchema,
  type KnowledgeRecommendationAnchor,
  type KnowledgeRecommendationQuery,
  type KnowledgeRecommendationResponse,
} from "@oratlas/contracts";
import { prisma } from "./db";
import {
  selectGraphNativeLandscape,
  type GraphNativeLandscapeSelection,
} from "./knowledge-landscape-service";
import { canonicalNodeDisplayLabel } from "./canonical-node-label";
import { publicConfirmedNodeEdgeWhere } from "./node-edge-publication";
import { readableCanonicalNodeVersionWhere } from "./public-snapshot-visibility";

export interface CanonicalNodeReference {
  nodeId: string;
  nodeVersionId: string;
}

export type KnowledgeAnchorResolver = (
  recommendations: readonly CanonicalNodeReference[],
  knownNodeIds: readonly string[],
) => Promise<ReadonlyMap<string, readonly KnowledgeRecommendationAnchor[]>>;

export function canonicalReferenceKey(reference: CanonicalNodeReference): string {
  return `${reference.nodeId}\u0000${reference.nodeVersionId}`;
}

/** Canonical-content labels for renderer-owned known-set and anchor copy. */
export async function resolveCanonicalReferenceLabels(
  references: readonly CanonicalNodeReference[],
): Promise<ReadonlyMap<string, string>> {
  const versions = await prisma.knowledgeNodeVersion.findMany({
    where: {
      ...readableCanonicalNodeVersionWhere,
      id: { in: [...new Set(references.map(({ nodeVersionId }) => nodeVersionId))] },
    },
    include: { knowledgeNode: { include: { aliases: { orderBy: { id: "asc" } } } } },
  });
  const requested = new Set(references.map(canonicalReferenceKey));
  const labels = new Map<string, string>();
  for (const version of versions) {
    const key = canonicalReferenceKey({
      nodeId: version.knowledgeNodeId,
      nodeVersionId: version.id,
    });
    if (!requested.has(key)) continue;
    const payload = parsePayload(version.payloadJson);
    labels.set(
      key,
      canonicalNodeDisplayLabel({
        kind: version.knowledgeNode.kind,
        localNodeId: version.knowledgeNode.localNodeId,
        title: version.title,
        abstract: version.abstract,
        text: version.text,
        payload,
        aliases: version.knowledgeNode.aliases,
      }),
    );
  }
  return labels;
}

export interface KnowledgeRecommendationServiceOptions {
  resolveAnchors?: KnowledgeAnchorResolver;
  selectGraph?: (
    query: Omit<KnowledgeRecommendationQuery, "knownNodeIds">,
  ) => Promise<GraphNativeLandscapeSelection>;
}

export async function createKnowledgeRecommendationResponse(
  input: KnowledgeRecommendationQuery,
  options: KnowledgeRecommendationServiceOptions = {},
): Promise<KnowledgeRecommendationResponse> {
  const query = knowledgeRecommendationQuerySchema.parse(input);
  const { knownNodeIds, ...landscapeQuery } = query;
  const selectGraph = options.selectGraph ?? selectGraphNativeLandscape;
  const selection = await selectGraph(landscapeQuery);
  const ordered = uniqueResolvedNodes(selection.recommendations).filter(
    ({ nodeId }) => !knownNodeIds.includes(nodeId),
  );
  const resolveAnchors = options.resolveAnchors ?? resolveDatabaseAnchors;
  const anchors = await resolveAnchors(
    ordered.map(({ nodeId, nodeVersionId }) => ({ nodeId, nodeVersionId })),
    knownNodeIds,
  );
  const ranked = ordered
    .map((recommendation, originalIndex) => ({
      ...recommendation,
      originalIndex,
      anchors: (anchors.get(recommendation.nodeId) ?? []).filter(
        (anchor) => anchor.recommendedNodeVersionId === recommendation.nodeVersionId,
      ),
    }))
    .sort(
      (left, right) =>
        Number(right.anchors.length > 0) - Number(left.anchors.length > 0) ||
        left.originalIndex - right.originalIndex,
    );
  const denominator = Math.max(1, ranked.length - 1);

  return knowledgeRecommendationResponseSchema.parse({
    schemaVersion: KNOWLEDGE_RECOMMENDATION_SCHEMA_VERSION,
    algorithm: {
      id: "explicit-interest-recommendation",
      version: KNOWLEDGE_RECOMMENDATION_ALGORITHM_VERSION,
      purpose: "recommendation",
      limitations: [
        "not-a-truth-score",
        "not-a-quality-score",
        "canonical-source-assertion-and-confirmed-edges",
        "bounded-to-three-entry-neighborhoods-and-twelve-exact-versions",
      ],
    },
    query,
    recommendations: ranked.map(({ nodeId, nodeVersionId, reasons, anchors }, index) => ({
      nodeId,
      nodeVersionId,
      rank: index + 1,
      score: ordered.length === 1 ? 1 : 1 - index / denominator,
      reasons: reasons.slice(0, 10),
      anchors,
    })),
    omittedUnboundCount: 0,
  });
}

export async function resolveDatabaseAnchors(
  recommendations: readonly CanonicalNodeReference[],
  knownNodeIds: readonly string[],
): Promise<ReadonlyMap<string, readonly KnowledgeRecommendationAnchor[]>> {
  const recommendedById = new Map<string, CanonicalNodeReference[]>();
  for (const reference of recommendations) {
    const list = recommendedById.get(reference.nodeId) ?? [];
    list.push(reference);
    recommendedById.set(reference.nodeId, list);
  }
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
    const sourceReferences = recommendedById.get(edge.sourceNodeVersion.knowledgeNodeId) ?? [];
    const targetReferences = recommendedById.get(target.knowledgeNodeId) ?? [];
    if (knownSet.has(target.knowledgeNodeId)) {
      for (const sourceReference of sourceReferences) {
        addAnchor(output, sourceReference, {
          edgeId: edge.id,
          relationType: edge.relationType as KnowledgeRecommendationAnchor["relationType"],
          directionFromRecommendation: "outgoing",
          recommendedNodeVersionId: edge.sourceNodeVersion.id,
          knownNodeId: target.knowledgeNodeId,
          knownNodeVersionId: target.id,
        });
      }
    }
    if (knownSet.has(edge.sourceNodeVersion.knowledgeNodeId)) {
      for (const targetReference of targetReferences) {
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
  nodes: ReadonlyArray<CanonicalNodeReference & { reasons: string[] }>,
): Array<CanonicalNodeReference & { reasons: string[] }> {
  const output = new Map<string, CanonicalNodeReference & { reasons: string[] }>();
  for (const node of nodes) {
    const key = `${node.nodeId}\u0000${node.nodeVersionId}`;
    const current = output.get(key);
    if (current) {
      current.reasons = [...new Set([...current.reasons, ...node.reasons])];
    } else {
      output.set(key, { ...node, reasons: [...node.reasons] });
    }
  }
  return [...output.values()];
}

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return undefined;
  }
}
