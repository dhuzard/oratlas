import "server-only";
import {
  computeAggregate,
  selectPreferredTrustAssessment,
  TRUST_CRITERIA,
  type TrustRecord,
  type TrustVerificationState,
} from "@oratlas/trust";
import { prisma, parseJsonColumn } from "./db";
import { toTrustRecord } from "./index-builder";
import { resolveTrustAssessmentRows } from "./trust-provenance";

export interface ReviewCriterion {
  criterion: string;
  rating: string;
  status: string;
  rationale?: string;
}

export interface ReviewTrust {
  assessorType: string;
  reviewStatus: string;
  verificationState: TrustVerificationState;
  protocolVersion: string;
  criteria: ReviewCriterion[];
  limitations: string[];
  aggregateScore?: number;
  aggregateMethod?: string;
  sourceAssertion: {
    reviewStatus?: string;
    assessorType?: string;
    assessorId?: string;
    assessedAt?: string;
    relationHumanReviewed?: boolean;
    aggregateScore: number | null;
    aggregateMethod?: string;
  };
  platformVerification?: {
    reviewerLogin: string;
    reviewerRoleSnapshot: string;
    rationale: string;
  };
}

export interface ReviewRelation {
  relationType: string;
  citationLocalId: string;
  citationTitle?: string;
  citationDoi?: string;
  citationIsExample: boolean;
  humanReviewed: boolean;
  trust?: ReviewTrust;
}

export interface ReviewClaim {
  localClaimId: string;
  text: string;
  section?: string;
  anchor?: string;
  claimType?: string;
  qualification?: string;
  relations: ReviewRelation[];
}

export interface ReviewDetail {
  slug: string;
  title: string;
  abstract?: string;
  reviewType?: string;
  licenseSpdx?: string;
  publishedReviewUrl?: string;
  status: string;
  acceptedAt?: string;
  updatedAt: string;
  keywords: string[];
  domains: string[];
  compatibilityLevel?: string;
  compatibilityReport?: unknown;
  contributors: Array<{
    displayName: string;
    orcid?: string;
    githubLogin?: string;
    roles: string[];
    isExampleOrcid: boolean;
  }>;
  repository: {
    canonicalUrl: string;
    owner: string;
    name: string;
    defaultBranch?: string;
    pagesUrl?: string;
  };
  snapshot: {
    commitSha: string;
    releaseTag?: string;
    releaseUrl?: string;
  };
  version: {
    semanticVersion?: string;
    versionDoi?: string;
    conceptDoi?: string;
    zenodoRecordId?: string;
    isExample: boolean;
  };
  identifiers: Array<{
    scheme: string;
    value: string;
    relationType: string;
    url?: string;
    validationStatus: string;
    isExample: boolean;
  }>;
  versions: Array<{
    id: string;
    semanticVersion?: string;
    versionDoi?: string;
    releaseTag?: string;
    publishedAt?: string;
    isExample: boolean;
  }>;
  claims: ReviewClaim[];
  citations: Array<{
    localCitationId: string;
    title?: string;
    doi?: string;
    year?: number;
    source?: string;
    isExample: boolean;
  }>;
  limitations: string[];
}

export async function getReviewDetail(slug: string): Promise<ReviewDetail | null> {
  const review = await prisma.review.findUnique({
    where: { slug },
    include: {
      currentSnapshot: { include: { repository: true } },
      versions: {
        orderBy: { createdAt: "desc" },
        include: {
          contributors: { include: { person: true }, orderBy: { position: "asc" } },
          identifiers: true,
          citations: true,
          claims: {
            include: {
              evidenceRelations: {
                include: {
                  citation: true,
                  trustAssessments: {
                    include: { verification: { include: { reviewer: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!review) return null;
  const version = review.versions[0];
  if (!version) return null;

  const snapshot = review.currentSnapshot;
  const repo = snapshot?.repository;
  const meta = parseJsonColumn<{
    keywords?: string[];
    domains?: string[];
    compatibilityLevel?: string;
  }>(version.metadataJson, {});
  const inspectionReport = snapshot
    ? parseJsonColumn<{ compatibilityReport?: unknown }>(snapshot.inspectionReportJson, {})
    : {};

  const limitations = new Set<string>();
  const claims: ReviewClaim[] = version.claims.map((claim) => ({
    localClaimId: claim.localClaimId,
    text: claim.text,
    section: claim.section ?? undefined,
    anchor: claim.anchor ?? undefined,
    claimType: claim.claimType ?? undefined,
    qualification: claim.qualification ?? undefined,
    relations: claim.evidenceRelations.map((rel) => {
      const trustRow = selectPreferredTrustAssessment(
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
      let trust: ReviewTrust | undefined;
      if (trustRow) {
        const record = toTrustRecord(trustRow.assessment);
        const agg = computeAggregate(record);
        const limitationList = parseJsonColumn<string[]>(trustRow.assessment.limitationsJson, []);
        for (const l of limitationList) limitations.add(l);
        trust = {
          assessorType: trustRow.assessment.assessorType,
          reviewStatus: trustRow.resolved.effectiveStatus,
          verificationState: trustRow.resolved.state,
          protocolVersion: trustRow.assessment.protocolVersion,
          criteria: criteriaList(record),
          limitations: limitationList,
          aggregateScore: agg.score ?? undefined,
          aggregateMethod: agg.method,
          sourceAssertion: {
            reviewStatus: trustRow.assessment.sourceReviewStatus ?? undefined,
            assessorType: trustRow.assessment.sourceAssessorType ?? undefined,
            assessorId: trustRow.assessment.sourceAssessorId ?? undefined,
            assessedAt: trustRow.assessment.sourceAssessedAt?.toISOString(),
            relationHumanReviewed: trustRow.assessment.sourceRelationHumanReviewed ?? undefined,
            aggregateScore: trustRow.assessment.sourceAggregateScore,
            aggregateMethod: trustRow.assessment.sourceAggregateMethod ?? undefined,
          },
          platformVerification: trustRow.assessment.verification
            ? {
                reviewerLogin: trustRow.assessment.verification.reviewer.githubLogin,
                reviewerRoleSnapshot: trustRow.assessment.verification.reviewerRoleSnapshot,
                rationale: trustRow.assessment.verification.rationale,
              }
            : undefined,
        };
      }
      return {
        relationType: rel.relationType,
        citationLocalId: rel.citation.localCitationId,
        citationTitle: rel.citation.title ?? undefined,
        citationDoi: rel.citation.doi ?? undefined,
        citationIsExample: isExampleCitation(rel.citation.rawCitationJson),
        // Legacy/source relation flags never become a platform assertion.
        humanReviewed: false,
        trust,
      };
    }),
  }));

  return {
    slug: review.slug,
    title: version.title,
    abstract: version.abstract ?? undefined,
    reviewType: review.reviewType ?? undefined,
    licenseSpdx: review.licenseSpdx ?? undefined,
    publishedReviewUrl: review.publishedReviewUrl ?? undefined,
    status: review.status,
    acceptedAt: review.acceptedAt?.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
    keywords: meta.keywords ?? [],
    domains: meta.domains ?? [],
    compatibilityLevel: meta.compatibilityLevel,
    compatibilityReport: inspectionReport.compatibilityReport,
    contributors: version.contributors.map((c) => ({
      displayName: c.person.displayName,
      orcid: c.person.orcid ?? undefined,
      githubLogin: c.person.githubLogin ?? undefined,
      roles: parseJsonColumn<string[]>(c.rolesJson, []),
      isExampleOrcid: version.isExample,
    })),
    repository: {
      canonicalUrl: repo?.canonicalUrl ?? "",
      owner: repo?.owner ?? "",
      name: repo?.name ?? "",
      defaultBranch: repo?.defaultBranch ?? undefined,
      pagesUrl: repo?.pagesUrl ?? undefined,
    },
    snapshot: {
      commitSha: snapshot?.commitSha ?? "",
      releaseTag: snapshot?.releaseTag ?? undefined,
      releaseUrl: snapshot?.releaseUrl ?? undefined,
    },
    version: {
      semanticVersion: version.semanticVersion ?? undefined,
      versionDoi: version.versionDoi ?? undefined,
      conceptDoi: version.conceptDoi ?? undefined,
      zenodoRecordId: version.zenodoRecordId ?? undefined,
      isExample: version.isExample,
    },
    identifiers: version.identifiers.map((id) => ({
      scheme: id.scheme,
      value: id.value,
      relationType: id.relationType,
      url: id.url ?? undefined,
      validationStatus: id.validationStatus,
      isExample: id.isExample,
    })),
    versions: review.versions.map((v) => ({
      id: v.id,
      semanticVersion: v.semanticVersion ?? undefined,
      versionDoi: v.versionDoi ?? undefined,
      releaseTag: v.releaseTag ?? undefined,
      publishedAt: v.publishedAt?.toISOString(),
      isExample: v.isExample,
    })),
    claims,
    citations: version.citations.map((c) => ({
      localCitationId: c.localCitationId,
      title: c.title ?? undefined,
      doi: c.doi ?? undefined,
      year: c.year ?? undefined,
      source: c.source ?? undefined,
      isExample: isExampleCitation(c.rawCitationJson),
    })),
    limitations: [...limitations],
  };
}

function criteriaList(record: TrustRecord): ReviewCriterion[] {
  const out: ReviewCriterion[] = [];
  for (const criterion of TRUST_CRITERIA) {
    const entry = record.criteria[criterion];
    if (!entry) continue;
    out.push({
      criterion,
      rating: entry.rating,
      status: entry.status ?? "assessed",
      rationale: entry.rationale,
    });
  }
  return out;
}

function isExampleCitation(rawJson: string | null): boolean {
  if (!rawJson) return false;
  try {
    return JSON.parse(rawJson)?.isExample === true;
  } catch {
    return false;
  }
}

export async function listPublishedSlugs(): Promise<string[]> {
  const rows = await prisma.review.findMany({
    where: { status: "published" },
    select: { slug: true },
  });
  return rows.map((r) => r.slug);
}
