import "server-only";
import {
  KNOWLEDGE_RECOMMENDATION_ALGORITHM_VERSION,
  KNOWLEDGE_RECOMMENDATION_SCHEMA_VERSION,
  knowledgeRecommendationQuerySchema,
  knowledgeRecommendationResponseSchema,
  type KnowledgeLandscapeNode,
  type KnowledgeRecommendationQuery,
  type KnowledgeRecommendationResponse,
} from "@oratlas/contracts";
import type { KnowledgeIndexData } from "@oratlas/knowledge";
import { prisma } from "./db";
import { createKnowledgeLandscapeResponse } from "./knowledge-landscape-service";

export interface CanonicalNodeReference {
  nodeId: string;
  nodeVersionId?: string;
}

export type KnowledgeReferenceResolver = (
  nodes: readonly KnowledgeLandscapeNode[],
) => Promise<ReadonlyMap<string, CanonicalNodeReference>>;

export interface KnowledgeRecommendationServiceOptions {
  resolveReferences?: KnowledgeReferenceResolver;
}

export async function createKnowledgeRecommendationResponse(
  index: KnowledgeIndexData,
  input: KnowledgeRecommendationQuery,
  options: KnowledgeRecommendationServiceOptions = {},
): Promise<KnowledgeRecommendationResponse> {
  const query = knowledgeRecommendationQuerySchema.parse(input);
  const landscape = await createKnowledgeLandscapeResponse(index, query);
  const resolveReferences = options.resolveReferences ?? resolveDatabaseReferences;
  const references = await resolveReferences(landscape.landscape.nodes);
  const ordered = uniqueResolvedNodes(landscape.landscape.nodes, references);
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
    })),
    omittedUnboundCount: landscape.landscape.nodes.filter((node) => !references.has(node.id))
      .length,
  });
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
