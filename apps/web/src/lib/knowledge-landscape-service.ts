import {
  KNOWLEDGE_LANDSCAPE_ALGORITHM_VERSION,
  KNOWLEDGE_LANDSCAPE_SCHEMA_VERSION,
  knowledgeLandscapeQuerySchema,
  knowledgeLandscapeResponseSchema,
  type KnowledgeLandscapeQuery,
  type KnowledgeLandscapeResponse,
} from "@oratlas/contracts";
import { InProcessSearchProvider, type KnowledgeIndexData } from "@oratlas/knowledge";
import { buildKnowledgeLandscape } from "./knowledge-landscape.js";

export function createKnowledgeLandscapeResponse(
  index: KnowledgeIndexData,
  input: KnowledgeLandscapeQuery,
): KnowledgeLandscapeResponse {
  const query = knowledgeLandscapeQuerySchema.parse(input);
  const provider = new InProcessSearchProvider(index);
  const candidates = provider.searchClaims({
    q: query.q,
    reviewSlug: query.reviewSlug,
    claimType: query.claimType,
    relationType: query.relationType,
    trustCriterion: query.trustCriterion,
    page: 1,
    pageSize: 40,
  });
  const landscape = buildKnowledgeLandscape(index, candidates.items, query.interests, {
    query: query.q,
    focusNodeId: query.focusNodeId,
  });

  return knowledgeLandscapeResponseSchema.parse({
    schemaVersion: KNOWLEDGE_LANDSCAPE_SCHEMA_VERSION,
    algorithm: {
      id: "explicit-interest-landscape",
      version: KNOWLEDGE_LANDSCAPE_ALGORITHM_VERSION,
      purpose: "navigation",
      limitations: [
        "not-a-truth-score",
        "not-a-quality-score",
        "bounded-to-six-claims-and-ten-evidence-records",
      ],
    },
    query,
    landscape,
  });
}
