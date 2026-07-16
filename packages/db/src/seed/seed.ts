import { createHash } from "node:crypto";
import {
  canonicalJson,
  knowledgeNodeSchema,
  nodeEdgeSchema,
  type CompatibilityReport,
  type SubmissionValidationReport,
  type TrustRecord,
} from "@oratlas/contracts";
import {
  normalizeImportedTrustRecord,
  reviewedTrustSubjectHash,
  trustSubjectInputFromDatabaseRows,
} from "@oratlas/trust";
import { PrismaClient } from "../../generated/client/index.js";
import { upsertNodeAlias } from "../node-aliases.js";
import {
  EXTRACTOR_VERSION,
  TRUST_PROTOCOL_VERSION,
  linkProposal,
  pendingSubmission,
  replicationLabRepository,
  seedComments,
  seedKnowledgeNodes,
  seedNodeEdges,
  seedReviews,
  seedUsers,
  type SeedRelation,
  type SeedReview,
} from "./data.js";

const prisma = new PrismaClient();

function contentHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

async function seedReview(review: SeedReview, editorId: string) {
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

  const treeSha = `${review.snapshot.commitSha.slice(0, -1)}f`;
  const article = [
    `# ${review.title}`,
    "",
    review.abstract,
    "",
    "## Claims",
    "",
    ...review.claims.flatMap((claim) => [`- ${claim.text}`, ""]),
  ].join("\n");
  const articleBytes = Buffer.byteLength(article, "utf8");
  const inspectionReport = {
    schemaVersion: "1.0.0",
    githubRepositoryId: `seed:${review.slug}`,
    repositoryUrl: review.repository.canonicalUrl,
    commitSha: review.snapshot.commitSha,
    treeSha,
    files: {
      "README.md": {
        size: articleBytes,
        truncated: false,
        contentHash: sha256(article),
      },
    },
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
      sourceTreeSha: treeSha,
      manifestJson: null,
      preservedFilesJson: canonicalJson({
        "README.md": { size: articleBytes, truncated: false, content: article },
      }),
      contentHash: contentHash({ repo: repo.canonicalUrl, sha: review.snapshot.commitSha }),
    },
  });

  const reviewRow = await prisma.review.create({
    data: {
      slug: review.slug,
      repositoryId: repo.id,
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
      sourceKind: review.snapshot.releaseTag ? "release" : "default-branch",
      sourceBranch: review.snapshot.releaseTag ? null : review.snapshot.branch,
      sourceSelectionKey: review.snapshot.releaseTag
        ? `release:${review.snapshot.releaseTag}`
        : `default-branch:${review.snapshot.branch}`,
      sourceCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
      semanticVersion: review.version.semanticVersion,
      title: review.title,
      abstract: review.abstract,
      metadataJson: buildMetadataJson(review),
      versionDoi: review.version.versionDoi,
      conceptDoi: review.version.conceptDoi,
      zenodoRecordId: review.version.zenodoRecordId,
      releaseTag: review.version.releaseTag,
      releaseUrl: review.snapshot.releaseUrl,
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
  const claimByLocal = new Map<string, Awaited<ReturnType<typeof prisma.claim.create>>>();
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
        scopeJson: claim.scope ? JSON.stringify(claim.scope) : null,
      },
    });
    claimIdByLocal.set(claim.localId, row.id);
    claimByLocal.set(claim.localId, row);
  }

  // Citations
  const citationIdByLocal = new Map<string, string>();
  const citationByLocal = new Map<string, Awaited<ReturnType<typeof prisma.citation.create>>>();
  for (const citation of review.citations) {
    const row = await prisma.citation.create({
      data: {
        reviewVersionId: version.id,
        localCitationId: citation.localId,
        doi: citation.doi,
        datasetIdsJson: JSON.stringify(citation.datasetIds ?? []),
        derivedFromJson: JSON.stringify(citation.derivedFromDois ?? []),
        title: citation.title,
        authorsJson: JSON.stringify(citation.authors ?? []),
        year: citation.year,
        source: citation.source,
        rawCitationJson: JSON.stringify({ isExample: citation.isExample ?? false }),
      },
    });
    citationIdByLocal.set(citation.localId, row.id);
    citationByLocal.set(citation.localId, row);
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
        humanReviewed: false,
      },
    });
    if (rel.trust) {
      const sourceAssessedAt = rel.trust.assessedAt ?? "2026-06-10T00:00:00.000Z";
      const sourceRecord: TrustRecord = {
        claimId: rel.claimLocalId,
        citationId: rel.citationLocalId,
        protocolVersion: TRUST_PROTOCOL_VERSION,
        assessorType: rel.trust.assessorType,
        assessorId: rel.trust.assessorId,
        assessedAt: sourceAssessedAt,
        criteria: Object.fromEntries(
          Object.entries(rel.trust.criteria).map(([criterion, value]) => [
            criterion,
            { status: "assessed" as const, ...value },
          ]),
        ),
        limitations: rel.trust.limitations,
        evidence: rel.trust.evidence,
        aggregateScore: rel.trust.aggregateScore,
        aggregateMethod: rel.trust.aggregateMethod,
        reviewStatus: rel.trust.reviewStatus,
      };
      const imported = normalizeImportedTrustRecord(sourceRecord, rel.humanReviewed ?? null);
      const assessment = await prisma.trustAssessment.create({
        data: {
          claimEvidenceRelationId: relation.id,
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

      // Seeded review is an explicit platform fixture, represented with the
      // same separate marker and canonical hash used by production editorial
      // verification. Repository flags alone never create this marker.
      if (rel.humanReviewed || rel.trust.reviewStatus === "human-reviewed") {
        const claimRow = claimByLocal.get(rel.claimLocalId);
        const citationRow = citationByLocal.get(rel.citationLocalId);
        if (claimRow && citationRow) {
          const subject = trustSubjectInputFromDatabaseRows({
            assessment,
            relation,
            claim: claimRow,
            citation: citationRow,
          });
          await prisma.trustVerification.create({
            data: {
              trustAssessmentId: assessment.id,
              status: "human-reviewed",
              reviewerId: editorId,
              reviewerRoleSnapshot: "EDITOR",
              rationale: "Synthetic fixture structurally reviewed by the Atlas demo editor.",
              assessmentHash: reviewedTrustSubjectHash(subject),
            },
          });
        }
      }
    }
  }

  return { repo, snapshot, reviewRow, version, claimIdByLocal };
}

interface SeedNodeRepositoryBinding {
  repositoryId: string;
  snapshotId: string;
}

async function seedKnowledgeGraph(
  repositories: Map<string, SeedNodeRepositoryBinding>,
  claimIdsBySlug: Map<string, Map<string, string>>,
): Promise<void> {
  const identityIdByKey = new Map<string, string>();
  const versionIdByKey = new Map<string, string>();

  for (const fixture of seedKnowledgeNodes) {
    const node = knowledgeNodeSchema.parse(fixture.node);
    const binding = repositories.get(fixture.repositoryKey);
    if (!binding) throw new Error(`Missing seed node repository '${fixture.repositoryKey}'.`);

    const identity = await prisma.knowledgeNode.create({
      data: {
        repositoryId: binding.repositoryId,
        localNodeId: node.id,
        kind: node.kind,
      },
    });
    const version = await prisma.knowledgeNodeVersion.create({
      data: {
        knowledgeNodeId: identity.id,
        snapshotId: binding.snapshotId,
        title: node.title,
        abstract: node.abstract,
        text: node.text,
        contributorsJson: canonicalJson(node.contributors),
        license: node.license,
        provenanceJson: canonicalJson(node.provenance),
        payloadJson: canonicalJson(node.payload),
        versionDoi: node.versionDoi,
        conceptDoi: node.conceptDoi,
        isExample: fixture.isExample,
      },
    });
    const key = `${fixture.repositoryKey}:${node.id}`;
    identityIdByKey.set(key, identity.id);
    versionIdByKey.set(key, version.id);

    const aliases = [
      node.versionDoi
        ? { scheme: "doi" as const, role: "version-doi" as const, value: node.versionDoi }
        : undefined,
      node.conceptDoi
        ? { scheme: "doi" as const, role: "concept-doi" as const, value: node.conceptDoi }
        : undefined,
      node.kind === "dataset" && node.payload.doi
        ? { scheme: "doi" as const, role: "artifact-doi" as const, value: node.payload.doi }
        : undefined,
    ].filter((alias) => alias !== undefined);
    for (const rawAlias of aliases) {
      await upsertNodeAlias(prisma, {
        knowledgeNodeId: identity.id,
        alias: { ...rawAlias, isExample: fixture.isExample },
      });
    }

    if (fixture.legacyClaim) {
      const claimId = claimIdsBySlug
        .get(fixture.legacyClaim.reviewSlug)
        ?.get(fixture.legacyClaim.localClaimId);
      if (!claimId) {
        throw new Error(
          `Missing legacy claim '${fixture.legacyClaim.reviewSlug}:${fixture.legacyClaim.localClaimId}'.`,
        );
      }
      await prisma.claim.update({ where: { id: claimId }, data: { knowledgeNodeId: identity.id } });
    }
  }

  for (const fixture of seedNodeEdges) {
    const edge = nodeEdgeSchema.parse(fixture.edge);
    const sourceNodeVersionId = versionIdByKey.get(
      `${fixture.sourceRepositoryKey}:${edge.sourceNodeId}`,
    );
    const targetNodeId = identityIdByKey.get(`${fixture.targetRepositoryKey}:${edge.targetNodeId}`);
    if (!sourceNodeVersionId || !targetNodeId) {
      throw new Error(`Unresolved seed edge '${edge.sourceNodeId}' -> '${edge.targetNodeId}'.`);
    }
    await prisma.nodeEdge.create({
      data: {
        sourceNodeVersionId,
        targetNodeId,
        relationType: edge.relationType,
        status: edge.status,
        provenance: edge.provenance,
        rationale: edge.rationale,
        assertedAt: edge.assertedAt ? new Date(edge.assertedAt) : null,
      },
    });
  }

  console.info(
    `  · seeded knowledge graph: ${seedKnowledgeNodes.length} nodes, ${seedNodeEdges.length} edges`,
  );
}

async function seedReviewComments(
  reviewIdBySlug: Map<string, string>,
  versionIdBySlug: Map<string, string>,
  claimIdsBySlug: Map<string, Map<string, string>>,
  userIdByLogin: Map<string, string>,
) {
  const commentIdsByReview = new Map<string, string[]>();
  for (const comment of seedComments) {
    const reviewId = reviewIdBySlug.get(comment.reviewSlug);
    const authorId = userIdByLogin.get(comment.authorLogin);
    const reviewVersionId = versionIdBySlug.get(comment.reviewSlug);
    if (!reviewId || !reviewVersionId || !authorId) continue;
    const claimId = comment.claimLocalId
      ? claimIdsBySlug.get(comment.reviewSlug)?.get(comment.claimLocalId)
      : undefined;
    const created = commentIdsByReview.get(comment.reviewSlug) ?? [];
    const parentId = comment.replyTo !== undefined ? (created[comment.replyTo] ?? null) : null;
    const row = await prisma.reviewComment.create({
      data: {
        reviewId,
        reviewVersionId,
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
        githubLoginNormalized: u.githubLogin.normalize("NFKC").toLowerCase(),
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
  const versionIdBySlug = new Map<string, string>();
  const nodeRepositories = new Map<string, SeedNodeRepositoryBinding>();
  for (const review of seedReviews) {
    const { repo, snapshot, reviewRow, version, claimIdByLocal } = await seedReview(
      review,
      users.get("atlas-editor")!,
    );
    claimIdsBySlug.set(review.slug, claimIdByLocal);
    reviewIdBySlug.set(review.slug, reviewRow.id);
    versionIdBySlug.set(review.slug, version.id);
    if (review.slug === seedReviews[0]!.slug) {
      nodeRepositories.set("replay-lab", { repositoryId: repo.id, snapshotId: snapshot.id });
    }
    console.info(`  · seeded review: ${review.slug}`);
  }

  const replicationRepo = await prisma.repository.create({
    data: {
      host: "github.com",
      owner: replicationLabRepository.owner,
      name: replicationLabRepository.name,
      canonicalUrl: replicationLabRepository.canonicalUrl,
      githubRepositoryId: "seed:independent-replication-lab",
      defaultBranch: replicationLabRepository.defaultBranch,
      description: replicationLabRepository.description,
      licenseSpdx: "CC-BY-4.0",
      topicsJson: canonicalJson(replicationLabRepository.topics),
      lastInspectedAt: new Date(),
    },
  });
  const replicationSnapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: replicationRepo.id,
      commitSha: replicationLabRepository.commitSha,
      branch: replicationLabRepository.defaultBranch,
      inspectionStatus: "succeeded",
      inspectionReportJson: canonicalJson({
        schemaVersion: "1.0.0",
        repositoryUrl: replicationLabRepository.canonicalUrl,
        commitSha: replicationLabRepository.commitSha,
        note: "Synthetic node-publication seed repository.",
      }),
      contentHash: contentHash({
        repositoryUrl: replicationLabRepository.canonicalUrl,
        commitSha: replicationLabRepository.commitSha,
      }),
    },
  });
  nodeRepositories.set("replication-lab", {
    repositoryId: replicationRepo.id,
    snapshotId: replicationSnapshot.id,
  });

  await seedKnowledgeGraph(nodeRepositories, claimIdsBySlug);

  // Community comments on published reviews
  await seedReviewComments(reviewIdBySlug, versionIdBySlug, claimIdsBySlug, users);

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
      sourceTreeSha: pendingSubmission.snapshot.treeSha,
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
  // Immutable payload an editor can accept (materializes a review). Kept
  // minimal — repository-only, no knowledge artifacts — but it must satisfy
  // the strict canonical-payload contract acceptance enforces: canonical
  // JSON, a capture hash, and a full compatibility + validation report.
  const absentSignal = { detected: false, evidence: [] };
  const pendingCompatibility: CompatibilityReport = {
    schemaVersion: "1.0.0",
    templateForkDetected: absentSignal,
    templateFilesDetected: absentSignal,
    mystProjectDetected: absentSignal,
    bibliographyDetected: absentSignal,
    reviewContentDetected: {
      detected: true,
      evidence: ["README.md describes a computational review draft."],
    },
    provenanceDetected: absentSignal,
    trustDataDetected: absentSignal,
    releaseDetected: absentSignal,
    doiDetected: absentSignal,
    overallCompatibility: "partially-compatible",
    levelRationale: [
      "Review content detected without a release, DOI or manifest; eligible as repository-only.",
    ],
    blockingErrors: [],
    warnings: [],
    recommendations: ["Add review-manifest.json and mint a Zenodo DOI for a future version."],
  };
  const pendingValidation: SubmissionValidationReport = {
    schemaVersion: "1.0.0",
    hardErrors: [],
    warnings: ["No DOI supplied; eligible as repository-only."],
    releaseValidation: { releaseDetected: false, details: ["No release found."] },
    publicationConsistency: {
      schemaVersion: "1.0.0",
      status: "not-applicable",
      selectedSourceKind: "default-branch",
      selectedCommitSha: pendingSubmission.snapshot.commitSha,
      selectedTreeSha: pendingSubmission.snapshot.treeSha,
      checks: [],
      errors: [],
      warnings: ["No release or DOI is linked; nothing to cross-check."],
      overridableCheckIds: [],
      requiresEditorOverride: false,
    },
    metadataCompleteness: {
      requiredMissing: [],
      recommendedMissing: ["keywords"],
      score: 0.6,
    },
    compatibilityLevel: "partially-compatible",
    evidenceDataAvailable: false,
    trustDataAvailable: false,
    validatedAt: "2026-07-01T12:00:00.000Z",
  };
  const pendingPayloadJson = canonicalJson({
    schemaVersion: "1.0.0",
    // Synthetic capture hash: the seed has no real inspection capture, but the
    // payload contract requires the hash of the capture it was derived from.
    capturePayloadHash: contentHash({
      capture: pendingSubmission.repository.canonicalUrl,
      commitSha: pendingSubmission.snapshot.commitSha,
    }),
    effectiveMetadata: {
      title: pendingSubmission.title,
      abstract: pendingSubmission.abstract,
      authors: [],
      keywords: [],
      domains: ["Neuroscience"],
      reviewType: "computational-literature-review",
      repositoryUrl: pendingSubmission.repository.canonicalUrl,
    },
    compatibilityLevel: pendingCompatibility.overallCompatibility,
    compatibilityReport: pendingCompatibility,
    validation: pendingValidation,
    knowledge: { claims: [], citations: [], relations: [], trust: [], warnings: [] },
  });
  await prisma.submission.create({
    data: {
      submitterId,
      repositoryId: pendingRepo.id,
      snapshotId: pendingSnapshot.id,
      sourceKind: "default-branch",
      sourceBranch: pendingSubmission.snapshot.branch,
      sourceSelectionKey: `default-branch:${pendingSubmission.snapshot.branch}`,
      status: pendingSubmission.status,
      extractedMetadataJson: JSON.stringify(extractedMetadata),
      editedMetadataJson: JSON.stringify({ edits: {} }),
      submittedPayloadJson: pendingPayloadJson,
      submittedPayloadHash: sha256(pendingPayloadJson),
      validationReportJson: canonicalJson(pendingValidation),
      publicationConsistencyJson: canonicalJson(pendingValidation.publicationConsistency),
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

  // Evidence-monitoring fixture: one retraction signal on a cited work of the
  // replay review, opening a human-reviewable update proposal (issue #3).
  const monitoredCitation = await prisma.citation.findFirst({
    where: { doi: { not: null }, reviewVersionId: versionIdBySlug.get(seedReviews[0]!.slug) },
    include: { evidenceRelations: { take: 1 } },
  });
  const monitoredRelation = monitoredCitation?.evidenceRelations[0];
  if (monitoredCitation?.doi && monitoredRelation) {
    const statusRecord = await prisma.citationStatusRecord.create({
      data: {
        workAlias: `doi:${monitoredCitation.doi.toLowerCase()}`,
        status: "retracted",
        source: "seed fixture (synthetic publisher notice)",
        note: "Synthetic example: the cited work was retracted after the review was published.",
        recordedById: users.get("atlas-editor")!,
      },
    });
    await prisma.claimUpdateProposal.create({
      data: {
        statusRecordId: statusRecord.id,
        claimId: monitoredRelation.claimId,
        citationId: monitoredCitation.id,
        rationale:
          `Cited work doi:${monitoredCitation.doi.toLowerCase()} was marked "retracted" ` +
          `(source: seed fixture (synthetic publisher notice)). This claim relies on it via a ` +
          `"${monitoredRelation.relationType}" relation.`,
      },
    });
    console.info("  · seeded citation retraction signal and update proposal");
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
