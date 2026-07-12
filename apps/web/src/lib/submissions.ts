import "server-only";
import {
  resolveEffectiveMetadata,
  type EditedMetadata,
  type EffectiveMetadata,
  type ExtractedMetadata,
} from "@oratlas/contracts";
import { normalizeImportedTrustRecord } from "@oratlas/trust";
import {
  type ClaimRecord,
  type CitationRecord,
  type RelationRecord,
  type TrustRecord,
} from "@oratlas/contracts";
import { prisma, parseJsonColumn } from "./db";
import { buildValidationReport, contentHash, inspectAndExtract, normalizeRepoUrl } from "./ingest";
import { audit } from "./audit";

export interface SubmissionPayload {
  effectiveMetadata: EffectiveMetadata;
  compatibilityLevel: string;
  knowledge: {
    claims: ClaimRecord[];
    citations: CitationRecord[];
    relations: RelationRecord[];
    trust: TrustRecord[];
  };
}

export interface CreateSubmissionInput {
  url: string;
  submitterId: string;
  editedMetadata?: EditedMetadata;
}

export interface CreateSubmissionResult {
  submissionId: string;
  status: string;
}

/**
 * Finalize a submission (spec §8): inspect, extract, validate, then persist an
 * immutable RepositorySnapshot (repository + commit unique) and a Submission
 * snapshot. Status enters the editorial workflow; hard errors -> failed.
 */
export async function createSubmission(
  input: CreateSubmissionInput,
): Promise<CreateSubmissionResult> {
  const parsed = normalizeRepoUrl(input.url);
  if (!parsed.ok) {
    throw new SubmissionError(parsed.reason);
  }
  const outcome = await inspectAndExtract(parsed.ref.canonicalUrl);
  const { report, extraction } = outcome;

  const effective = resolveEffectiveMetadata(extraction.metadata, input.editedMetadata);
  const hasEvidence =
    extraction.knowledge.claims.length > 0 && extraction.knowledge.citations.length > 0;
  const hasTrust = extraction.knowledge.trust.length > 0;

  const validation = await buildValidationReport(
    report,
    extraction.compatibility,
    extraction.metadata,
    input.editedMetadata,
    hasEvidence,
    hasTrust,
  );

  const status =
    validation.hardErrors.length > 0 ? "automated-checks-failed" : "pending-editorial-review";

  // Upsert repository
  const repo = await prisma.repository.upsert({
    where: { canonicalUrl: parsed.ref.canonicalUrl },
    update: {
      description: report.description ?? undefined,
      licenseSpdx: report.licenseSpdx ?? undefined,
      defaultBranch: report.defaultBranch,
      topicsJson: JSON.stringify(report.topics),
      homepageUrl: report.homepageUrl ?? undefined,
      pagesUrl: report.pagesUrl ?? undefined,
      isArchived: report.isArchived ?? false,
      githubRepositoryId: report.githubRepositoryId,
      lastInspectedAt: new Date(),
    },
    create: {
      host: "github.com",
      owner: parsed.ref.owner,
      name: parsed.ref.name,
      canonicalUrl: parsed.ref.canonicalUrl,
      githubRepositoryId: report.githubRepositoryId,
      defaultBranch: report.defaultBranch,
      description: report.description ?? undefined,
      licenseSpdx: report.licenseSpdx ?? undefined,
      topicsJson: JSON.stringify(report.topics),
      homepageUrl: report.homepageUrl ?? undefined,
      pagesUrl: report.pagesUrl ?? undefined,
      isArchived: report.isArchived ?? false,
      lastInspectedAt: new Date(),
    },
  });

  const commitSha = report.latestCommitSha ?? "0".repeat(40);
  const activeRelease = report.releases.find((r) => !r.isDraft);

  // Immutable snapshot (repository + commit unique). Store the inspection report
  // and compatibility report; strip file contents to bound size.
  const inspectionForStorage = {
    ...report,
    files: Object.fromEntries(
      Object.entries(report.files).map(([k, v]) => [
        k,
        { path: v.path, size: v.size, truncated: v.truncated },
      ]),
    ),
    compatibilityReport: extraction.compatibility,
  };

  const snapshot = await prisma.repositorySnapshot.upsert({
    where: { repositoryId_commitSha: { repositoryId: repo.id, commitSha } },
    update: {
      inspectionStatus: report.status,
      inspectionReportJson: JSON.stringify(inspectionForStorage),
      manifestJson: extraction.manifest ? JSON.stringify(extraction.manifest) : null,
      releaseTag: activeRelease?.tagName,
      releaseUrl: activeRelease?.htmlUrl,
    },
    create: {
      repositoryId: repo.id,
      commitSha,
      branch: report.defaultBranch,
      releaseTag: activeRelease?.tagName,
      releaseUrl: activeRelease?.htmlUrl,
      sourceCreatedAt: report.latestCommitDate ? new Date(report.latestCommitDate) : undefined,
      inspectionStatus: report.status,
      inspectionReportJson: JSON.stringify(inspectionForStorage),
      manifestJson: extraction.manifest ? JSON.stringify(extraction.manifest) : null,
      contentHash: contentHash({ url: parsed.ref.canonicalUrl, commitSha }),
    },
  });

  const payload: SubmissionPayload = {
    effectiveMetadata: effective,
    compatibilityLevel: extraction.compatibility.overallCompatibility,
    knowledge: extraction.knowledge,
  };

  const submission = await prisma.submission.create({
    data: {
      submitterId: input.submitterId,
      repositoryId: repo.id,
      snapshotId: snapshot.id,
      status,
      extractedMetadataJson: JSON.stringify(extraction.metadata),
      editedMetadataJson: JSON.stringify(input.editedMetadata ?? { edits: {} }),
      validationReportJson: JSON.stringify(validation),
      submittedPayloadJson: JSON.stringify(payload),
      submittedAt: new Date(),
    },
  });

  await audit(input.submitterId, "submission.finalized", "submission", submission.id, {
    status,
    repository: parsed.ref.canonicalUrl,
    commitSha,
  });

  return { submissionId: submission.id, status };
}

export class SubmissionError extends Error {}

/**
 * Accept a submission (spec §8): materialize (or update) a public Review with an
 * immutable ReviewVersion, contributors, identifiers, claims, citations,
 * relations and TRUST records from the stored submission payload. Previous
 * versions are never destroyed.
 */
export async function acceptSubmission(
  submissionId: string,
  reviewerId: string,
  note?: string,
): Promise<{ reviewSlug: string }> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { repository: true, snapshot: true },
  });
  if (!submission) throw new SubmissionError("Submission not found.");
  if (!submission.snapshotId || !submission.snapshot) {
    throw new SubmissionError("Submission has no snapshot to publish.");
  }
  const payload = parseJsonColumn<SubmissionPayload | null>(submission.submittedPayloadJson, null);
  if (!payload) throw new SubmissionError("Submission payload missing.");

  const meta = payload.effectiveMetadata;
  const extracted = parseJsonColumn<ExtractedMetadata | null>(
    submission.extractedMetadataJson,
    null,
  );
  const slug = await uniqueSlug(
    meta.title ?? submission.repository.name,
    submission.repository.owner,
  );

  // Find or create the Review (keyed by repository, so re-acceptance versions it).
  let review = await prisma.review.findFirst({
    where: { versions: { some: { snapshot: { repositoryId: submission.repositoryId } } } },
  });

  const anyExample = detectExample(meta);

  const reviewData = {
    title: meta.title ?? submission.repository.name,
    abstract: meta.abstract,
    reviewType: meta.reviewType,
    licenseSpdx: meta.license,
    publishedReviewUrl: meta.publishedReviewUrl,
    status: "published",
    currentSnapshotId: submission.snapshotId,
    acceptedAt: new Date(),
  };

  if (!review) {
    review = await prisma.review.create({ data: { slug, ...reviewData } });
  } else {
    review = await prisma.review.update({ where: { id: review.id }, data: reviewData });
  }

  const metadataJson = JSON.stringify({
    keywords: meta.keywords,
    domains: meta.domains,
    reviewType: meta.reviewType,
    license: meta.license,
    compatibilityLevel: payload.compatibilityLevel,
    extractorVersion: extracted?.extractorVersion,
    provenance: extracted?.fields,
  });

  const version = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: submission.snapshotId,
      semanticVersion: meta.releaseTag?.replace(/^v/i, "") ?? undefined,
      title: reviewData.title,
      abstract: meta.abstract,
      metadataJson,
      versionDoi: meta.versionDoi,
      conceptDoi: meta.conceptDoi,
      zenodoRecordId: meta.zenodoRecordId,
      releaseTag: meta.releaseTag,
      isExample: anyExample,
      publishedAt: new Date(),
    },
  });

  // Contributors
  for (let i = 0; i < meta.authors.length; i++) {
    const a = meta.authors[i]!;
    const person = await prisma.person.create({
      data: {
        displayName: a.displayName,
        givenName: a.givenName,
        familyName: a.familyName,
        orcid: a.orcid,
        githubLogin: a.githubLogin,
      },
    });
    await prisma.reviewContributor.create({
      data: {
        reviewVersionId: version.id,
        personId: person.id,
        rolesJson: JSON.stringify(a.roles),
        position: i,
      },
    });
  }

  // Identifiers
  await createIdentifiers(version.id, meta, submission.repository.canonicalUrl, anyExample);

  // Claims / citations / relations / trust
  await materializeKnowledge(version.id, payload);

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: "accepted",
      reviewerId,
      reviewedAt: new Date(),
      editorialNote: note,
      resultingReviewId: review.id,
    },
  });

  await audit(reviewerId, "submission.accepted", "submission", submission.id, {
    reviewSlug: review.slug,
  });
  await audit(reviewerId, "review.published", "review", review.id, { versionId: version.id });

  return { reviewSlug: review.slug };
}

export async function decideSubmission(
  submissionId: string,
  reviewerId: string,
  decision: "reject" | "request-changes",
  note?: string,
): Promise<void> {
  const status = decision === "reject" ? "rejected" : "changes-requested";
  const submission = await prisma.submission.update({
    where: { id: submissionId },
    data: { status, reviewerId, reviewedAt: new Date(), editorialNote: note },
  });
  await audit(reviewerId, `submission.${decision}`, "submission", submission.id, { note });
}

async function createIdentifiers(
  reviewVersionId: string,
  meta: EffectiveMetadata,
  repoUrl: string,
  isExample: boolean,
): Promise<void> {
  const rows: Array<{
    scheme: string;
    value: string;
    relationType: string;
    url?: string;
    validationStatus: string;
    example: boolean;
  }> = [
    {
      scheme: "github",
      value: repoUrl,
      relationType: "repository",
      url: repoUrl,
      validationStatus: "valid",
      example: false,
    },
  ];
  if (meta.publishedReviewUrl) {
    rows.push({
      scheme: "url",
      value: meta.publishedReviewUrl,
      relationType: "published-review",
      url: meta.publishedReviewUrl,
      validationStatus: "unvalidated",
      example: false,
    });
  }
  if (meta.versionDoi) {
    rows.push({
      scheme: "doi",
      value: meta.versionDoi,
      relationType: "version-doi",
      validationStatus: isExample ? "example-not-resolvable" : "unvalidated",
      example: isExample,
    });
  }
  if (meta.conceptDoi) {
    rows.push({
      scheme: "doi",
      value: meta.conceptDoi,
      relationType: "concept-doi",
      validationStatus: isExample ? "example-not-resolvable" : "unvalidated",
      example: isExample,
    });
  }
  if (meta.zenodoRecordId) {
    rows.push({
      scheme: "zenodo-record",
      value: meta.zenodoRecordId,
      relationType: "zenodo-record",
      validationStatus: isExample ? "example-not-resolvable" : "unvalidated",
      example: isExample,
    });
  }
  for (const a of meta.authors) {
    if (a.orcid) {
      rows.push({
        scheme: "orcid",
        value: a.orcid,
        relationType: "author-orcid",
        url: `https://orcid.org/${a.orcid}`,
        validationStatus: "unvalidated",
        example: isExample,
      });
    }
  }
  for (const r of rows) {
    await prisma.identifier.create({
      data: {
        reviewVersionId,
        scheme: r.scheme,
        value: r.value,
        normalizedValue: r.value.toLowerCase(),
        url: r.url,
        relationType: r.relationType,
        validationStatus: r.validationStatus,
        isExample: r.example,
      },
    });
  }
}

async function materializeKnowledge(
  reviewVersionId: string,
  payload: SubmissionPayload,
): Promise<void> {
  const claimIdByLocal = new Map<string, string>();
  for (const claim of payload.knowledge.claims) {
    const row = await prisma.claim.create({
      data: {
        reviewVersionId,
        localClaimId: claim.id,
        text: claim.text,
        normalizedText: claim.text.toLowerCase(),
        section: claim.section,
        anchor: claim.anchor,
        claimType: claim.claimType,
        qualification: claim.qualification,
      },
    });
    claimIdByLocal.set(claim.id, row.id);
  }

  const citationIdByLocal = new Map<string, string>();
  for (const citation of payload.knowledge.citations) {
    const row = await prisma.citation.create({
      data: {
        reviewVersionId,
        localCitationId: citation.id,
        doi: citation.doi,
        pmid: citation.pmid,
        openAlexId: citation.openAlexId,
        title: citation.title,
        authorsJson: JSON.stringify(citation.authors ?? []),
        year: citation.year,
        source: citation.source,
        url: citation.url,
        rawCitationJson: JSON.stringify(citation),
      },
    });
    citationIdByLocal.set(citation.id, row.id);
  }

  const relationIdByPair = new Map<string, string>();
  const relationSourceReviewByPair = new Map<string, boolean | null>();
  for (const rel of payload.knowledge.relations) {
    const claimId = claimIdByLocal.get(rel.claimId);
    const citationId = citationIdByLocal.get(rel.citationId);
    if (!claimId || !citationId) continue;
    const row = await prisma.claimEvidenceRelation.create({
      data: {
        claimId,
        citationId,
        relationType: rel.relationType,
        supportDirection: rel.supportDirection,
        sourceLocation: rel.sourceLocation,
        extractionMethod: rel.extractionMethod ?? "extracted",
        extractionConfidence: rel.extractionConfidence,
        // A repository may assert human review, but only an Atlas-owned
        // verification marker can make that a public platform claim.
        humanReviewed: false,
      },
    });
    const pair = `${rel.claimId}|${rel.citationId}`;
    relationIdByPair.set(pair, row.id);
    relationSourceReviewByPair.set(pair, rel.humanReviewed ?? null);
  }

  for (const trust of payload.knowledge.trust) {
    const relationId = relationIdByPair.get(`${trust.claimId}|${trust.citationId}`);
    if (!relationId) continue;
    const sourceRelationHumanReviewed =
      relationSourceReviewByPair.get(`${trust.claimId}|${trust.citationId}`) ?? null;
    const imported = normalizeImportedTrustRecord(trust, sourceRelationHumanReviewed);
    await prisma.trustAssessment.create({
      data: {
        claimEvidenceRelationId: relationId,
        protocolVersion: imported.record.protocolVersion,
        assessorType: imported.record.assessorType,
        assessorId: imported.record.assessorId,
        assessedAt: imported.record.assessedAt ? new Date(imported.record.assessedAt) : null,
        ...imported.criterionColumns,
        limitationsJson: imported.limitationsJson,
        evidenceJson: imported.evidenceJson,
        aggregateScore: imported.aggregateScore,
        aggregateMethod: imported.aggregateMethod,
        reviewStatus: imported.reviewStatus,
        sourceRecordJson: imported.sourceRecordJson,
        sourceReviewStatus: imported.sourceReviewStatus,
        sourceAssessorType: imported.sourceAssessorType,
        sourceAssessorId: imported.sourceAssessorId,
        sourceAssessedAt: imported.sourceAssessedAt ? new Date(imported.sourceAssessedAt) : null,
        sourceEvidenceJson: imported.sourceEvidenceJson,
        sourceAggregateScore: imported.sourceAggregateScore,
        sourceAggregateMethod: imported.sourceAggregateMethod,
        sourceRelationHumanReviewed: imported.sourceRelationHumanReviewed,
      },
    });
  }
}

function detectExample(meta: EffectiveMetadata): boolean {
  const doi = `${meta.versionDoi ?? ""} ${meta.conceptDoi ?? ""}`;
  return /10\.5555\//i.test(doi);
}

async function uniqueSlug(title: string, owner: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || owner.toLowerCase();
  let slug = base;
  let n = 1;
  while (await prisma.review.findUnique({ where: { slug } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}
