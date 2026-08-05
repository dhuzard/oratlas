import "server-only";
import { knowledgeLandscapeQuerySchema, type KnowledgeLandscapeQuery } from "@oratlas/contracts";
import { buildEvidencePacket, type KnowledgeIndexData } from "@oratlas/knowledge";
import { createKnowledgeLandscapeResponse } from "./knowledge-landscape-service";

export interface ResolvedDiscussionScope {
  kind: "archive" | "review" | "explore";
  query?: KnowledgeLandscapeQuery;
  claimIds: string[];
  landscapeNodeIds: string[];
  label: string;
}

/**
 * Select the exact evidence available to Atlas Discuss. Explore and the Discuss
 * API both resolve scope through the same deterministic landscape service; the
 * LLM never receives a silently broadened database or repository search.
 */
export async function selectDiscussionEvidence(
  index: KnowledgeIndexData,
  question: string,
  input: { reviewSlugs?: string[]; explore?: KnowledgeLandscapeQuery } = {},
) {
  if (input.explore) {
    const query = knowledgeLandscapeQuerySchema.parse(input.explore);
    const response = await createKnowledgeLandscapeResponse(index, query);
    const claimIds = response.landscape.nodes.flatMap((node) =>
      node.kind === "claim" && node.id.startsWith("claim:") ? [node.id.slice("claim:".length)] : [],
    );
    const packet = buildEvidencePacket(index, question, {
      claimIds,
      maxClaims: 6,
    });
    return {
      packet,
      scope: {
        kind: "explore" as const,
        query,
        claimIds: packet.claims.map((claim) => claim.claimId),
        landscapeNodeIds: response.landscape.nodes.map((node) => node.id),
        label: describeExploreScope(query),
      },
    };
  }

  const packet = buildEvidencePacket(index, question, { reviewSlugs: input.reviewSlugs });
  return {
    packet,
    scope: {
      kind: input.reviewSlugs?.length ? ("review" as const) : ("archive" as const),
      claimIds: packet.claims.map((claim) => claim.claimId),
      landscapeNodeIds: [],
      label: input.reviewSlugs?.length
        ? `Accepted review${input.reviewSlugs.length === 1 ? "" : "s"}: ${input.reviewSlugs.join(", ")}`
        : "All accepted reviews in the archive",
    },
  };
}

function describeExploreScope(query: KnowledgeLandscapeQuery): string {
  const parts = [
    query.q ? `topic “${query.q}”` : undefined,
    query.interests.length > 0 ? `interests ${query.interests.join(", ")}` : undefined,
    query.focusNodeId ? `one step from ${query.focusNodeId}` : undefined,
    query.reviewSlug ? `review ${query.reviewSlug}` : undefined,
    query.claimType ? `claim type ${query.claimType}` : undefined,
    query.relationType ? `relation ${query.relationType}` : undefined,
    query.trustCriterion ? `assessment criterion ${query.trustCriterion}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Current bounded Explore landscape";
}
