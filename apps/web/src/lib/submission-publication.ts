import "server-only";
import {
  canonicalJson,
  type EffectiveMetadata,
  type ExtractedMetadata,
  type NodeRelationTrustRecord,
  type PublicationConsistencyReport,
} from "@oratlas/contracts";
import { assertKnowledgeNodeMaterializationBinding, type Prisma } from "@oratlas/db";
import { isExampleDoi } from "@oratlas/zenodo";
import { parseJsonColumn } from "./db";
import { ingestNodeRelationTrustAssessment, ingestTrustAssessment } from "./assessment-ingestion";
import { materializeCanonicalReviewGraph } from "./canonical-graph-materialization";
import type { SubmissionPayload, validNodeCandidates } from "./submission-payload";
import type { SubmissionForAcceptance } from "./submission-contract";
import { SubmissionError } from "./submission-contract";
import { claimSubmissionIdempotency } from "./submission-transaction";

export async function materializeReviewPublication(
  tx: Prisma.TransactionClient,
  submission: SubmissionForAcceptance,
  payload: SubmissionPayload,
  consistency: PublicationConsistencyReport | undefined,
): Promise<{ reviewId: string; versionId: string; slug: string }> {
  if (!submission.snapshotId || !submission.snapshot) {
    throw new SubmissionError("Submission has no snapshot to publish.");
  }
  const meta = payload.effectiveMetadata;
  const extracted = parseJsonColumn<ExtractedMetadata | null>(
    submission.extractedMetadataJson,
    null,
  );
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
  let review = await tx.review.findUnique({ where: { repositoryId: submission.repositoryId } });
  if (!review) {
    const legacyReview = await tx.review.findFirst({
      where: {
        repositoryId: null,
        versions: { some: { snapshot: { repositoryId: submission.repositoryId } } },
      },
    });
    if (legacyReview) {
      review = await tx.review.update({
        where: { id: legacyReview.id },
        data: { repositoryId: submission.repositoryId },
      });
    }
  }
  if (!review) {
    const slug = await uniqueSlug(tx, reviewData.title, submission.repository.owner);
    review = await tx.review.upsert({
      where: { repositoryId: submission.repositoryId },
      update: reviewData,
      create: { slug, repositoryId: submission.repositoryId, ...reviewData },
    });
  } else {
    review = await tx.review.update({ where: { id: review.id }, data: reviewData });
  }

  const version = await tx.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: submission.snapshotId,
      sourceSubmissionId: submission.id,
      inspectionCaptureId: submission.inspectionCaptureId,
      sourceKind: submission.sourceKind,
      sourceBranch: submission.sourceBranch,
      sourceSelectionKey: submission.sourceSelectionKey,
      tagObjectSha: submission.tagObjectSha,
      sourceCreatedAt: submission.sourceCreatedAt,
      semanticVersion: meta.releaseTag?.replace(/^v/i, "") ?? undefined,
      title: reviewData.title,
      abstract: meta.abstract,
      metadataJson: canonicalJson({
        keywords: meta.keywords,
        domains: meta.domains,
        reviewType: meta.reviewType,
        license: meta.license,
        compatibilityLevel: payload.compatibilityLevel,
        compatibilityReport: payload.compatibilityReport,
        extractorVersion: extracted?.extractorVersion,
        provenance: extracted?.fields,
        sourceAssessmentDocuments: payload.sourceAssessmentDocuments,
      }),
      versionDoi: meta.versionDoi,
      conceptDoi: meta.conceptDoi,
      zenodoRecordId: meta.zenodoRecordId,
      releaseTag: submission.releaseTag,
      releaseUrl: submission.releaseUrl,
      publicationConsistencyJson: consistency ? canonicalJson(consistency) : null,
      capturePayloadHash: payload.capturePayloadHash,
      isExample: anyExample,
      publishedAt: new Date(),
    },
  });
  await materializeContributors(tx, version.id, meta);
  await createIdentifiers(
    tx,
    version.id,
    meta,
    submission.repository.canonicalUrl,
    submission.snapshot.commitSha,
    submission.releaseUrl,
    anyExample,
  );
  await materializeKnowledge(tx, version.id, payload);
  await materializeCanonicalReviewGraph(tx, version.id);
  return { reviewId: review.id, versionId: version.id, slug: review.slug };
}

export async function materializeKnowledgeNodes(
  tx: Prisma.TransactionClient,
  submission: SubmissionForAcceptance,
  candidates: ReturnType<typeof validNodeCandidates>,
  reviewerId: string,
  reviewVersionId?: string,
): Promise<string[]> {
  if (candidates.length === 0) return [];
  if (!submission.snapshotId || !submission.snapshot || !submission.inspectionCapture) {
    throw new SubmissionError("Node publication requires a snapshot and inspection capture.");
  }
  const versionIds: string[] = [];
  for (const candidate of candidates) {
    const node = candidate.node;
    let identity = await tx.knowledgeNode.findUnique({
      where: {
        repositoryId_localNodeId: {
          repositoryId: submission.repositoryId,
          localNodeId: node.id,
        },
      },
    });
    if (identity && identity.kind !== node.kind) {
      throw new SubmissionError(
        `Node '${node.id}' changed kind from ${identity.kind} to ${node.kind}.`,
        "conflict",
      );
    }
    identity ??= await tx.knowledgeNode.create({
      data: {
        repositoryId: submission.repositoryId,
        localNodeId: node.id,
        kind: node.kind,
      },
    });
    if (!identity.repositoryId) {
      throw new SubmissionError("Repository-backed node identity lost its repository binding.");
    }
    try {
      assertKnowledgeNodeMaterializationBinding({
        repository: submission.repository,
        node: identity,
        snapshot: submission.snapshot,
        submission,
        capture: submission.inspectionCapture,
        version: {
          sourceSubmissionId: submission.id,
          inspectionCaptureId: submission.inspectionCaptureId,
          capturePayloadHash: submission.inspectionCapture.payloadHash,
        },
      });
    } catch (error) {
      throw new SubmissionError(
        error instanceof Error ? error.message : "Knowledge-node provenance binding failed.",
        "conflict",
      );
    }
    const version = await tx.knowledgeNodeVersion.create({
      data: {
        knowledgeNodeId: identity.id,
        snapshotId: submission.snapshotId,
        sourceSubmissionId: submission.id,
        inspectionCaptureId: submission.inspectionCaptureId,
        capturePayloadHash: submission.inspectionCapture.payloadHash,
        title: node.title,
        abstract: node.abstract,
        text: node.text,
        contributorsJson: canonicalJson(node.contributors),
        license: node.license,
        provenanceJson: canonicalJson({
          declared: node.provenance,
          extractedFields: candidate.fieldProvenance,
          sourcePath: candidate.sourcePath,
          sourcePointer: candidate.sourcePointer,
        }),
        payloadJson: canonicalJson(node.payload),
        versionDoi: node.versionDoi,
        conceptDoi: node.conceptDoi,
        isExample: nodeContainsExampleDoi(node),
      },
    });
    if (reviewVersionId && node.kind === "claim") {
      await tx.claim.updateMany({
        where: { reviewVersionId, localClaimId: node.id },
        data: { knowledgeNodeId: identity.id },
      });
    }
    await claimSubmissionIdempotency(tx, `knowledge-node.published:${submission.id}:${node.id}`);
    await tx.auditEvent.create({
      data: {
        actorId: reviewerId,
        action: "knowledge-node.published",
        subjectType: "knowledge-node",
        subjectId: identity.id,
        idempotencyKey: `knowledge-node.published:${submission.id}:${node.id}`,
        detailsJson: canonicalJson({
          versionId: version.id,
          localNodeId: node.id,
          kind: node.kind,
          snapshotId: submission.snapshotId,
          capturePayloadHash: submission.inspectionCapture.payloadHash,
        }),
      },
    });
    versionIds.push(version.id);
  }
  return versionIds;
}

async function materializeContributors(
  tx: Prisma.TransactionClient,
  reviewVersionId: string,
  meta: EffectiveMetadata,
): Promise<void> {
  for (let i = 0; i < meta.authors.length; i++) {
    const author = meta.authors[i]!;
    const person = await tx.person.create({
      data: {
        displayName: author.displayName,
        givenName: author.givenName,
        familyName: author.familyName,
        orcid: author.orcid,
        githubLogin: author.githubLogin,
      },
    });
    await tx.reviewContributor.create({
      data: {
        reviewVersionId,
        personId: person.id,
        rolesJson: canonicalJson(author.roles),
        position: i,
      },
    });
  }
}

async function createIdentifiers(
  tx: Prisma.TransactionClient,
  reviewVersionId: string,
  meta: EffectiveMetadata,
  repoUrl: string,
  commitSha: string,
  releaseUrl: string | null,
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
    {
      scheme: "git",
      value: commitSha,
      relationType: "source-commit",
      url: `${repoUrl}/commit/${commitSha}`,
      validationStatus: "valid",
      example: false,
    },
  ];
  if (releaseUrl && meta.releaseTag) {
    rows.push({
      scheme: "url",
      value: meta.releaseTag,
      relationType: "release",
      url: releaseUrl,
      validationStatus: "valid",
      example: false,
    });
  }
  if (meta.publishedReviewUrl)
    rows.push({
      scheme: "url",
      value: meta.publishedReviewUrl,
      relationType: "published-review",
      url: meta.publishedReviewUrl,
      validationStatus: "unvalidated",
      example: false,
    });
  if (meta.versionDoi)
    rows.push({
      scheme: "doi",
      value: meta.versionDoi,
      relationType: "version-doi",
      validationStatus: isExample ? "example-not-resolvable" : "unvalidated",
      example: isExample,
    });
  if (meta.conceptDoi)
    rows.push({
      scheme: "doi",
      value: meta.conceptDoi,
      relationType: "concept-doi",
      validationStatus: isExample ? "example-not-resolvable" : "unvalidated",
      example: isExample,
    });
  if (meta.zenodoRecordId)
    rows.push({
      scheme: "zenodo-record",
      value: meta.zenodoRecordId,
      relationType: "zenodo-record",
      validationStatus: isExample ? "example-not-resolvable" : "unvalidated",
      example: isExample,
    });
  for (const author of meta.authors) {
    if (author.orcid)
      rows.push({
        scheme: "orcid",
        value: author.orcid,
        relationType: "author-orcid",
        url: `https://orcid.org/${author.orcid}`,
        validationStatus: "unvalidated",
        example: isExample,
      });
  }
  for (const row of rows) {
    await tx.identifier.create({
      data: {
        reviewVersionId,
        scheme: row.scheme,
        value: row.value,
        normalizedValue: row.value.toLowerCase(),
        url: row.url,
        relationType: row.relationType,
        validationStatus: row.validationStatus,
        isExample: row.example,
      },
    });
  }
}

async function materializeKnowledge(
  tx: Prisma.TransactionClient,
  reviewVersionId: string,
  payload: SubmissionPayload,
): Promise<void> {
  const claimIdByLocal = new Map<string, string>();
  for (const claim of payload.knowledge.claims) {
    const row = await tx.claim.create({
      data: {
        reviewVersionId,
        localClaimId: claim.id,
        text: claim.text,
        normalizedText: claim.text.toLowerCase(),
        section: claim.section,
        anchor: claim.anchor,
        claimType: claim.claimType,
        qualification: claim.qualification,
        scopeJson: claim.scope ? canonicalJson(claim.scope) : null,
      },
    });
    claimIdByLocal.set(claim.id, row.id);
  }
  const citationIdByLocal = new Map<string, string>();
  for (const citation of payload.knowledge.citations) {
    const row = await tx.citation.create({
      data: {
        reviewVersionId,
        localCitationId: citation.id,
        doi: citation.doi,
        pmid: citation.pmid,
        openAlexId: citation.openAlexId,
        title: citation.title,
        authorsJson: canonicalJson(citation.authors ?? []),
        year: citation.year,
        source: citation.source,
        url: citation.url,
        datasetIdsJson: canonicalJson(citation.datasetIds ?? []),
        derivedFromJson: canonicalJson(citation.derivedFromDois ?? []),
        rawCitationJson: canonicalJson(citation),
      },
    });
    citationIdByLocal.set(citation.id, row.id);
  }
  const relationIdByPair = new Map<string, string>();
  const sourceReviewByPair = new Map<string, boolean | null>();
  for (const relation of payload.knowledge.relations) {
    const claimId = claimIdByLocal.get(relation.claimId);
    const citationId = citationIdByLocal.get(relation.citationId);
    if (!claimId || !citationId) continue;
    const row = await tx.claimEvidenceRelation.create({
      data: {
        claimId,
        citationId,
        relationType: relation.relationType,
        supportDirection: relation.supportDirection,
        sourceLocation: relation.sourceLocation,
        extractionMethod: relation.extractionMethod ?? "extracted",
        extractionConfidence: relation.extractionConfidence,
        humanReviewed: false,
      },
    });
    const pair = `${relation.claimId}|${relation.citationId}`;
    relationIdByPair.set(pair, row.id);
    sourceReviewByPair.set(pair, relation.humanReviewed ?? null);
  }
  for (const trust of payload.knowledge.trust) {
    if ("subjectType" in trust) continue;
    const pair = `${trust.claimId}|${trust.citationId}`;
    const relationId = relationIdByPair.get(pair);
    if (!relationId) continue;
    await ingestTrustAssessment(tx, relationId, trust, sourceReviewByPair.get(pair) ?? null);
  }
}

export async function materializeNodeRelationTrustAssessments(
  tx: Prisma.TransactionClient,
  records: NodeRelationTrustRecord[],
  proposalIds: string[],
  expected: {
    submissionId: string;
    inspectionCaptureId: string;
    sourceRepositoryGithubId: string | null;
    sourceCommitSha: string;
  },
): Promise<string[]> {
  if (records.length === 0) return [];
  if (!expected.sourceRepositoryGithubId) {
    throw new SubmissionError(
      "Node-relation TRUST requires an immutable source repository identity.",
      "conflict",
    );
  }
  const proposals = await tx.nodeEdgeProposal.findMany({
    where: { id: { in: proposalIds } },
    include: {
      sourceNodeVersion: {
        include: { knowledgeNode: { include: { repository: true } }, snapshot: true },
      },
      targetNodeVersion: {
        include: { knowledgeNode: { include: { repository: true } }, snapshot: true },
      },
    },
  });
  const created: string[] = [];
  for (const record of records) {
    const matches = proposals.filter((proposal) => {
      const subject = record.subject;
      const source = proposal.sourceNodeVersion;
      const target = proposal.targetNodeVersion;
      const exactLocal =
        source.knowledgeNode.localNodeId === subject.claimNodeId &&
        source.knowledgeNode.kind === "claim" &&
        target.knowledgeNode.localNodeId === subject.evidenceNodeId &&
        target.knowledgeNode.kind === subject.evidenceKind &&
        proposal.relationType === subject.relationType;
      const exactOrigin =
        proposal.origin === "asserted-by-author" &&
        proposal.sourceSubmissionId === expected.submissionId &&
        proposal.inspectionCaptureId === expected.inspectionCaptureId &&
        source.knowledgeNode.repository?.githubRepositoryId === expected.sourceRepositoryGithubId &&
        source.snapshot?.commitSha === expected.sourceCommitSha;
      const exactTarget = subject.evidenceRepository
        ? target.knowledgeNode.repository?.githubRepositoryId ===
            subject.evidenceRepository.githubRepositoryId &&
          target.snapshot?.commitSha === subject.evidenceRepository.commitSha
        : target.knowledgeNode.repositoryId === source.knowledgeNode.repositoryId &&
          target.snapshot?.commitSha === expected.sourceCommitSha;
      return exactLocal && exactOrigin && exactTarget;
    });
    if (matches.length !== 1) {
      const sourceAccepted = proposals.some(
        (proposal) =>
          proposal.sourceNodeVersion.knowledgeNode.localNodeId === record.subject.claimNodeId,
      );
      const targetAccepted = proposals.some(
        (proposal) =>
          proposal.targetNodeVersion.knowledgeNode.localNodeId === record.subject.evidenceNodeId,
      );
      if (!sourceAccepted || (!record.subject.evidenceRepository && !targetAccepted)) continue;
      throw new SubmissionError(
        `Node-relation TRUST ${record.subject.claimNodeId}→${record.subject.evidenceNodeId} does not match exactly one accepted author edge.`,
        "conflict",
      );
    }
    const row = await ingestNodeRelationTrustAssessment(tx, matches[0]!.id, record);
    created.push(row.id);
  }
  return created;
}

function detectExample(meta: EffectiveMetadata): boolean {
  return /10\.5555\//i.test(`${meta.versionDoi ?? ""} ${meta.conceptDoi ?? ""}`);
}

function nodeContainsExampleDoi(
  node: ReturnType<typeof validNodeCandidates>[number]["node"],
): boolean {
  const doiValues = [node.versionDoi, node.conceptDoi];
  for (const [field, value] of Object.entries(node.payload)) {
    if (/doi$/i.test(field) && typeof value === "string") doiValues.push(value);
  }
  return doiValues.some((doi) => Boolean(doi && isExampleDoi(doi)));
}

async function uniqueSlug(
  tx: Prisma.TransactionClient,
  title: string,
  owner: string,
): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || owner.toLowerCase();
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const slug = suffix === 0 ? base : `${base}-${suffix}`;
    if (!(await tx.review.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  throw new SubmissionError("Could not allocate a review slug.", "conflict");
}
