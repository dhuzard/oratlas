import type { IndexedReview, KnowledgeIndexData } from "@oratlas/knowledge";

export interface ComparableClaim {
  localClaimId: string;
  text: string;
  claimType?: string;
  passportPath: string;
  evidenceRelationCount: number;
  contradictingRelationCount: number;
  trustAssessmentCount: number;
}

export interface ReviewComparisonColumn {
  review: IndexedReview;
  claimCount: number;
  citationCount: number;
  evidenceRelationCount: number;
  contradictingRelationCount: number;
  trustAssessmentCount: number;
  humanReviewedTrustCount: number;
  claimTypes: Array<{ type: string; count: number }>;
  claims: ComparableClaim[];
}

/** Build a neutral side-by-side projection. Counts describe coverage, never quality. */
export function buildReviewComparison(
  index: KnowledgeIndexData,
  requestedSlugs: readonly string[],
): ReviewComparisonColumn[] {
  const selectedSlugs = [...new Set(requestedSlugs.filter(Boolean))].slice(0, 3);

  return selectedSlugs.flatMap((slug) => {
    const review = index.reviews.find((candidate) => candidate.reviewSlug === slug);
    if (!review) return [];
    const claims = index.claims.filter((claim) => claim.reviewSlug === review.reviewSlug);
    const citations = index.citations.filter(
      (citation) => citation.reviewVersionId === review.reviewVersionId,
    );
    const relations = claims.flatMap((claim) => claim.relations);
    const assessments = relations.flatMap(
      (relation) => relation.trustAssessments ?? (relation.trust ? [relation.trust] : []),
    );
    const uniqueAssessments = [
      ...new Map(assessments.map((item) => [item.assessmentId, item])).values(),
    ];
    const claimTypeCounts = new Map<string, number>();
    for (const claim of claims) {
      const type = claim.claimType ?? "undeclared";
      claimTypeCounts.set(type, (claimTypeCounts.get(type) ?? 0) + 1);
    }

    return [
      {
        review,
        claimCount: claims.length,
        citationCount: citations.length,
        evidenceRelationCount: relations.length,
        contradictingRelationCount: relations.filter(
          (relation) => relation.relationType === "contradicts",
        ).length,
        trustAssessmentCount: uniqueAssessments.length,
        humanReviewedTrustCount: uniqueAssessments.filter(
          (assessment) =>
            assessment.reviewStatus === "human-reviewed" ||
            assessment.reviewStatus === "adjudicated",
        ).length,
        claimTypes: [...claimTypeCounts.entries()]
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
        claims: claims.map((claim) => {
          const claimAssessments = claim.relations.flatMap(
            (relation) => relation.trustAssessments ?? (relation.trust ? [relation.trust] : []),
          );
          return {
            localClaimId: claim.localClaimId,
            text: claim.text,
            claimType: claim.claimType,
            passportPath: `/claims/${claim.reviewVersionId}/${encodeURIComponent(claim.localClaimId)}`,
            evidenceRelationCount: claim.relations.length,
            contradictingRelationCount: claim.relations.filter(
              (relation) => relation.relationType === "contradicts",
            ).length,
            trustAssessmentCount: new Set(
              claimAssessments.map((assessment) => assessment.assessmentId),
            ).size,
          };
        }),
      },
    ];
  });
}

export function defaultComparisonSlugs(index: KnowledgeIndexData): string[] {
  const preferred = [
    "vip-cortical-interneurons-critical-review",
    "openscope-predictive-processing-data-release",
  ].filter((slug) => index.reviews.some((review) => review.reviewSlug === slug));
  if (preferred.length === 2) return preferred;
  return [...index.reviews]
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 2)
    .map((review) => review.reviewSlug);
}
