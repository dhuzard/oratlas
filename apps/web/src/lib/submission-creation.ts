import "server-only";
import {
  canonicalJson,
  resolveEffectiveMetadata,
  type EditedMetadata,
  type EffectiveMetadata,
  type ExtractedMetadata,
  type InspectionReport,
  type PreservedFiles,
  type SnapshotStorageReport,
} from "@oratlas/contracts";
import type { Prisma } from "@oratlas/db";
import { normalizeDoi } from "@oratlas/zenodo";
import { prisma } from "./db";
import { BOUNDED_SERIALIZABLE_TRANSACTION_OPTIONS, prismaCode, uniqueTargets } from "./db-retry";
import { sha256 } from "./hash";
import { buildValidationReport } from "./ingest";
import {
  hashInspectionToken,
  parseAndVerifyCapture,
  type InspectionCapturePayload,
} from "./inspection-captures";
import { derivePublicationTargets, type SubmissionPayload } from "./submission-payload";
import {
  type CreateSubmissionInput,
  type CreateSubmissionResult,
  SubmissionError,
} from "./submission-contract";
import {
  claimSubmissionIdempotency,
  uniqueSubmissionTargetLabel,
  withSubmissionSqliteRetry,
} from "./submission-transaction";

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
  const editedMetadata = normalizeSubmissionMetadata(input.editedMetadata);
  const effective = resolveSubmissionMetadata(captured.extraction.metadata, editedMetadata);
  const knowledge = captured.extraction.knowledge;
  const nodeCandidates = captured.extraction.nodeExtraction.nodes.filter(
    (record) => record.status === "ok" && Boolean(record.node),
  );
  const publicationTargets = derivePublicationTargets(
    captured.extraction.compatibility.reviewContentDetected.detected,
    captured.extraction.manifestPresent,
    knowledge.claims.length,
    knowledge.citations.length,
    nodeCandidates.length,
  );
  const validation = await buildValidationReport(
    captured.report,
    captured.extraction.compatibility,
    captured.extraction.metadata,
    editedMetadata,
    knowledge.claims.length > 0 && knowledge.citations.length > 0,
    knowledge.trust.length > 0,
    publicationTargets.knowledgeNodes,
  );
  const status =
    validation.hardErrors.length > 0 || validation.publicationConsistency?.status === "fail"
      ? "automated-checks-failed"
      : "pending-editorial-review";
  const submittedPayload: SubmissionPayload = {
    schemaVersion: "1.1.0",
    capturePayloadHash: capture.payloadHash,
    effectiveMetadata: effective,
    compatibilityLevel: captured.extraction.compatibility.overallCompatibility,
    compatibilityReport: captured.extraction.compatibility,
    validation,
    knowledge,
    nodeExtraction: captured.extraction.nodeExtraction,
    publicationTargets,
    sourceAssessmentDocuments: captured.extraction.sourceAssessmentDocuments,
  };
  const submittedPayloadJson = canonicalJson(submittedPayload);

  const persist = () =>
    withSubmissionSqliteRetry(() =>
      prisma.$transaction(async (tx) => {
        const locked = await tx.inspectionCapture.findUnique({
          where: { tokenHash },
          include: { submission: true },
        });
        if (!locked) throw new SubmissionError("Inspection capability is invalid.", "bad-request");
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
        // Preserved content is copied to the durable snapshot here; the
        // inspection capture row is an expiring capability, never the
        // archive's only copy of accepted file bytes.
        const preservedFilesJson = canonicalJson(preservedFilesFromCapture(exact));
        const snapshot = await tx.repositorySnapshot.upsert({
          where: snapshotKey,
          update: { sourceTreeSha: source.treeSha, preservedFilesJson },
          create: {
            repositoryId: repository.id,
            commitSha: source.commitSha,
            sourceTreeSha: source.treeSha,
            sourceCreatedAt: source.sourceCreatedAt ? new Date(source.sourceCreatedAt) : undefined,
            inspectionStatus: exact.report.status,
            inspectionReportJson: canonicalJson(storageReport),
            manifestJson: exact.extraction.manifest
              ? canonicalJson(exact.extraction.manifest)
              : null,
            preservedFilesJson,
            contentHash: sourceContentHash(exact),
          },
        });
        if (snapshot.sourceTreeSha !== source.treeSha) {
          throw new SubmissionError(
            "Stored snapshot tree does not match the selected commit tree.",
            "conflict",
          );
        }

        let previous = null;
        if (input.previousSubmissionId) {
          previous = await tx.submission.findUnique({
            where: { id: input.previousSubmissionId },
            include: { editorAssignments: true },
          });
          if (!previous) {
            throw new SubmissionError("Previous submission not found.", "bad-request");
          }
          if (previous.submitterId !== input.submitterId) {
            throw new SubmissionError(
              "A resubmission must come from the original submitter.",
              "conflict",
            );
          }
          if (previous.repositoryId !== repository.id) {
            throw new SubmissionError(
              "A resubmission must target the same repository.",
              "conflict",
            );
          }
          if (previous.status !== "changes-requested") {
            throw new SubmissionError(
              `Only a changes-requested submission can be resubmitted (currently ${previous.status}).`,
              "conflict",
            );
          }
        }

        const submission = await tx.submission.create({
          data: {
            submitterId: input.submitterId,
            repositoryId: repository.id,
            snapshotId: snapshot.id,
            inspectionCaptureId: locked.id,
            previousSubmissionId: previous?.id,
            sourceKind: source.kind,
            sourceBranch: source.branch,
            sourceSelectionKey: sourceSelectionKey(source),
            releaseTag: source.releaseTag,
            releaseUrl: source.releaseUrl,
            tagObjectSha: source.tagObjectSha,
            sourceCreatedAt: source.sourceCreatedAt ? new Date(source.sourceCreatedAt) : undefined,
            status,
            extractedMetadataJson: canonicalJson(exact.extraction.metadata),
            editedMetadataJson: canonicalJson(editedMetadata ?? { edits: {} }),
            validationReportJson: canonicalJson(validation),
            publicationConsistencyJson: validation.publicationConsistency
              ? canonicalJson(validation.publicationConsistency)
              : null,
            submittedPayloadJson,
            submittedPayloadHash: sha256(submittedPayloadJson),
            submittedAt: new Date(),
          },
        });
        if (previous) {
          // The revision replaces the changes-requested submission and the
          // editorial team carries over with continuity notifications.
          const superseded = await tx.submission.updateMany({
            where: { id: previous.id, status: "changes-requested" },
            data: { status: "superseded" },
          });
          if (superseded.count !== 1) {
            throw new SubmissionError("Previous submission changed concurrently.", "conflict");
          }
          for (const assignment of previous.editorAssignments) {
            if (assignment.status !== "active") continue;
            await tx.editorAssignment.create({
              data: {
                submissionId: submission.id,
                editorId: assignment.editorId,
                assignedById: assignment.assignedById,
                status: "active",
                coiDeclared: assignment.coiDeclared,
                coiStatement: assignment.coiStatement,
              },
            });
            await tx.notification.create({
              data: {
                userId: assignment.editorId,
                kind: "submission-resubmitted",
                subjectType: "submission",
                subjectId: submission.id,
                payloadJson: canonicalJson({ previousSubmissionId: previous.id }),
              },
            });
          }
        }
        await tx.inspectionCapture.update({
          where: { id: locked.id },
          data: { consumedAt: new Date() },
        });
        await claimSubmissionIdempotency(tx, `submission.finalized:${locked.id}`);
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
              previousSubmissionId: previous?.id,
            }),
          },
        });
        return { submissionId: submission.id, status };
      }, BOUNDED_SERIALIZABLE_TRANSACTION_OPTIONS),
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
        `Concurrent repository or snapshot identity conflict (${uniqueSubmissionTargetLabel(error)}).`,
        "conflict",
      );
    }
  }
}

function normalizeSubmissionMetadata(
  edited: EditedMetadata | undefined,
): EditedMetadata | undefined {
  if (!edited) return undefined;
  const edits: EditedMetadata["edits"] = {};
  for (const [key, edit] of Object.entries(edited.edits)) {
    let value = edit.value;
    if (key === "versionDoi" || key === "conceptDoi") {
      if (typeof value !== "string") {
        throw new SubmissionError(`${doiFieldLabel(key)} must be a DOI string.`, "bad-request");
      }
      const normalized = normalizeDoi(value);
      if (!normalized.ok || !normalized.doi) {
        throw new SubmissionError(
          `${doiFieldLabel(key)} is invalid. Enter a DOI such as 10.5281/zenodo.21549715.`,
          "bad-request",
        );
      }
      value = normalized.doi;
    } else if (key === "zenodoRecordId") {
      if (typeof value !== "string") {
        throw new SubmissionError("Zenodo record must be a numeric record id.", "bad-request");
      }
      const recordId = zenodoRecordIdInput(value);
      if (!recordId) {
        throw new SubmissionError(
          "Zenodo record is invalid. Enter the numeric id or a Zenodo record URL.",
          "bad-request",
        );
      }
      value = recordId;
    }
    edits[key] = { ...edit, value };
  }
  return { edits };
}

function resolveSubmissionMetadata(
  extracted: ExtractedMetadata,
  edited: EditedMetadata | undefined,
): EffectiveMetadata {
  try {
    return resolveEffectiveMetadata(extracted, edited);
  } catch {
    throw new SubmissionError(
      "Edited metadata is invalid. Check the highlighted metadata fields and inspect again.",
      "bad-request",
    );
  }
}

function doiFieldLabel(key: "versionDoi" | "conceptDoi"): string {
  return key === "versionDoi" ? "Version DOI" : "Concept DOI";
}

function zenodoRecordIdInput(value: string): string | undefined {
  const input = value.trim();
  if (/^\d+$/.test(input)) return input;
  const doi = normalizeDoi(input);
  const doiMatch = doi.ok && doi.doi ? /^10\.5281\/zenodo\.(\d+)$/i.exec(doi.doi) : null;
  if (doiMatch?.[1]) return doiMatch[1];
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "zenodo.org") return undefined;
    const match = /^\/records\/(\d+)\/?$/.exec(url.pathname);
    return match?.[1];
  } catch {
    return undefined;
  }
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
        contentHash: file.content !== undefined ? sha256(file.content) : null,
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

function repositorySnapshotReport(capture: InspectionCapturePayload): SnapshotStorageReport {
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
          contentHash: file.content !== undefined ? sha256(file.content) : null,
        },
      ]),
    ),
  };
}

function preservedFilesFromCapture(capture: InspectionCapturePayload): PreservedFiles {
  const out: PreservedFiles = {};
  for (const [path, file] of Object.entries(capture.report.files)) {
    if (file.content === undefined) continue;
    out[path] = { size: file.size, truncated: file.truncated, content: file.content };
  }
  return out;
}

function sourceSelectionKey(source: NonNullable<InspectionReport["selectedSource"]>): string {
  if (source.kind === "default-branch") return `default-branch:${source.branch ?? ""}`;
  return `${source.kind}:${source.releaseTag ?? ""}`;
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
