import type { IndexedClaim, KnowledgeIndexData } from "@oratlas/knowledge";

export const EXPLORATION_INTERESTS = [
  {
    id: "disagreements",
    label: "Disagreements",
    detail: "Claims connected to contradicting evidence.",
  },
  {
    id: "reproducibility",
    label: "Reproducibility",
    detail: "Replication, robustness, and convergence questions.",
  },
  {
    id: "methods-models",
    label: "Methods & models",
    detail: "Protocols, models, populations, and study design.",
  },
  {
    id: "data-code",
    label: "Data & code",
    detail: "Datasets, software, analysis, and computational artifacts.",
  },
  {
    id: "assessed-evidence",
    label: "Assessed evidence",
    detail: "Claims with separate evidence assessments.",
  },
] as const;

export type ExplorationInterest = (typeof EXPLORATION_INTERESTS)[number]["id"];
export type LandscapeNodeKind = "review" | "claim" | "evidence";

export interface KnowledgeLandscapeNode {
  id: string;
  kind: LandscapeNodeKind;
  label: string;
  detail: string;
  href: string;
}

export interface KnowledgeLandscapeEdge {
  sourceId: string;
  targetId: string;
  label: string;
  relationType: string;
}

export interface KnowledgeLandscapeData {
  nodes: KnowledgeLandscapeNode[];
  edges: KnowledgeLandscapeEdge[];
  matchedClaimCount: number;
  shownClaimCount: number;
}

const INTEREST_IDS = new Set<string>(EXPLORATION_INTERESTS.map((interest) => interest.id));

export function normalizeExplorationInterests(values: string[]): ExplorationInterest[] {
  return [...new Set(values.filter((value) => INTEREST_IDS.has(value)))] as ExplorationInterest[];
}

export function buildKnowledgeLandscape(
  index: KnowledgeIndexData,
  candidateClaims: IndexedClaim[],
  interests: ExplorationInterest[],
): KnowledgeLandscapeData {
  const matchingClaims =
    interests.length === 0
      ? candidateClaims
      : candidateClaims.filter((claim) =>
          interests.some((interest) => matchesInterest(claim, interest)),
        );
  const selectedClaims = matchingClaims.slice(0, 6);
  const citationById = new Map(index.citations.map((citation) => [citation.citationId, citation]));
  const nodes: KnowledgeLandscapeNode[] = [];
  const edges: KnowledgeLandscapeEdge[] = [];
  const includedReviews = new Set<string>();
  const includedEvidence = new Map<string, KnowledgeLandscapeNode>();

  for (const claim of selectedClaims) {
    const reviewNodeId = `review:${claim.reviewVersionId}`;
    if (!includedReviews.has(reviewNodeId)) {
      includedReviews.add(reviewNodeId);
      nodes.push({
        id: reviewNodeId,
        kind: "review",
        label: claim.reviewTitle,
        detail: "Preserved review record",
        href: `/reviews/${claim.reviewSlug}`,
      });
    }

    const claimNodeId = `claim:${claim.claimId}`;
    const claimHref = `/claims/${claim.reviewVersionId}/${encodeURIComponent(claim.localClaimId)}`;
    nodes.push({
      id: claimNodeId,
      kind: "claim",
      label: claim.text,
      detail: claim.claimType ? `${claim.claimType} claim` : "Scientific claim",
      href: claimHref,
    });
    edges.push({
      sourceId: reviewNodeId,
      targetId: claimNodeId,
      label: "asserts",
      relationType: "asserts",
    });

    for (const relation of claim.relations) {
      const citation = citationById.get(relation.citationId);
      if (!citation) continue;
      const evidenceNodeId = `evidence:${citation.workId}`;
      if (!includedEvidence.has(evidenceNodeId) && includedEvidence.size < 10) {
        const node: KnowledgeLandscapeNode = {
          id: evidenceNodeId,
          kind: "evidence",
          label: citation.title ?? citation.doi ?? citation.localCitationId,
          detail: citation.year ? `Evidence published ${citation.year}` : "Linked evidence record",
          href: `${claimHref}#linked-evidence`,
        };
        includedEvidence.set(evidenceNodeId, node);
        nodes.push(node);
      }
      if (includedEvidence.has(evidenceNodeId)) {
        edges.push({
          sourceId: claimNodeId,
          targetId: evidenceNodeId,
          label: relation.relationType.replace(/-/g, " "),
          relationType: relation.relationType,
        });
      }
    }
  }

  return {
    nodes,
    edges,
    matchedClaimCount: matchingClaims.length,
    shownClaimCount: selectedClaims.length,
  };
}

function matchesInterest(claim: IndexedClaim, interest: ExplorationInterest): boolean {
  const searchable = `${claim.text} ${claim.reviewTitle} ${claim.claimType ?? ""}`.toLowerCase();
  const assessments = claim.relations.flatMap(
    (relation) => relation.trustAssessments ?? (relation.trust ? [relation.trust] : []),
  );

  switch (interest) {
    case "disagreements":
      return claim.relations.some((relation) => relation.relationType === "contradicts");
    case "reproducibility":
      return (
        /replicat|reproduc|robust|convergen/.test(searchable) ||
        assessments.some((assessment) =>
          assessment.notableCriteria.includes("replicationConvergence"),
        )
      );
    case "methods-models":
      return /method|model|protocol|population|cohort|design|intervention|exposure/.test(
        searchable,
      );
    case "data-code":
      return /data|dataset|code|software|comput|algorithm|analysis|pipeline/.test(searchable);
    case "assessed-evidence":
      return assessments.length > 0;
  }
}
