import { createHash } from "node:crypto";
import { PrismaClient } from "../../generated/client/index.js";
import {
  EXTRACTOR_VERSION,
  TRUST_PROTOCOL_VERSION,
  linkProposal,
  pendingSubmission,
  seedComments,
  seedReviews,
  seedUsers,
  type SeedRelation,
  type SeedReview,
  type SeedTrust,
} from "./data.js";

const prisma = new PrismaClient();

function contentHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function buildMetadataJson(review: SeedReview) {
  return JSON.stringify({
    provenanceNote: review.metadataProvenanceNote,
    compatibilityLevel: review.compatibilityLevel,
    keywords: review.keywords,
    domains: review.domains,
    reviewType: review.reviewType,
    license: review.licenseSpdx,
    extractorVersion: EXTRACTOR_VERSION,
  });
}

function trustColumns(trust: SeedTrust) {
  const cols: Record<string, string | null> = {
    identityIntegrity: null,
    entailment: null,
    sourceAccess: null,
    populationRelevance: null,
    interventionExposureRelevance: null,
    outcomeRelevance: null,
    methodologicalSafeguards: null,
    statisticalSafeguards: null,
    replicationConvergence: null,
    conflictDependency: null,
  };
  for (const [criterion, value] of Object.entries(trust.criteria)) {
    if (criterion in cols) {
      cols[criterion] = JSON.stringify({ status: "assessed", ...value });
    }
  }
  return cols;
}

async function seedReview(review: SeedReview) {
  const repo = await prisma.repository.create({
    data: {
      host: "github.com",
      owner: review.repository.owner,
      name: review.repository.name,
      canonicalUrl: review.repository.canonicalUrl,
      defaultBranch: review.repository.defaultBranch,
      description: review.repository.description,
      licenseSpdx: review.licenseSpdx,
      topicsJson: JSON.stringify(review.repository.topics),
      homepageUrl: review.repository.homepageUrl,
      pagesUrl: review.repository.pagesUrl,
      lastInspectedAt: new Date(),
    },
  });

  const inspectionReport = {
    schemaVersion: "1.0.0",
    note: "Seed inspection report (synthetic).",
    compatibilityLevel: review.compatibilityLevel,
  };

  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: repo.id,
      commitSha: review.snapshot.commitSha,
      branch: review.snapshot.branch,
      releaseTag: review.snapshot.releaseTag,
      releaseUrl: review.snapshot.releaseUrl,
      sourceCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
      inspectionStatus: "succeeded",
      inspectionReportJson: JSON.stringify(inspectionReport),
      manifestJson: null,
      contentHash: contentHash({ repo: repo.canonicalUrl, sha: review.snapshot.commitSha }),
    },
  });

  const reviewRow = await prisma.review.create({
    data: {
      slug: review.slug,
      currentSnapshotId: snapshot.id,
      title: review.title,
      abstract: review.abstract,
      reviewType: review.reviewType,
      licenseSpdx: review.licenseSpdx,
      publishedReviewUrl: review.publishedReviewUrl,
      status: review.status,
      acceptedAt: new Date("2026-06-15T00:00:00.000Z"),
    },
  });

  const version = await prisma.reviewVersion.create({
    data: {
      reviewId: reviewRow.id,
      snapshotId: snapshot.id,
      semanticVersion: review.version.semanticVersion,
      title: review.title,
      abstract: review.abstract,
      metadataJson: buildMetadataJson(review),
      versionDoi: review.version.versionDoi,
      conceptDoi: review.version.conceptDoi,
      zenodoRecordId: review.version.zenodoRecordId,
      releaseTag: review.version.releaseTag,
      isExample: review.version.isExample,
      publishedAt: new Date("2026-06-15T00:00:00.000Z"),
    },
  });

  // Contributors
  for (let i = 0; i < review.contributors.length; i++) {
    const c = review.contributors[i]!;
    const person = await prisma.person.create({
      data: {
        displayName: c.displayName,
        givenName: c.givenName,
        familyName: c.familyName,
        orcid: c.orcid,
        githubLogin: c.githubLogin,
      },
    });
    await prisma.reviewContributor.create({
      data: {
        reviewVersionId: version.id,
        personId: person.id,
        rolesJson: JSON.stringify(c.roles),
        position: i,
      },
    });
  }

  // Identifiers (distinct version DOI vs concept DOI)
  const identifiers: Array<{
    scheme: string;
    value: string;
    relationType: string;
    url?: string;
    isExample: boolean;
    validationStatus: string;
  }> = [
    {
      scheme: "github",
      value: review.repository.canonicalUrl,
      relationType: "repository",
      url: review.repository.canonicalUrl,
      isExample: false,
      validationStatus: "valid",
    },
  ];
  if (review.publishedReviewUrl) {
    identifiers.push({
      scheme: "url",
      value: review.publishedReviewUrl,
      relationType: "published-review",
      url: review.publishedReviewUrl,
      isExample: false,
      validationStatus: "unvalidated",
    });
  }
  if (review.version.versionDoi) {
    identifiers.push({
      scheme: "doi",
      value: review.version.versionDoi,
      relationType: "version-doi",
      isExample: true,
      validationStatus: "example-not-resolvable",
    });
  }
  if (review.version.conceptDoi) {
    identifiers.push({
      scheme: "doi",
      value: review.version.conceptDoi,
      relationType: "concept-doi",
      isExample: true,
      validationStatus: "example-not-resolvable",
    });
  }
  if (review.version.zenodoRecordId) {
    identifiers.push({
      scheme: "zenodo-record",
      value: review.version.zenodoRecordId,
      relationType: "zenodo-record",
      isExample: true,
      validationStatus: "example-not-resolvable",
    });
  }
  for (const c of review.contributors) {
    if (c.orcid) {
      identifiers.push({
        scheme: "orcid",
        value: c.orcid,
        relationType: "author-orcid",
        url: `https://orcid.org/${c.orcid}`,
        isExample: true,
        validationStatus: "example-not-resolvable",
      });
    }
  }
  for (const id of identifiers) {
    await prisma.identifier.create({
      data: {
        reviewVersionId: version.id,
        scheme: id.scheme,
        value: id.value,
        normalizedValue: id.value.toLowerCase(),
        url: id.url,
        relationType: id.relationType,
        validationStatus: id.validationStatus,
        isExample: id.isExample,
      },
    });
  }

  // Claims
  const claimIdByLocal = new Map<string, string>();
  for (const claim of review.claims) {
    const row = await prisma.claim.create({
      data: {
        reviewVersionId: version.id,
        localClaimId: claim.localId,
        text: claim.text,
        normalizedText: claim.text.toLowerCase(),
        section: claim.section,
        anchor: claim.anchor,
        claimType: claim.claimType,
        qualification: claim.qualification,
      },
    });
    claimIdByLocal.set(claim.localId, row.id);
  }

  // Citations
  const citationIdByLocal = new Map<string, string>();
  for (const citation of review.citations) {
    const row = await prisma.citation.create({
      data: {
        reviewVersionId: version.id,
        localCitationId: citation.localId,
        doi: citation.doi,
        title: citation.title,
        authorsJson: JSON.stringify(citation.authors ?? []),
        year: citation.year,
        source: citation.source,
        rawCitationJson: JSON.stringify({ isExample: citation.isExample ?? false }),
      },
    });
    citationIdByLocal.set(citation.localId, row.id);
  }

  // Relations + TRUST
  for (const rel of review.relations as SeedRelation[]) {
    const claimId = claimIdByLocal.get(rel.claimLocalId);
    const citationId = citationIdByLocal.get(rel.citationLocalId);
    if (!claimId || !citationId) continue;
    const relation = await prisma.claimEvidenceRelation.create({
      data: {
        claimId,
        citationId,
        relationType: rel.relationType,
        supportDirection: rel.supportDirection,
        extractionMethod: "seed",
        extractionConfidence: 0.9,
        humanReviewed: rel.humanReviewed ?? false,
      },
    });
    if (rel.trust) {
      await prisma.trustAssessment.create({
        data: {
          claimEvidenceRelationId: relation.id,
          protocolVersion: TRUST_PROTOCOL_VERSION,
          assessorType: rel.trust.assessorType,
          assessorId: rel.trust.assessorId,
          assessedAt: new Date("2026-06-10T00:00:00.000Z"),
          ...trustColumns(rel.trust),
          limitationsJson: JSON.stringify(rel.trust.limitations ?? []),
          aggregateScore: rel.trust.aggregateScore,
          aggregateMethod: rel.trust.aggregateMethod,
          reviewStatus: rel.trust.reviewStatus,
        },
      });
    }
  }

  return { reviewRow, version, claimIdByLocal };
}

async function seedReviewComments(
  reviewIdBySlug: Map<string, string>,
  claimIdsBySlug: Map<string, Map<string, string>>,
  userIdByLogin: Map<string, string>,
) {
  const commentIdsByReview = new Map<string, string[]>();
  for (const comment of seedComments) {
    const reviewId = reviewIdBySlug.get(comment.reviewSlug);
    const authorId = userIdByLogin.get(comment.authorLogin);
    if (!reviewId || !authorId) continue;
    const claimId = comment.claimLocalId
      ? claimIdsBySlug.get(comment.reviewSlug)?.get(comment.claimLocalId)
      : undefined;
    const created = commentIdsByReview.get(comment.reviewSlug) ?? [];
    const parentId = comment.replyTo !== undefined ? (created[comment.replyTo] ?? null) : null;
    const row = await prisma.reviewComment.create({
      data: {
        reviewId,
        authorId,
        parentId,
        claimId: claimId ?? null,
        kind: comment.kind,
        body: comment.body,
      },
    });
    created.push(row.id);
    commentIdsByReview.set(comment.reviewSlug, created);
  }
  const total = [...commentIdsByReview.values()].reduce((n, ids) => n + ids.length, 0);
  if (total > 0) console.info(`  · seeded ${total} review comments`);
}

async function main() {
  console.info("Seeding Open Review Atlas database…");

  // Users
  const users = new Map<string, string>();
  for (const u of seedUsers) {
    const row = await prisma.user.create({
      data: {
        githubLogin: u.githubLogin,
        githubUserId: u.githubUserId,
        displayName: u.displayName,
        role: u.role,
        profileUrl: u.profileUrl,
      },
    });
    users.set(u.githubLogin, row.id);
  }

  // Reviews
  const claimIdsBySlug = new Map<string, Map<string, string>>();
  const reviewIdBySlug = new Map<string, string>();
  for (const review of seedReviews) {
    const { reviewRow, claimIdByLocal } = await seedReview(review);
    claimIdsBySlug.set(review.slug, claimIdByLocal);
    reviewIdBySlug.set(review.slug, reviewRow.id);
    console.info(`  · seeded review: ${review.slug}`);
  }

  // Community comments on published reviews
  await seedReviewComments(reviewIdBySlug, claimIdsBySlug, users);

  // Pending submission (its own repository + snapshot, no accepted review)
  const submitterId = users.get("atlas-submitter")!;
  const pendingRepo = await prisma.repository.create({
    data: {
      host: "github.com",
      owner: pendingSubmission.repository.owner,
      name: pendingSubmission.repository.name,
      canonicalUrl: pendingSubmission.repository.canonicalUrl,
      defaultBranch: pendingSubmission.repository.defaultBranch,
      description: pendingSubmission.repository.description,
      topicsJson: JSON.stringify(pendingSubmission.repository.topics),
      lastInspectedAt: new Date(),
    },
  });
  const pendingSnapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: pendingRepo.id,
      commitSha: pendingSubmission.snapshot.commitSha,
      branch: pendingSubmission.snapshot.branch,
      inspectionStatus: "succeeded",
      inspectionReportJson: JSON.stringify({ schemaVersion: "1.0.0", note: "seed pending" }),
      contentHash: contentHash({ pending: pendingSubmission.repository.canonicalUrl }),
    },
  });
  const extractedMetadata = {
    extractorVersion: EXTRACTOR_VERSION,
    extractedAt: "2026-07-01T12:00:00.000Z",
    commitSha: pendingSubmission.snapshot.commitSha,
    fields: {
      title: {
        value: pendingSubmission.title,
        provenance: {
          source: "readme",
          file: "README.md",
          extractorVersion: EXTRACTOR_VERSION,
          extractedAt: "2026-07-01T12:00:00.000Z",
          confidence: 0.6,
          warnings: [],
        },
      },
    },
    warnings: ["No review-manifest.json found; title extracted heuristically from README."],
  };
  await prisma.submission.create({
    data: {
      submitterId,
      repositoryId: pendingRepo.id,
      snapshotId: pendingSnapshot.id,
      status: pendingSubmission.status,
      extractedMetadataJson: JSON.stringify(extractedMetadata),
      editedMetadataJson: JSON.stringify({ edits: {} }),
      // Immutable payload an editor can accept (materializes a review). Kept
      // minimal: repository-only, no knowledge artifacts.
      submittedPayloadJson: JSON.stringify({
        effectiveMetadata: {
          title: pendingSubmission.title,
          abstract: pendingSubmission.abstract,
          authors: [],
          keywords: [],
          domains: ["Neuroscience"],
          reviewType: "computational-literature-review",
          repositoryUrl: pendingSubmission.repository.canonicalUrl,
        },
        compatibilityLevel: "partially-compatible",
        knowledge: { claims: [], citations: [], relations: [], trust: [] },
      }),
      validationReportJson: JSON.stringify({
        schemaVersion: "1.0.0",
        hardErrors: [],
        warnings: ["No DOI supplied; eligible as repository-only."],
        releaseValidation: { releaseDetected: false, details: ["No release found."] },
        metadataCompleteness: {
          requiredMissing: [],
          recommendedMissing: ["abstract", "keywords"],
          score: 0.6,
        },
        compatibilityLevel: "partially-compatible",
        evidenceDataAvailable: false,
        trustDataAvailable: false,
        validatedAt: "2026-07-01T12:00:00.000Z",
      }),
      submittedAt: new Date("2026-07-02T09:00:00.000Z"),
    },
  });
  console.info("  · seeded pending submission");

  // Cross-review link proposal
  const sourceClaims = claimIdsBySlug.get(linkProposal.sourceReviewSlug);
  const targetClaims = claimIdsBySlug.get(linkProposal.targetReviewSlug);
  const sourceClaimId = sourceClaims?.get(linkProposal.sourceClaimLocalId);
  const targetClaimId = targetClaims?.get(linkProposal.targetClaimLocalId);
  if (sourceClaimId && targetClaimId) {
    await prisma.knowledgeLinkProposal.create({
      data: {
        sourceClaimId,
        targetClaimId,
        proposedRelation: linkProposal.proposedRelation,
        featuresJson: JSON.stringify(linkProposal.features),
        semanticSimilarity: linkProposal.features.normalizedTokenOverlap,
        rationale: linkProposal.rationale,
        agentProvenance: linkProposal.agentProvenance,
        status: linkProposal.status,
      },
    });
    console.info("  · seeded cross-review link proposal");
  }

  // Audit event for the seed run
  await prisma.auditEvent.create({
    data: {
      actorId: users.get("atlas-editor")!,
      action: "seed.loaded",
      subjectType: "system",
      subjectId: "seed",
      detailsJson: JSON.stringify({ reviews: seedReviews.length }),
    },
  });

  console.info("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
