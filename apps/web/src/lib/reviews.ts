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
  isExactCommitSha,
  type PublicationConsistencyReport,
  type PublicLifecycleEvent,
  type WorkIdentityAssertion,
} from "@oratlas/contracts";
import { prisma, parseJsonColumn } from "./db";
import { toTrustRecord } from "./index-builder";
import { resolveTrustAssessmentRows } from "./trust-provenance";
import { isTombstonedState, lifecycleEventDto } from "./review-lifecycle";

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
  publicState: string;
  isTombstoned: boolean;
  lifecycleRevision: number;
  lifecycleEvents: PublicLifecycleEvent[];
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
    publicState: string;
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
      lifecycleEvents: {
        include: { actor: true },
        orderBy: { revision: "asc" },
      },
    },
  });
  if (!review || review.status !== "published") return null;
  const currentVersion = review.versions[0];
  const version = requestedVersionId
    ? review.versions.find((candidate) => candidate.id === requestedVersionId)
    : currentVersion;
  if (!version || !version.snapshot || !isExactCommitSha(version.snapshot.commitSha)) return null;

  const lifecycleEvents = review.lifecycleEvents
    .filter(
      (event) => event.reviewVersionId === version.id || event.supersedesVersionId === version.id,
    )
    .map(lifecycleEventDto);
  const versionIsTombstoned = isTombstonedState(version.publicState);
  if (versionIsTombstoned) {
    return {
      slug: review.slug,
      title: "Content unavailable",
      status: "tombstoned",
      publicState: version.publicState,
      isTombstoned: true,
      lifecycleRevision: review.lifecycleRevision,
      lifecycleEvents,
      updatedAt: lifecycleEvents.at(-1)?.createdAt ?? version.createdAt.toISOString(),
      keywords: [],
      domains: [],
      contributors: [],
      repository: { canonicalUrl: "", owner: "", name: "" },
      snapshot: { commitSha: version.snapshot.commitSha },
      version: {
        id: version.id,
        isExample: false,
        editorialOverrides: [],
      },
      identifiers: [],
      versions: review.versions.map((candidate) => ({
        id: candidate.id,
        isExample: false,
        isCurrent: candidate.id === currentVersion?.id,
        publicState: candidate.publicState,
      })),
      claims: [],
      citations: [],
      limitations: [],
      identifierConflicts: [],
    };
  }

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
    publicState: version.publicState,
    isTombstoned: false,
    lifecycleRevision: review.lifecycleRevision,
    lifecycleEvents,
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
    versions: review.versions.map((v) => {
      const withheld = isTombstonedState(v.publicState);
      return {
        id: v.id,
        semanticVersion: withheld ? undefined : (v.semanticVersion ?? undefined),
        versionDoi: withheld ? undefined : (v.versionDoi ?? undefined),
        releaseTag: withheld ? undefined : (v.releaseTag ?? undefined),
        publishedAt: withheld ? undefined : v.publishedAt?.toISOString(),
        isExample: withheld ? false : v.isExample,
        isCurrent: v.id === currentVersion?.id,
        publicState: v.publicState,
      };
    }),
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
    select: {
      slug: true,
      versions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { publicState: true, snapshot: { select: { commitSha: true } } },
      },
    },
  });
  return rows
    .filter(
      (row) =>
        row.versions[0] &&
        !isTombstonedState(row.versions[0].publicState) &&
        row.versions[0].snapshot &&
        isExactCommitSha(row.versions[0].snapshot.commitSha),
    )
    .map((row) => row.slug);
}
