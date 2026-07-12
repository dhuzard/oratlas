import "server-only";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  claimRecordSchema,
  citationRecordSchema,
  compatibilityLevelSchema,
  compatibilityReportSchema,
  effectiveMetadataSchema,
  relationRecordSchema,
  resolveEffectiveMetadata,
  type ClaimRecord,
  type CitationRecord,
  type CompatibilityReport,
  type EditedMetadata,
  type EffectiveMetadata,
  type ExtractedMetadata,
  type InspectionReport,
  type PublicationConsistencyReport,
  type RelationRecord,
  type SubmissionValidationReport,
  type TrustRecord,
  submissionValidationReportSchema,
  trustRecordSchema,
} from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";
import { normalizeImportedTrustRecord } from "@oratlas/trust";
import { z } from "zod";
import { prisma, parseJsonColumn } from "./db";
import { buildValidationReport } from "./ingest";
import {
  hashInspectionToken,
  parseAndVerifyCapture,
  type InspectionCapturePayload,
} from "./inspection-captures";

export interface SubmissionPayload {
  schemaVersion: "1.0.0";
  capturePayloadHash: string;
  effectiveMetadata: EffectiveMetadata;
  compatibilityLevel: string;
  compatibilityReport: CompatibilityReport;
  validation: SubmissionValidationReport;
  knowledge: {
    claims: ClaimRecord[];
    citations: CitationRecord[];
    relations: RelationRecord[];
    trust: TrustRecord[];
    warnings: string[];
  };
}

export interface CreateSubmissionInput {
  inspectionToken: string;
  submitterId: string;
  editedMetadata?: EditedMetadata;
}

export interface CreateSubmissionResult {
  submissionId: string;
  status: string;
}

export interface EditorialOverrideInput {
  checkId: string;
  rationale: string;
}

const submissionPayloadSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    capturePayloadHash: z.string().regex(/^[0-9a-f]{64}$/),
    effectiveMetadata: effectiveMetadataSchema,
    compatibilityLevel: compatibilityLevelSchema,
    compatibilityReport: compatibilityReportSchema,
    validation: submissionValidationReportSchema,
    knowledge: z
      .object({
        claims: z.array(claimRecordSchema),
        citations: z.array(citationRecordSchema),
        relations: z.array(relationRecordSchema),
        trust: z.array(trustRecordSchema),
        warnings: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

/** Consume one exact inspection capture; no repository network request occurs here. */
export async function createSubmission(
  input: CreateSubmissionInput,
): Promise<CreateSubmissionResult> {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(input.inspectionToken)) {
    throw new SubmissionError("Inspection capability is invalid.", "bad-request");
  }
  const tokenHash = hashInspectionToken(input.inspectionToken);
  const capture = await prisma.inspectionCapture.findUnique({
    where: { tokenHash },
    include: { submission: true },
  });
  if (!capture)
    throw new SubmissionError("Inspection capability is invalid or expired.", "bad-request");
  assertCaptureUsable(capture, input.submitterId, new Date());
  const captured = verifyCapture(capture);
  const effective = resolveEffectiveMetadata(captured.extraction.metadata, input.editedMetadata);
  const knowledge = captured.extraction.knowledge;
  const validation = await buildValidationReport(
    captured.report,
    captured.extraction.compatibility,
    captured.extraction.metadata,
    input.editedMetadata,
    knowledge.claims.length > 0 && knowledge.citations.length > 0,
    knowledge.trust.length > 0,
  );
  const status =
    validation.hardErrors.length > 0 || validation.publicationConsistency?.status === "fail"
      ? "automated-checks-failed"
      : "pending-editorial-review";
  const submittedPayload: SubmissionPayload = {
    schemaVersion: "1.0.0",
    capturePayloadHash: capture.payloadHash,
    effectiveMetadata: effective,
    compatibilityLevel: captured.extraction.compatibility.overallCompatibility,
    compatibilityReport: captured.extraction.compatibility,
    validation,
    knowledge,
  };
  const submittedPayloadJson = canonicalJson(submittedPayload);

  const persist = () =>
    withSqliteRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const locked = await tx.inspectionCapture.findUnique({
            where: { tokenHash },
            include: { submission: true },
          });
          if (!locked)
            throw new SubmissionError("Inspection capability is invalid.", "bad-request");
          assertCaptureUsable(locked, input.submitterId, new Date());
          const exact = verifyCapture(locked);
          if (
            exact.report.selectedSource?.commitSha !== captured.report.selectedSource?.commitSha ||
            locked.payloadHash !== capture.payloadHash
          ) {
            throw new SubmissionError("Inspection capture changed before submission.", "conflict");
          }

          const repository = await resolveRepository(tx, exact);
          const source = exact.report.selectedSource!;
          const snapshotKey = {
            repositoryId_commitSha: {
              repositoryId: repository.id,
              commitSha: source.commitSha,
            },
          };
          const storageReport = repositorySnapshotReport(exact);
          const snapshot = await tx.repositorySnapshot.upsert({
            where: snapshotKey,
            update: { sourceTreeSha: source.treeSha },
            create: {
              repositoryId: repository.id,
              commitSha: source.commitSha,
              sourceTreeSha: source.treeSha,
              sourceCreatedAt: source.sourceCreatedAt
                ? new Date(source.sourceCreatedAt)
                : undefined,
              inspectionStatus: exact.report.status,
              inspectionReportJson: canonicalJson(storageReport),
              manifestJson: exact.extraction.manifest
                ? canonicalJson(exact.extraction.manifest)
                : null,
              contentHash: sourceContentHash(exact),
            },
          });
          if (snapshot.sourceTreeSha !== source.treeSha) {
            throw new SubmissionError(
              "Stored snapshot tree does not match the selected commit tree.",
              "conflict",
            );
          }

          const submission = await tx.submission.create({
            data: {
              submitterId: input.submitterId,
              repositoryId: repository.id,
              snapshotId: snapshot.id,
              inspectionCaptureId: locked.id,
              sourceKind: source.kind,
              sourceBranch: source.branch,
              sourceSelectionKey: sourceSelectionKey(source),
              releaseTag: source.releaseTag,
              releaseUrl: source.releaseUrl,
              tagObjectSha: source.tagObjectSha,
              sourceCreatedAt: source.sourceCreatedAt
                ? new Date(source.sourceCreatedAt)
                : undefined,
              status,
              extractedMetadataJson: canonicalJson(exact.extraction.metadata),
              editedMetadataJson: canonicalJson(input.editedMetadata ?? { edits: {} }),
              validationReportJson: canonicalJson(validation),
              publicationConsistencyJson: validation.publicationConsistency
                ? canonicalJson(validation.publicationConsistency)
                : null,
              submittedPayloadJson,
              submittedPayloadHash: sha256(submittedPayloadJson),
              submittedAt: new Date(),
            },
          });
          await tx.inspectionCapture.update({
            where: { id: locked.id },
            data: { consumedAt: new Date() },
          });
          await claimIdempotency(tx, `submission.finalized:${locked.id}`);
          await tx.auditEvent.create({
            data: {
              actorId: input.submitterId,
              action: "submission.finalized",
              subjectType: "submission",
              subjectId: submission.id,
              idempotencyKey: `submission.finalized:${locked.id}`,
              detailsJson: canonicalJson({
                status,
                repository: exact.report.repo.canonicalUrl,
                githubRepositoryId: exact.report.githubRepositoryId,
                commitSha: source.commitSha,
                capturePayloadHash: locked.payloadHash,
              }),
            },
          });
          return { submissionId: submission.id, status };
        },
        { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
      ),
    );

  for (let uniqueAttempt = 0; ; uniqueAttempt += 1) {
    try {
      return await persist();
    } catch (error) {
      if (error instanceof SubmissionError) throw error;
      if (prismaCode(error) !== "P2002") throw error;
      const latestCapture = await prisma.inspectionCapture.findUnique({
        where: { tokenHash },
        include: { submission: true },
      });
      if (latestCapture?.consumedAt || latestCapture?.submission) {
        throw new SubmissionError("Inspection capability has already been consumed.", "conflict");
      }
      if (uniqueAttempt < 2 && isRecoverableSubmissionUniqueConflict(error)) continue;
      throw new SubmissionError(
        `Concurrent repository or snapshot identity conflict (${uniqueTargetLabel(error)}).`,
        "conflict",
      );
    }
  }
}

export class SubmissionError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "SubmissionError";
  }
}

class DecisionRaceError extends SubmissionError {
  constructor() {
    super("Submission decision changed concurrently.", "conflict");
    this.name = "DecisionRaceError";
  }
}

async function readAcceptedResult(
  submissionId: string,
): Promise<{ reviewSlug: string; idempotent: true } | null> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { status: true, resultingReviewId: true },
  });
  if (submission?.status !== "accepted" || !submission.resultingReviewId) return null;
  const review = await prisma.review.findUnique({
    where: { id: submission.resultingReviewId },
    select: { slug: true },
  });
  return review ? { reviewSlug: review.slug, idempotent: true } : null;
}

/**
 * Atomically publish a stored submission. The transaction contains database
 * work only: all GitHub/DOI I/O happened before the submission was finalized.
 */
export async function acceptSubmission(
  submissionId: string,
  reviewerId: string,
  note?: string,
  overrides: EditorialOverrideInput[] = [],
): Promise<{ reviewSlug: string; idempotent: boolean }> {
  const run = () =>
    withSqliteRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const submission = await tx.submission.findUnique({
            where: { id: submissionId },
            include: { repository: true, snapshot: true },
          });
          if (!submission) throw new SubmissionError("Submission not found.");
          if (submission.status === "accepted" && submission.resultingReviewId) {
            const existing = await tx.review.findUnique({
              where: { id: submission.resultingReviewId },
            });
            if (!existing)
              throw new SubmissionError("Accepted submission has no review.", "conflict");
            return { reviewSlug: existing.slug, idempotent: true };
          }
          if (!submission.snapshotId || !submission.snapshot) {
            throw new SubmissionError("Submission has no snapshot to publish.");
          }
          if (!isDecidableStatus(submission.status)) {
            throw new SubmissionError(
              `Submission is already ${submission.status}; acceptance cannot replace that decision.`,
              "conflict",
            );
          }

          const payload = parseStoredSubmissionPayload(submission.submittedPayloadJson);
          if (!payload) {
            throw new SubmissionError(
              "Submission payload is missing or non-canonical.",
              "conflict",
            );
          }
          if (sha256(submission.submittedPayloadJson!) !== submission.submittedPayloadHash) {
            throw new SubmissionError("Submission payload integrity check failed.", "conflict");
          }
          if (payload.validation.hardErrors.length > 0) {
            throw new SubmissionError("Non-overridable automated checks still fail.", "conflict");
          }
          const consistency = payload.validation.publicationConsistency;
          const validatedOverrides = validateOverrides(consistency, overrides);

          const claimed = await tx.submission.updateMany({
            where: { id: submission.id, status: submission.status, resultingReviewVersionId: null },
            data: {
              status: "accepted",
              reviewerId,
              reviewedAt: new Date(),
              editorialNote: note,
            },
          });
          if (claimed.count !== 1) {
            throw new DecisionRaceError();
          }

          for (const override of validatedOverrides) {
            await tx.editorialOverride.create({
              data: {
                submissionId: submission.id,
                checkId: override.checkId,
                rationale: override.rationale,
                editorId: reviewerId,
              },
            });
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
          let review = await tx.review.findUnique({
            where: { repositoryId: submission.repositoryId },
          });
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

          const metadataJson = canonicalJson({
            keywords: meta.keywords,
            domains: meta.domains,
            reviewType: meta.reviewType,
            license: meta.license,
            compatibilityLevel: payload.compatibilityLevel,
            compatibilityReport: payload.compatibilityReport,
            extractorVersion: extracted?.extractorVersion,
            provenance: extracted?.fields,
          });
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
              metadataJson,
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

          await tx.submission.update({
            where: { id: submission.id },
            data: { resultingReviewId: review.id, resultingReviewVersionId: version.id },
          });
          await claimIdempotency(tx, `submission.accepted:${submission.id}`);
          await tx.auditEvent.create({
            data: {
              actorId: reviewerId,
              action: "submission.accepted",
              subjectType: "submission",
              subjectId: submission.id,
              idempotencyKey: `submission.accepted:${submission.id}`,
              detailsJson: canonicalJson({
                reviewSlug: review.slug,
                versionId: version.id,
                overrideCheckIds: validatedOverrides.map((entry) => entry.checkId),
              }),
            },
          });
          await claimIdempotency(tx, `review.published:${submission.id}`);
          await tx.auditEvent.create({
            data: {
              actorId: reviewerId,
              action: "review.published",
              subjectType: "review",
              subjectId: review.id,
              idempotencyKey: `review.published:${submission.id}`,
              detailsJson: canonicalJson({
                versionId: version.id,
                capturePayloadHash: payload.capturePayloadHash,
              }),
            },
          });
          return { reviewSlug: review.slug, idempotent: false };
        },
        { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
      ),
    );

  for (let uniqueAttempt = 0; ; uniqueAttempt += 1) {
    try {
      return await run();
    } catch (error) {
      const accepted = await readAcceptedResult(submissionId);
      if (accepted) return accepted;
      if (error instanceof DecisionRaceError) throw error;
      if (prismaCode(error) === "P2002") {
        const targets = uniqueTargets(error).map((target) => target.toLowerCase());
        const duplicateSelection = targets.some(
          (target) => target.includes("sourceselectionkey") || target.includes("snapshotid"),
        );
        if (duplicateSelection) {
          throw new SubmissionError(
            "This exact repository source selection is already published for the commit.",
            "conflict",
          );
        }
        if (uniqueAttempt < 2) continue;
        throw new SubmissionError(
          `Concurrent review identity conflict (${uniqueTargetLabel(error)}).`,
          "conflict",
        );
      }
      throw error;
    }
  }
}

export async function decideSubmission(
  submissionId: string,
  reviewerId: string,
  decision: "reject" | "request-changes",
  note?: string,
): Promise<{ idempotent: boolean }> {
  const status = decision === "reject" ? "rejected" : "changes-requested";
  return withSqliteRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const current = await tx.submission.findUnique({ where: { id: submissionId } });
        if (!current) throw new SubmissionError("Submission not found.");
        if (current.status === status) return { idempotent: true };
        if (!isDecidableStatus(current.status)) {
          throw new SubmissionError(
            `Submission is already ${current.status}; this decision cannot replace it.`,
            "conflict",
          );
        }
        const changed = await tx.submission.updateMany({
          where: { id: submissionId, status: current.status },
          data: { status, reviewerId, reviewedAt: new Date(), editorialNote: note },
        });
        if (changed.count !== 1) {
          throw new SubmissionError("Submission decision changed concurrently.", "conflict");
        }
        await claimIdempotency(tx, `submission.${decision}:${submissionId}`);
        await tx.auditEvent.create({
          data: {
            actorId: reviewerId,
            action: `submission.${decision}`,
            subjectType: "submission",
            subjectId: submissionId,
            idempotencyKey: `submission.${decision}:${submissionId}`,
            detailsJson: canonicalJson({ note }),
          },
        });
        return { idempotent: false };
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    ),
  );
}

type CaptureRow = {
  payloadJson: string;
  payloadHash: string;
  githubRepositoryId: string;
  canonicalUrlAtCapture: string;
  inspectedByUserId: string;
  commitSha: string;
  releaseTag: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  submission: unknown | null;
};

function assertCaptureUsable(capture: CaptureRow, submitterId: string, now: Date): void {
  if (capture.inspectedByUserId !== submitterId) {
    throw new SubmissionError("Inspection capability belongs to another user.", "conflict");
  }
  if (capture.expiresAt.getTime() <= now.getTime()) {
    throw new SubmissionError("Inspection capability expired; inspect again.", "bad-request");
  }
  if (capture.consumedAt || capture.submission) {
    throw new SubmissionError("Inspection capability has already been consumed.", "conflict");
  }
}

function verifyCapture(capture: CaptureRow): InspectionCapturePayload {
  let payload: InspectionCapturePayload;
  try {
    payload = parseAndVerifyCapture(capture.payloadJson, capture.payloadHash);
  } catch {
    throw new SubmissionError("Inspection capture integrity check failed.", "conflict");
  }
  const source = payload.report.selectedSource;
  if (
    !source ||
    payload.report.githubRepositoryId !== capture.githubRepositoryId ||
    payload.report.repo.canonicalUrl !== capture.canonicalUrlAtCapture ||
    source.commitSha !== capture.commitSha ||
    (source.releaseTag ?? null) !== capture.releaseTag
  ) {
    throw new SubmissionError("Inspection capture identity fields do not match.", "conflict");
  }
  return payload;
}

async function resolveRepository(tx: Prisma.TransactionClient, capture: InspectionCapturePayload) {
  const report = capture.report;
  const githubRepositoryId = report.githubRepositoryId!;
  const byIdentity = await tx.repository.findUnique({ where: { githubRepositoryId } });
  const byUrl = await tx.repository.findUnique({
    where: { canonicalUrl: report.repo.canonicalUrl },
  });
  if (byIdentity && byUrl && byIdentity.id !== byUrl.id) {
    throw new SubmissionError(
      "Repository rename collides with another stored identity.",
      "conflict",
    );
  }
  if (byUrl?.githubRepositoryId && byUrl.githubRepositoryId !== githubRepositoryId) {
    throw new SubmissionError("Repository URL belongs to a different GitHub identity.", "conflict");
  }
  const data = {
    host: "github.com",
    owner: report.repo.owner,
    name: report.repo.name,
    canonicalUrl: report.repo.canonicalUrl,
    githubRepositoryId,
    defaultBranch: report.defaultBranch,
    description: report.description ?? undefined,
    licenseSpdx: report.licenseSpdx ?? undefined,
    topicsJson: canonicalJson(report.topics),
    homepageUrl: report.homepageUrl ?? undefined,
    pagesUrl: report.pagesUrl ?? undefined,
    isArchived: report.isArchived ?? false,
    lastInspectedAt: new Date(report.inspectedAt),
  };
  if (byUrl && !byUrl.githubRepositoryId) {
    return tx.repository.update({ where: { id: byUrl.id }, data });
  }
  return tx.repository.upsert({
    where: { githubRepositoryId },
    update: data,
    create: data,
  });
}

function sourceContentHash(capture: InspectionCapturePayload): string {
  const source = capture.report.selectedSource!;
  const files = Object.fromEntries(
    Object.entries(capture.report.files).map(([path, file]) => [
      path,
      {
        size: file.size,
        truncated: file.truncated,
        contentHash: file.content ? sha256(file.content) : null,
      },
    ]),
  );
  return sha256(
    canonicalJson({
      githubRepositoryId: capture.report.githubRepositoryId,
      commitSha: source.commitSha,
      treeSha: source.treeSha,
      files,
    }),
  );
}

function repositorySnapshotReport(capture: InspectionCapturePayload) {
  const source = capture.report.selectedSource!;
  return {
    schemaVersion: "1.0.0",
    githubRepositoryId: capture.report.githubRepositoryId,
    repositoryUrl: capture.report.repo.canonicalUrl,
    commitSha: source.commitSha,
    treeSha: source.treeSha,
    files: Object.fromEntries(
      Object.entries(capture.report.files).map(([path, file]) => [
        path,
        {
          size: file.size,
          truncated: file.truncated,
          contentHash: file.content ? sha256(file.content) : null,
        },
      ]),
    ),
  };
}

function sourceSelectionKey(source: NonNullable<InspectionReport["selectedSource"]>): string {
  if (source.kind === "default-branch") return `default-branch:${source.branch ?? ""}`;
  return `${source.kind}:${source.releaseTag ?? ""}`;
}

function validateOverrides(
  consistency: PublicationConsistencyReport | undefined,
  overrides: EditorialOverrideInput[],
): EditorialOverrideInput[] {
  const required = new Set(consistency?.overridableCheckIds ?? []);
  const supplied = new Map<string, EditorialOverrideInput>();
  for (const override of overrides) {
    const rationale = override.rationale.trim();
    if (!required.has(override.checkId)) {
      throw new SubmissionError(`Override '${override.checkId}' is not an active failed check.`);
    }
    if (rationale.length < 20 || rationale.length > 4_000) {
      throw new SubmissionError(
        `Override '${override.checkId}' needs a 20–4000 character rationale.`,
      );
    }
    if (supplied.has(override.checkId)) {
      throw new SubmissionError(`Override '${override.checkId}' was supplied more than once.`);
    }
    supplied.set(override.checkId, { checkId: override.checkId, rationale });
  }
  const missing = [...required].filter((checkId) => !supplied.has(checkId));
  if (missing.length > 0) {
    throw new SubmissionError(
      `Explicit editor overrides are required for: ${missing.join(", ")}.`,
      "conflict",
    );
  }
  return [...supplied.values()].sort((a, b) => a.checkId.localeCompare(b.checkId));
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
    const pair = `${trust.claimId}|${trust.citationId}`;
    const relationId = relationIdByPair.get(pair);
    if (!relationId) continue;
    const imported = normalizeImportedTrustRecord(trust, sourceReviewByPair.get(pair) ?? null);
    await tx.trustAssessment.create({
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
  return /10\.5555\//i.test(`${meta.versionDoi ?? ""} ${meta.conceptDoi ?? ""}`);
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

function isDecidableStatus(status: string): boolean {
  return status === "pending-editorial-review" || status === "automated-checks-failed";
}

async function withSqliteRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SubmissionError || attempt >= 3 || !isRetriableSqliteError(error))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}

function isRetriableSqliteError(error: unknown): boolean {
  const code = prismaCode(error);
  const message = error instanceof Error ? error.message : "";
  return code === "P1008" || code === "P2034" || /database is locked|SQLITE_BUSY/i.test(message);
}

function prismaCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function uniqueTargets(error: unknown): string[] {
  if (typeof error !== "object" || error === null || !("meta" in error)) return [];
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String);
  return target === undefined ? [] : [String(target)];
}

function isRecoverableSubmissionUniqueConflict(error: unknown): boolean {
  const targets = uniqueTargets(error).map((target) => target.toLowerCase());
  if (targets.length === 0) return true;
  return targets.some((target) =>
    [
      "githubrepositoryid",
      "canonicalurl",
      "host",
      "owner",
      "name",
      "repositoryid",
      "commitsha",
    ].some((field) => target.includes(field)),
  );
}

function uniqueTargetLabel(error: unknown): string {
  return uniqueTargets(error).join(", ") || "unknown unique target";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseStoredSubmissionPayload(payloadJson: string | null): SubmissionPayload | null {
  if (!payloadJson) return null;
  try {
    const value: unknown = JSON.parse(payloadJson);
    if (canonicalJson(value) !== payloadJson) return null;
    const parsed = submissionPayloadSchema.safeParse(value);
    return parsed.success ? (parsed.data as SubmissionPayload) : null;
  } catch {
    return null;
  }
}

async function claimIdempotency(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.idempotencyKey.create({ data: { key } });
}
