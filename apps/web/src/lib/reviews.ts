import "server-only";
import {
  computeAggregate,
  selectPreferredTrustAssessment,
  TRUST_CRITERIA,
  type TrustRecord,
  type TrustVerificationState,
} from "@oratlas/trust";
import {
  canonicalWorkAliases,
  claimDomAnchor,
  findWorkIdentifierConflicts,
  globalCitationId,
  globalClaimId,
  type PublicationConsistencyReport,
  type WorkIdentityAssertion,
} from "@oratlas/contracts";
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
  claimId: string;
  localClaimId: string;
  text: string;
  section?: string;
  anchor: string;
  sourceAnchor?: string;
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
    treeSha?: string;
  };
  version: {
    id: string;
    sourceKind?: string;
    sourceBranch?: string;
    releaseTag?: string;
    releaseUrl?: string;
    tagObjectSha?: string;
    semanticVersion?: string;
    versionDoi?: string;
    conceptDoi?: string;
    zenodoRecordId?: string;
    isExample: boolean;
    capturePayloadHash?: string;
    publicationConsistency?: PublicationConsistencyReport;
    editorialOverrides: Array<{
      checkId: string;
      rationale: string;
      editorLogin: string;
      createdAt: string;
    }>;
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
    isCurrent: boolean;
  }>;
  claims: ReviewClaim[];
  citations: Array<{
    localCitationId: string;
    citationId: string;
    title?: string;
    doi?: string;
    pmid?: string;
    openAlexId?: string;
    workId: string;
    canonicalWorkAliases: string[];
    year?: number;
    source?: string;
    isExample: boolean;
  }>;
  limitations: string[];
  identifierConflicts: WorkIdentityAssertion[];
}

export async function getReviewDetail(
  slug: string,
  requestedVersionId?: string,
): Promise<ReviewDetail | null> {
  const review = await prisma.review.findUnique({
    where: { slug },
    include: {
      versions: {
        orderBy: { createdAt: "desc" },
        include: {
          contributors: { include: { person: true }, orderBy: { position: "asc" } },
          identifiers: true,
          snapshot: { include: { repository: true } },
          sourceSubmission: {
            include: {
              editorialOverrides: { include: { editor: true }, orderBy: { checkId: "asc" } },
            },
          },
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
  const currentVersion = review.versions[0];
  const version = requestedVersionId
    ? review.versions.find((candidate) => candidate.id === requestedVersionId)
    : currentVersion;
  if (!version) return null;

  const snapshot = version.snapshot;
  const repo = snapshot.repository;
  const meta = parseJsonColumn<{
    keywords?: string[];
    domains?: string[];
    compatibilityLevel?: string;
    compatibilityReport?: unknown;
    reviewType?: string;
    license?: string;
  }>(version.metadataJson, {});
  const legacyInspectionReport = snapshot
    ? parseJsonColumn<{ compatibilityReport?: unknown }>(snapshot.inspectionReportJson, {})
    : {};

  const limitations = new Set<string>();
  const claims: ReviewClaim[] = version.claims.map((claim) => ({
    claimId: globalClaimId(version.id, claim.localClaimId),
    localClaimId: claim.localClaimId,
    text: claim.text,
    section: claim.section ?? undefined,
    anchor: claimDomAnchor(version.id, claim.localClaimId),
    sourceAnchor: claim.anchor ?? undefined,
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

  const citationIdentities = version.citations.map((citation) => {
    const citationId = globalCitationId(version.id, citation.localCitationId);
    const aliases = canonicalWorkAliases({
      doi: citation.doi ?? undefined,
      pmid: citation.pmid ?? undefined,
      openAlexId: citation.openAlexId ?? undefined,
    });
    return { citationId, aliases, workId: aliases[0] ?? citationId };
  });
  const identityByLocalId = new Map(
    version.citations.map((citation, index) => [
      citation.localCitationId,
      citationIdentities[index]!,
    ]),
  );
  const publishedIdentifier = version.identifiers.find(
    (identifier) => identifier.relationType === "published-review",
  );

  return {
    slug: review.slug,
    title: version.title,
    abstract: version.abstract ?? undefined,
    reviewType: meta.reviewType ?? review.reviewType ?? undefined,
    licenseSpdx: meta.license ?? review.licenseSpdx ?? undefined,
    publishedReviewUrl:
      publishedIdentifier?.url ??
      publishedIdentifier?.value ??
      review.publishedReviewUrl ??
      undefined,
    status: review.status,
    acceptedAt: version.publishedAt?.toISOString() ?? review.acceptedAt?.toISOString(),
    updatedAt: requestedVersionId
      ? version.createdAt.toISOString()
      : review.updatedAt.toISOString(),
    keywords: meta.keywords ?? [],
    domains: meta.domains ?? [],
    compatibilityLevel: meta.compatibilityLevel,
    compatibilityReport: meta.compatibilityReport ?? legacyInspectionReport.compatibilityReport,
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
      treeSha: snapshot?.sourceTreeSha ?? undefined,
    },
    version: {
      id: version.id,
      sourceKind: version.sourceKind ?? snapshot?.sourceKind ?? undefined,
      sourceBranch: version.sourceBranch ?? snapshot?.branch ?? undefined,
      releaseTag: version.releaseTag ?? snapshot?.releaseTag ?? undefined,
      releaseUrl: version.releaseUrl ?? snapshot?.releaseUrl ?? undefined,
      tagObjectSha: version.tagObjectSha ?? undefined,
      semanticVersion: version.semanticVersion ?? undefined,
      versionDoi: version.versionDoi ?? undefined,
      conceptDoi: version.conceptDoi ?? undefined,
      zenodoRecordId: version.zenodoRecordId ?? undefined,
      isExample: version.isExample,
      capturePayloadHash: version.capturePayloadHash ?? undefined,
      publicationConsistency: parseJsonColumn<PublicationConsistencyReport | undefined>(
        version.publicationConsistencyJson,
        undefined,
      ),
      editorialOverrides:
        version.sourceSubmission?.editorialOverrides.map((override) => ({
          checkId: override.checkId,
          rationale: override.rationale,
          editorLogin: override.editor.githubLogin,
          createdAt: override.createdAt.toISOString(),
        })) ?? [],
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
      isCurrent: v.id === currentVersion?.id,
    })),
    claims,
    citations: version.citations.map((c) => ({
      localCitationId: c.localCitationId,
      citationId: identityByLocalId.get(c.localCitationId)!.citationId,
      title: c.title ?? undefined,
      doi: c.doi ?? undefined,
      pmid: c.pmid ?? undefined,
      openAlexId: c.openAlexId ?? undefined,
      workId: identityByLocalId.get(c.localCitationId)!.workId,
      canonicalWorkAliases: identityByLocalId.get(c.localCitationId)!.aliases,
      year: c.year ?? undefined,
      source: c.source ?? undefined,
      isExample: isExampleCitation(c.rawCitationJson),
    })),
    limitations: [...limitations],
    identifierConflicts: findWorkIdentifierConflicts(
      citationIdentities.map((identity) => ({
        citationId: identity.citationId,
        aliases: identity.aliases,
      })),
    ),
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
