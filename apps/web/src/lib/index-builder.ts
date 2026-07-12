import "server-only";
import { computeAggregate, selectPreferredTrustAssessment, type TrustRecord } from "@oratlas/trust";
import {
  canonicalWorkAliases,
  claimDomAnchor,
  findWorkIdentifierConflicts,
  globalCitationId,
  globalClaimId,
  type AssessmentReviewStatus,
  type ClaimEvidenceRelationType,
} from "@oratlas/contracts";
import {
  type IndexedClaim,
  type IndexedCitation,
  type IndexedRelation,
  type IndexedReview,
  type KnowledgeIndexData,
} from "@oratlas/knowledge";
import { prisma, parseJsonColumn } from "./db";
import { resolveTrustAssessmentRows } from "./trust-provenance";

/**
 * Build the in-memory knowledge index from accepted/published reviews. Uses the
 * current (latest) ReviewVersion per published review. Rebuilt per request in
 * the POC; a production build would cache/invalidate.
 */
export async function buildKnowledgeIndex(): Promise<KnowledgeIndexData> {
  const reviews = await prisma.review.findMany({
    where: { status: "published" },
    include: {
      versions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          contributors: { include: { person: true }, orderBy: { position: "asc" } },
          snapshot: true,
          claims: {
            include: {
              evidenceRelations: {
                include: { citation: true, trustAssessments: { include: { verification: true } } },
              },
            },
          },
          citations: true,
        },
      },
    },
  });

  const indexedReviews: IndexedReview[] = [];
  const indexedClaims: IndexedClaim[] = [];
  const citationMap = new Map<string, IndexedCitation>();

  for (const review of reviews) {
    const version = review.versions[0];
    if (!version) continue;
    const meta = parseJsonColumn<{
      keywords?: string[];
      domains?: string[];
      compatibilityLevel?: string;
    }>(version.metadataJson, {});
    const authors = version.contributors.map((c) => c.person.displayName);

    const hasTrust = version.claims.some((c) =>
      c.evidenceRelations.some((r) => r.trustAssessments.length > 0),
    );
    const hasHumanTrust = version.claims.some((claim) =>
      claim.evidenceRelations.some((relation) =>
        relation.trustAssessments.some((assessment) => {
          const resolved = resolveTrustAssessmentRows(
            {
              assessment,
              relation,
              claim,
              citation: relation.citation,
            },
            assessment.verification,
          );
          return (
            resolved.effectiveStatus === "human-reviewed" ||
            resolved.effectiveStatus === "adjudicated"
          );
        }),
      ),
    );
    const hasEvidence = version.claims.length > 0 && version.citations.length > 0;

    indexedReviews.push({
      reviewSlug: review.slug,
      reviewId: review.id,
      reviewVersionId: version.id,
      title: version.title,
      abstract: version.abstract ?? undefined,
      keywords: meta.keywords ?? [],
      domains: meta.domains ?? [],
      reviewType: review.reviewType ?? undefined,
      authors,
      acceptedAt: review.acceptedAt?.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      publicationYear: version.publishedAt?.getFullYear(),
      commitSha: version.snapshot.commitSha,
      versionDoi: version.versionDoi ?? undefined,
      conceptDoi: version.conceptDoi ?? undefined,
      hasDoi: Boolean(version.versionDoi || version.conceptDoi),
      hasTrustData: hasTrust,
      hasEvidenceData: hasEvidence,
      hasHumanReviewedTrust: hasHumanTrust,
      compatibilityLevel: meta.compatibilityLevel,
      status: review.status,
    });

    for (const citation of version.citations) {
      const citationId = globalCitationId(version.id, citation.localCitationId);
      const aliases = canonicalWorkAliases({
        doi: citation.doi ?? undefined,
        pmid: citation.pmid ?? undefined,
        openAlexId: citation.openAlexId ?? undefined,
      });
      citationMap.set(citationId, {
        citationId,
        localCitationId: citation.localCitationId,
        reviewVersionId: version.id,
        workId: aliases[0] ?? citationId,
        canonicalWorkAliases: aliases,
        doi: citation.doi ?? undefined,
        pmid: citation.pmid ?? undefined,
        openAlexId: citation.openAlexId ?? undefined,
        title: citation.title ?? undefined,
        year: citation.year ?? undefined,
        source: citation.source ?? undefined,
      });
    }

    // Map citation DB id -> localCitationId for relation resolution.
    const citationGlobalById = new Map(
      version.citations.map((citation) => [
        citation.id,
        globalCitationId(version.id, citation.localCitationId),
      ]),
    );

    for (const claim of version.claims) {
      const relations: IndexedRelation[] = claim.evidenceRelations.map((rel) => {
        const trust = selectPreferredTrustAssessment(
          rel.trustAssessments.map((assessment) => {
            const resolved = resolveTrustAssessmentRows(
              { assessment, relation: rel, claim, citation: rel.citation },
              assessment.verification,
            );
            return {
              id: assessment.id,
              effectiveStatus: resolved.effectiveStatus,
              assessedAt: assessment.assessedAt?.toISOString() ?? null,
              value: { assessment, resolved },
            };
          }),
        )?.value;
        let indexedTrust;
        if (trust) {
          const record = toTrustRecord(trust.assessment);
          const agg = computeAggregate(record);
          indexedTrust = {
            reviewStatus: trust.resolved.effectiveStatus as AssessmentReviewStatus,
            verificationState: trust.resolved.state,
            aggregateScore: agg.score ?? undefined,
            aggregateMethod: agg.method,
            notableCriteria: agg.assessedCriteria,
          };
        }
        return {
          citationId:
            citationGlobalById.get(rel.citationId) ??
            globalCitationId(version.id, `missing:${rel.citationId}`),
          relationType: rel.relationType as ClaimEvidenceRelationType,
          trust: indexedTrust,
        };
      });

      indexedClaims.push({
        claimId: globalClaimId(version.id, claim.localClaimId),
        localClaimId: claim.localClaimId,
        reviewSlug: review.slug,
        reviewId: review.id,
        reviewVersionId: version.id,
        reviewTitle: version.title,
        text: claim.text,
        section: claim.section ?? undefined,
        anchor: claimDomAnchor(version.id, claim.localClaimId),
        sourceAnchor: claim.anchor ?? undefined,
        claimType: claim.claimType ?? undefined,
        versionDoi: version.versionDoi ?? undefined,
        commitSha: version.snapshot.commitSha,
        relations,
      });
    }
  }

  const citations = [...citationMap.values()];
  return {
    reviews: indexedReviews,
    claims: indexedClaims,
    citations,
    identifierConflicts: findWorkIdentifierConflicts(
      citations.map((citation) => ({
        citationId: citation.citationId,
        aliases: citation.canonicalWorkAliases,
      })),
    ),
  };
}

interface TrustRow {
  claimEvidenceRelationId: string;
  protocolVersion: string;
  assessorType: string;
  identityIntegrity: string | null;
  entailment: string | null;
  sourceAccess: string | null;
  populationRelevance: string | null;
  interventionExposureRelevance: string | null;
  outcomeRelevance: string | null;
  methodologicalSafeguards: string | null;
  statisticalSafeguards: string | null;
  replicationConvergence: string | null;
  conflictDependency: string | null;
  reviewStatus: string;
}

const CRITERIA_COLUMNS = [
  "identityIntegrity",
  "entailment",
  "sourceAccess",
  "populationRelevance",
  "interventionExposureRelevance",
  "outcomeRelevance",
  "methodologicalSafeguards",
  "statisticalSafeguards",
  "replicationConvergence",
  "conflictDependency",
] as const;

/** Reconstruct a TrustRecord from the per-criterion JSON columns. */
export function toTrustRecord(row: TrustRow): TrustRecord {
  const criteria: TrustRecord["criteria"] = {};
  for (const col of CRITERIA_COLUMNS) {
    const raw = row[col];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.rating === "string") {
        criteria[col] = {
          rating: parsed.rating,
          status: parsed.status ?? "assessed",
          rationale: parsed.rationale,
          evidencePointer: parsed.evidencePointer,
        };
      }
    } catch {
      // ignore malformed criterion JSON
    }
  }
  return {
    claimId: "",
    citationId: "",
    protocolVersion: row.protocolVersion,
    assessorType: row.assessorType as "agent" | "human",
    criteria,
    reviewStatus: row.reviewStatus as AssessmentReviewStatus,
  };
}
