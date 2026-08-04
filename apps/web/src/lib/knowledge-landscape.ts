import type { IndexedClaim, KnowledgeIndexData } from "@oratlas/knowledge";
import type {
  ExplorationInterest,
  KnowledgeLandscapeData,
  KnowledgeLandscapeEdge,
  KnowledgeLandscapeNode,
  KnowledgeLandscapeYear,
} from "@oratlas/contracts";

export type {
  ExplorationInterest,
  KnowledgeLandscapeData,
  KnowledgeLandscapeEdge,
  KnowledgeLandscapeNode,
  KnowledgeLandscapeYear,
  LandscapeNodeKind,
} from "@oratlas/contracts";

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
] as const satisfies ReadonlyArray<{
  id: ExplorationInterest;
  label: string;
  detail: string;
}>;

export interface KnowledgeLandscapeOptions {
  query?: string;
  focusNodeId?: string;
  graphInterestMatches?: ReadonlyMap<string, ReadonlySet<ExplorationInterest>>;
}

const INTEREST_IDS = new Set<string>(EXPLORATION_INTERESTS.map((interest) => interest.id));

export function normalizeExplorationInterests(values: string[]): ExplorationInterest[] {
  return [...new Set(values.filter((value) => INTEREST_IDS.has(value)))] as ExplorationInterest[];
}

export function buildKnowledgeLandscape(
  index: KnowledgeIndexData,
  candidateClaims: IndexedClaim[],
  interests: ExplorationInterest[],
  options: KnowledgeLandscapeOptions = {},
): KnowledgeLandscapeData {
  const matchingClaims =
    interests.length === 0
      ? candidateClaims
      : candidateClaims.filter((claim) =>
          interests.some((interest) => matchesInterest(claim, interest, options)),
        );
  const selectedClaims = matchingClaims
    .map((claim) => ({
      claim,
      reasons: explainClaimSelection(claim, interests, options),
    }))
    .sort(compareExplorationPriority)
    .slice(0, 6);
  const citationById = new Map(index.citations.map((citation) => [citation.citationId, citation]));
  const reviewByVersionId = new Map(
    index.reviews.map((review) => [review.reviewVersionId, review]),
  );
  const nodes: KnowledgeLandscapeNode[] = [];
  const edges: KnowledgeLandscapeEdge[] = [];
  const includedReviews = new Set<string>();
  const includedEvidence = new Map<string, KnowledgeLandscapeNode>();

  for (const selected of selectedClaims) {
    const { claim, reasons } = selected;
    const reviewNodeId = `review:${claim.reviewVersionId}`;
    if (!includedReviews.has(reviewNodeId)) {
      const review = reviewByVersionId.get(claim.reviewVersionId);
      includedReviews.add(reviewNodeId);
      nodes.push({
        id: reviewNodeId,
        kind: "review",
        label: claim.reviewTitle,
        detail: "Preserved review record",
        href: `/reviews/${claim.reviewSlug}`,
        reasons: ["Contains a claim in this landscape"],
        year: review?.publicationYear,
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
      reasons,
      year: reviewByVersionId.get(claim.reviewVersionId)?.publicationYear,
      graphNodeId: claim.knowledgeNodeId,
      graphHref: claim.knowledgeNodeId
        ? `/graph?seed=${encodeURIComponent(claim.knowledgeNodeId)}`
        : undefined,
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
          reasons: ["Linked as evidence for a claim in this landscape"],
          year: citation.year,
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

  const completeLandscape: KnowledgeLandscapeData = {
    nodes,
    edges,
    matchedClaimCount: matchingClaims.length,
    shownClaimCount: selectedClaims.length,
    graphSeedCount: 0,
    graphNodeCount: 0,
    timeline: buildTimeline(nodes),
  };
  return focusLandscape(completeLandscape, options.focusNodeId);
}

export function focusLandscape(
  landscape: KnowledgeLandscapeData,
  requestedNodeId?: string,
): KnowledgeLandscapeData {
  if (!requestedNodeId || !landscape.nodes.some((node) => node.id === requestedNodeId)) {
    return landscape;
  }

  const includedIds = new Set([requestedNodeId]);
  for (const edge of landscape.edges) {
    if (edge.sourceId === requestedNodeId) includedIds.add(edge.targetId);
    if (edge.targetId === requestedNodeId) includedIds.add(edge.sourceId);
  }
  const nodes = landscape.nodes.filter((node) => includedIds.has(node.id));
  const edges = landscape.edges.filter(
    (edge) => includedIds.has(edge.sourceId) && includedIds.has(edge.targetId),
  );
  return {
    ...landscape,
    nodes,
    edges,
    timeline: buildTimeline(nodes),
    focusedNodeId: requestedNodeId,
  };
}

function explainClaimSelection(
  claim: IndexedClaim,
  interests: ExplorationInterest[],
  options: KnowledgeLandscapeOptions,
): string[] {
  const reasons: string[] = [];
  if (options.query?.trim()) reasons.push(`Matches the search “${options.query.trim()}”`);
  for (const interest of interests) {
    if (!matchesInterest(claim, interest, options)) continue;
    const label = EXPLORATION_INTERESTS.find((item) => item.id === interest)?.label ?? interest;
    const graphMatch =
      claim.knowledgeNodeId &&
      options.graphInterestMatches?.get(claim.knowledgeNodeId)?.has(interest) &&
      !matchesInterestWithoutGraph(claim, interest);
    reasons.push(
      graphMatch
        ? `Its confirmed graph neighborhood matches your ${label.toLowerCase()} interest`
        : `Matches your ${label.toLowerCase()} interest`,
    );
  }
  const contradicting = claim.relations.filter(
    (relation) => relation.relationType === "contradicts",
  ).length;
  if (contradicting > 0) {
    reasons.push(`${contradicting} contradicting evidence link${contradicting === 1 ? "" : "s"}`);
  }
  const assessed = claim.relations.filter(
    (relation) =>
      (relation.trustAssessments ?? (relation.trust ? [relation.trust] : [])).length > 0,
  ).length;
  if (assessed > 0) {
    reasons.push(`${assessed} separately assessed evidence link${assessed === 1 ? "" : "s"}`);
  }
  if (claim.relations.length > 0) {
    reasons.push(
      `${claim.relations.length} linked evidence record${claim.relations.length === 1 ? "" : "s"}`,
    );
  }
  return reasons.length > 0 ? reasons : ["Included in the current filtered claim set"];
}

function compareExplorationPriority(
  left: { claim: IndexedClaim; reasons: string[] },
  right: { claim: IndexedClaim; reasons: string[] },
): number {
  return (
    right.reasons.length - left.reasons.length ||
    right.claim.relations.length - left.claim.relations.length ||
    left.claim.reviewTitle.localeCompare(right.claim.reviewTitle) ||
    left.claim.claimId.localeCompare(right.claim.claimId)
  );
}

function buildTimeline(nodes: KnowledgeLandscapeNode[]): KnowledgeLandscapeYear[] {
  const years = new Map<number, { reviewCount: number; evidenceCount: number }>();
  for (const node of nodes) {
    if (!node.year || node.kind === "claim") continue;
    const entry = years.get(node.year) ?? { reviewCount: 0, evidenceCount: 0 };
    if (node.kind === "review") entry.reviewCount += 1;
    if (node.kind === "evidence") entry.evidenceCount += 1;
    years.set(node.year, entry);
  }
  return [...years.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, counts]) => ({ year, ...counts }));
}

function matchesInterest(
  claim: IndexedClaim,
  interest: ExplorationInterest,
  options: KnowledgeLandscapeOptions,
): boolean {
  return (
    matchesInterestWithoutGraph(claim, interest) ||
    Boolean(
      claim.knowledgeNodeId &&
      options.graphInterestMatches?.get(claim.knowledgeNodeId)?.has(interest),
    )
  );
}

function matchesInterestWithoutGraph(claim: IndexedClaim, interest: ExplorationInterest): boolean {
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
