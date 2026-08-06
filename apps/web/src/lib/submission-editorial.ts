import "server-only";
import {
  canonicalJson,
  type ConflictOfInterestOutcomeInput,
  type NodeRelationTrustRecord,
  type PublicationConsistencyReport,
} from "@oratlas/contracts";
import type { Prisma } from "@oratlas/db";
import { prisma } from "./db";
import { BOUNDED_SERIALIZABLE_TRANSACTION_OPTIONS, prismaCode, uniqueTargets } from "./db-retry";
import { directEditorialDecisionHash } from "./decision-provenance";
import { sha256 } from "./hash";
import { parseAndVerifyCapture, type InspectionCapturePayload } from "./inspection-captures";
import { materializeAuthorEdgeProposals } from "./node-edge-lifecycle";
import { materializeSameClaimProposals } from "./node-identity-lifecycle";
import { parseStoredSubmissionPayload, validNodeCandidates } from "./submission-payload";
import {
  materializeKnowledgeNodes,
  materializeNodeRelationTrustAssessments,
  materializeReviewPublication,
} from "./submission-publication";
import {
  type AcceptanceResult,
  type EditorialOverrideInput,
  SubmissionError,
} from "./submission-contract";
import {
  claimSubmissionIdempotency,
  uniqueSubmissionTargetLabel,
  withSubmissionSqliteRetry,
} from "./submission-transaction";

const LEGACY_CONFLICT_OUTCOME: ConflictOfInterestOutcomeInput = {
  conflictOfInterest: { status: "not-provided" },
  administratorOverride: false,
};

class DecisionRaceError extends SubmissionError {
  constructor() {
    super("Submission decision changed concurrently.", "conflict");
    this.name = "DecisionRaceError";
  }
}

async function decisionConflictProvenance(
  tx: Prisma.TransactionClient,
  submission: { id: string; submitterId: string },
  actorId: string,
  input: ConflictOfInterestOutcomeInput,
): Promise<{
  actorGithubLogin: string;
  actorRole: string;
  directlyInvolved: boolean;
  overrideAt: Date | null;
}> {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true, githubLogin: true },
  });
  if (!actor || (actor.role !== "EDITOR" && actor.role !== "ADMIN")) {
    throw new SubmissionError("Editor role required.", "forbidden");
  }
  const authoredReport = await tx.formalReviewReport.findFirst({
    where: { round: { submissionId: submission.id }, reviewerId: actorId },
    select: { id: true },
  });
  const assignment = await tx.editorAssignment.findUnique({
    where: {
      submissionId_editorId: { submissionId: submission.id, editorId: actorId },
    },
    select: { status: true },
  });
  const directlyInvolved = submission.submitterId === actorId || Boolean(authoredReport);
  if (
    assignment?.status === "recused" &&
    !(directlyInvolved && input.administratorOverride && actor.role === "ADMIN")
  ) {
    throw new SubmissionError(
      "A recused editor cannot decide this submission without a ratified administrator override.",
      "forbidden",
    );
  }
  if (directlyInvolved && !input.administratorOverride) {
    throw new SubmissionError(
      "Direct self-involvement requires recusal or an explicit administrator override.",
      "forbidden",
    );
  }
  if (input.administratorOverride) {
    if (!directlyInvolved) {
      throw new SubmissionError(
        "An administrator override is valid only for direct self-involvement.",
      );
    }
    if (actor.role !== "ADMIN") {
      throw new SubmissionError("Administrator role required for a recusal override.", "forbidden");
    }
    if (input.conflictOfInterest.status !== "conflict-declared") {
      throw new SubmissionError("An administrator override requires conflict-declared.");
    }
  }
  return {
    actorGithubLogin: actor.githubLogin,
    actorRole: actor.role,
    directlyInvolved,
    overrideAt: input.administratorOverride ? new Date() : null,
  };
}

async function createDirectDecisionProvenance(
  tx: Prisma.TransactionClient,
  submission: { id: string; submitterId: string },
  actorId: string,
  decision: "accept" | "reject" | "request-changes",
  note: string | undefined,
  input: ConflictOfInterestOutcomeInput,
): Promise<string> {
  const provenance = await decisionConflictProvenance(tx, submission, actorId, input);
  const noteHash = note === undefined ? null : sha256(note);
  const decisionHash = directEditorialDecisionHash({
    submissionId: submission.id,
    actor: { githubLogin: provenance.actorGithubLogin, role: provenance.actorRole },
    decision,
    noteHash,
    conflictOfInterest: input.conflictOfInterest,
    override:
      input.administratorOverride && provenance.overrideAt
        ? {
            administratorGithubLogin: provenance.actorGithubLogin,
            exercisedAt: provenance.overrideAt,
          }
        : null,
  });
  await tx.editorialDecisionProvenance.create({
    data: {
      submissionId: submission.id,
      actorId,
      actorGithubLoginSnapshot: provenance.actorGithubLogin,
      actorRoleSnapshot: provenance.actorRole,
      decision,
      conflictOfInterestStatus: input.conflictOfInterest.status,
      administratorOverride: input.administratorOverride,
      administratorOverrideById: input.administratorOverride ? actorId : null,
      administratorOverrideGithubLoginSnapshot: input.administratorOverride
        ? provenance.actorGithubLogin
        : null,
      administratorOverrideAt: provenance.overrideAt,
      noteHash,
      decisionHash,
    },
  });
  return decisionHash;
}

async function readAcceptedResult(
  submissionId: string,
  selectionHash: string,
  operationHash: string,
): Promise<AcceptanceResult | null> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      status: true,
      resultingReviewId: true,
      acceptedNodeSelectionJson: true,
      acceptedNodeSelectionHash: true,
      sourceNodeVersions: {
        select: { id: true, knowledgeNode: { select: { localNodeId: true } } },
      },
    },
  });
  if (submission?.status !== "accepted") return null;
  const storedSelectionJson = submission.acceptedNodeSelectionJson ?? canonicalJson([]);
  const storedSelectionHash = submission.acceptedNodeSelectionHash ?? sha256(storedSelectionJson);
  if (storedSelectionHash !== selectionHash) {
    throw new SubmissionError(
      "Submission was already accepted with a different node selection.",
      "conflict",
    );
  }
  const claim = await prisma.idempotencyKey.findUnique({
    where: { key: `submission.accepted:${submissionId}` },
    select: { requestHash: true },
  });
  if (claim?.requestHash !== operationHash) {
    throw new SubmissionError(
      "Submission acceptance is bound to a different editor decision payload.",
      "conflict",
    );
  }
  const selectedNodeIds = parseSelectionJson(storedSelectionJson);
  const review = submission.resultingReviewId
    ? await prisma.review.findUnique({
        where: { id: submission.resultingReviewId },
        select: { slug: true },
      })
    : null;
  return {
    reviewSlug: review?.slug,
    nodeVersionIds: [...submission.sourceNodeVersions]
      .sort((left, right) =>
        left.knowledgeNode.localNodeId.localeCompare(right.knowledgeNode.localNodeId),
      )
      .map((version) => version.id),
    selectedNodeIds,
    idempotent: true,
  };
}

/**
 * Atomically publish a stored submission. The transaction contains database
 * work only: all GitHub/DOI I/O happened before the submission was finalized.
 */
export function acceptSubmission(
  submissionId: string,
  reviewerId: string,
  note?: string,
  overrides?: EditorialOverrideInput[],
): Promise<AcceptanceResult & { reviewSlug: string }>;
export function acceptSubmission(
  submissionId: string,
  reviewerId: string,
  note: string | undefined,
  overrides: EditorialOverrideInput[] | undefined,
  selectedNodeIds: string[],
): Promise<AcceptanceResult>;
export function acceptSubmission(
  submissionId: string,
  reviewerId: string,
  note: string | undefined,
  overrides: EditorialOverrideInput[] | undefined,
  selectedNodeIds: string[],
  transactionClient: Prisma.TransactionClient,
  formalRoundId: string,
  conflictOutcome: ConflictOfInterestOutcomeInput,
): Promise<AcceptanceResult>;
export function acceptSubmission(
  submissionId: string,
  reviewerId: string,
  note: string | undefined,
  overrides: EditorialOverrideInput[] | undefined,
  selectedNodeIds: string[],
  transactionClient: Prisma.TransactionClient | undefined,
  formalRoundId: string | undefined,
  conflictOutcome: ConflictOfInterestOutcomeInput,
): Promise<AcceptanceResult>;
export async function acceptSubmission(
  submissionId: string,
  reviewerId: string,
  note?: string,
  overrides: EditorialOverrideInput[] = [],
  selectedNodeIds: string[] = [],
  transactionClient?: Prisma.TransactionClient,
  formalRoundId?: string,
  conflictOutcome: ConflictOfInterestOutcomeInput = LEGACY_CONFLICT_OUTCOME,
): Promise<AcceptanceResult> {
  const requestedSelection = normalizeRequestedSelection(selectedNodeIds);
  const selectionJson = canonicalJson(requestedSelection);
  const selectionHash = sha256(selectionJson);
  const operation = async (tx: Prisma.TransactionClient) => {
    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      include: { repository: true, snapshot: true, inspectionCapture: true },
    });
    if (!submission) throw new SubmissionError("Submission not found.");
    const payload = parseStoredSubmissionPayload(submission.submittedPayloadJson);
    if (!payload) {
      throw new SubmissionError("Submission payload is missing or non-canonical.", "conflict");
    }
    if (sha256(submission.submittedPayloadJson!) !== submission.submittedPayloadHash) {
      throw new SubmissionError("Submission payload integrity check failed.", "conflict");
    }
    const candidates = validNodeCandidates(payload);
    validateRequestedSelection(
      requestedSelection,
      candidates.map((entry) => entry.node.id),
    );
    if (!payload.publicationTargets.proseReview && requestedSelection.length === 0) {
      throw new SubmissionError(
        "A node-only submission must publish at least one node candidate.",
        "conflict",
      );
    }
    const consistency = payload.validation.publicationConsistency;
    const validatedOverrides = validateOverrides(consistency, overrides);
    const operationHash = acceptanceOperationHash(
      reviewerId,
      note,
      validatedOverrides,
      requestedSelection,
      conflictOutcome,
    );
    await assertFormalRoundDecisionScope(tx, submission.id, formalRoundId);
    if (submission.status === "accepted") {
      const storedJson = submission.acceptedNodeSelectionJson ?? canonicalJson([]);
      const storedHash = submission.acceptedNodeSelectionHash ?? sha256(storedJson);
      if (storedHash !== selectionHash) {
        throw new SubmissionError(
          "Submission was already accepted with a different node selection.",
          "conflict",
        );
      }
      await assertIdempotencyBinding(
        tx,
        `submission.accepted:${submission.id}`,
        operationHash,
        "Submission acceptance is bound to a different editor decision payload.",
      );
      return acceptedResultInTransaction(tx, submission.id, storedJson, true);
    }
    if (!submission.snapshotId || !submission.snapshot) {
      throw new SubmissionError("Submission has no snapshot to publish.");
    }
    if (
      payload.schemaVersion === "1.1.0" &&
      (!submission.inspectionCaptureId || !submission.inspectionCapture)
    ) {
      throw new SubmissionError("Submission has no inspection capture to publish.");
    }
    if (!isDecidableStatus(submission.status)) {
      throw new SubmissionError(
        `Submission is already ${submission.status}; acceptance cannot replace that decision.`,
        "conflict",
      );
    }
    if (!formalRoundId) {
      await decisionConflictProvenance(tx, submission, reviewerId, conflictOutcome);
    }
    if (submission.inspectionCapture) {
      const captured = verifyStoredCaptureForAcceptance(submission.inspectionCapture);
      if (
        payload.capturePayloadHash !== submission.inspectionCapture.payloadHash ||
        (payload.publicationTargets.knowledgeNodes &&
          canonicalJson(payload.nodeExtraction) !==
            canonicalJson(captured.extraction.nodeExtraction)) ||
        (payload.nodeExtraction.commitSha !== undefined &&
          payload.nodeExtraction.commitSha !== submission.snapshot.commitSha)
      ) {
        throw new SubmissionError(
          "Submitted node candidates do not match the immutable inspection capture.",
          "conflict",
        );
      }
    }
    if (payload.validation.hardErrors.length > 0) {
      throw new SubmissionError("Non-overridable automated checks still fail.", "conflict");
    }
    const claimed = await tx.submission.updateMany({
      where: { id: submission.id, status: submission.status },
      data: {
        status: "accepted",
        reviewerId,
        reviewedAt: new Date(),
        editorialNote: note,
        acceptedNodeSelectionJson: selectionJson,
        acceptedNodeSelectionHash: selectionHash,
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

    let reviewSlug: string | undefined;
    let reviewId: string | undefined;
    let reviewVersionId: string | undefined;
    if (payload.publicationTargets.proseReview) {
      const materializedReview = await materializeReviewPublication(
        tx,
        submission,
        payload,
        consistency,
      );
      reviewSlug = materializedReview.slug;
      reviewId = materializedReview.reviewId;
      reviewVersionId = materializedReview.versionId;
    }

    const selected = new Set(requestedSelection);
    const selectedCandidates = candidates.filter((entry) => selected.has(entry.node.id));
    const nodeVersionIds = await materializeKnowledgeNodes(
      tx,
      submission,
      selectedCandidates,
      reviewerId,
      reviewVersionId,
    );
    const publishedNodeIds = (
      await tx.knowledgeNodeVersion.findMany({
        where: { id: { in: nodeVersionIds } },
        select: { knowledgeNodeId: true },
      })
    ).map((version) => version.knowledgeNodeId);
    const identityProposalIds = await materializeSameClaimProposals(tx, publishedNodeIds);
    const nodeTrustRecords = payload.knowledge.trust.filter(
      (record): record is NodeRelationTrustRecord => "subjectType" in record,
    );
    let edgeProposalIds: string[] = [];
    let nodeTrustAssessmentIds: string[] = [];
    if (
      submission.inspectionCaptureId &&
      submission.inspectionCapture &&
      nodeVersionIds.length > 0
    ) {
      const selectedVersions = await tx.knowledgeNodeVersion.findMany({
        where: { id: { in: nodeVersionIds } },
        include: { knowledgeNode: true },
      });
      edgeProposalIds = await materializeAuthorEdgeProposals(tx, {
        submissionId: submission.id,
        submitterId: submission.submitterId,
        inspectionCaptureId: submission.inspectionCaptureId,
        capturePayloadHash: submission.inspectionCapture.payloadHash,
        sourceRepositoryGithubId: submission.repository.githubRepositoryId,
        sourceCommitSha: submission.snapshot.commitSha,
        edges: payload.nodeExtraction.edges,
        selectedVersions: selectedVersions.map((version) => ({
          id: version.id,
          knowledgeNodeId: version.knowledgeNodeId,
          localNodeId: version.knowledgeNode.localNodeId,
          kind: version.knowledgeNode.kind,
        })),
      });
      nodeTrustAssessmentIds = await materializeNodeRelationTrustAssessments(
        tx,
        nodeTrustRecords,
        edgeProposalIds,
        {
          submissionId: submission.id,
          inspectionCaptureId: submission.inspectionCaptureId,
          sourceRepositoryGithubId: submission.repository.githubRepositoryId,
          sourceCommitSha: submission.snapshot.commitSha,
        },
      );
    }

    if (reviewId && reviewVersionId) {
      await tx.submission.update({
        where: { id: submission.id },
        data: { resultingReviewId: reviewId, resultingReviewVersionId: reviewVersionId },
      });
    }
    await claimSubmissionIdempotency(tx, `submission.accepted:${submission.id}`, operationHash);
    const decisionHash = formalRoundId
      ? undefined
      : await createDirectDecisionProvenance(
          tx,
          submission,
          reviewerId,
          "accept",
          note,
          conflictOutcome,
        );
    await tx.auditEvent.create({
      data: {
        actorId: reviewerId,
        action: "submission.accepted",
        subjectType: "submission",
        subjectId: submission.id,
        idempotencyKey: `submission.accepted:${submission.id}`,
        detailsJson: canonicalJson({
          reviewSlug,
          reviewVersionId,
          selectedNodeIds: requestedSelection,
          nodeVersionIds,
          identityProposalIds,
          edgeProposalIds,
          nodeTrustAssessmentIds,
          overrideCheckIds: validatedOverrides.map((entry) => entry.checkId),
          conflictOfInterest: conflictOutcome.conflictOfInterest,
          administratorOverride: conflictOutcome.administratorOverride,
          decisionHash,
        }),
      },
    });
    if (reviewId && reviewVersionId) {
      await claimSubmissionIdempotency(tx, `review.published:${submission.id}`);
      await tx.auditEvent.create({
        data: {
          actorId: reviewerId,
          action: "review.published",
          subjectType: "review",
          subjectId: reviewId,
          idempotencyKey: `review.published:${submission.id}`,
          detailsJson: canonicalJson({
            versionId: reviewVersionId,
            capturePayloadHash: payload.capturePayloadHash,
          }),
        },
      });
    }
    return {
      reviewSlug,
      nodeVersionIds,
      selectedNodeIds: requestedSelection,
      idempotent: false,
    };
  };
  const run = () =>
    transactionClient
      ? operation(transactionClient)
      : withSubmissionSqliteRetry(() =>
          prisma.$transaction(operation, BOUNDED_SERIALIZABLE_TRANSACTION_OPTIONS),
        );

  if (transactionClient) return run();

  for (let uniqueAttempt = 0; ; uniqueAttempt += 1) {
    try {
      return await run();
    } catch (error) {
      const operationHash = acceptanceOperationHash(
        reviewerId,
        note,
        overrides,
        requestedSelection,
        conflictOutcome,
      );
      const accepted = await readAcceptedResult(submissionId, selectionHash, operationHash);
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
          `Concurrent review identity conflict (${uniqueSubmissionTargetLabel(error)}).`,
          "conflict",
        );
      }
      throw error;
    }
  }
}

export function acceptSubmissionInTransaction(
  tx: Prisma.TransactionClient,
  submissionId: string,
  reviewerId: string,
  note: string | undefined,
  overrides: EditorialOverrideInput[],
  selectedNodeIds: string[],
  formalRoundId: string,
  conflictOutcome: ConflictOfInterestOutcomeInput,
): Promise<AcceptanceResult> {
  return acceptSubmission(
    submissionId,
    reviewerId,
    note,
    overrides,
    selectedNodeIds,
    tx,
    formalRoundId,
    conflictOutcome,
  );
}

function normalizeRequestedSelection(selectedNodeIds: string[]): string[] {
  if (selectedNodeIds.length > 5_000) {
    throw new SubmissionError("At most 5000 node candidates can be selected.");
  }
  const normalized = selectedNodeIds.map((id) => id.trim());
  if (normalized.some((id) => id.length === 0)) {
    throw new SubmissionError("Selected node ids cannot be empty.");
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new SubmissionError("Selected node ids must be unique.");
  }
  return normalized.sort((a, b) => a.localeCompare(b));
}

function acceptanceOperationHash(
  reviewerId: string,
  note: string | undefined,
  overrides: EditorialOverrideInput[],
  selectedNodeIds: string[],
  conflictOutcome: ConflictOfInterestOutcomeInput,
): string {
  return sha256(
    canonicalJson({
      reviewerId,
      note: note ?? null,
      overrides: [...overrides].sort(
        (left, right) =>
          left.checkId.localeCompare(right.checkId) ||
          left.rationale.localeCompare(right.rationale),
      ),
      selectedNodeIds,
      conflictOfInterest: conflictOutcome.conflictOfInterest,
      administratorOverride: conflictOutcome.administratorOverride,
    }),
  );
}

async function assertFormalRoundDecisionScope(
  tx: Prisma.TransactionClient,
  submissionId: string,
  formalRoundId?: string,
): Promise<void> {
  const openRound = await tx.reviewRound.findFirst({
    where: { submissionId, status: "open" },
    select: { id: true },
  });
  if (formalRoundId) {
    if (openRound?.id !== formalRoundId) {
      throw new SubmissionError("The formal review round is no longer open.", "conflict");
    }
    return;
  }
  if (openRound) {
    throw new SubmissionError(
      "This submission has an open formal review round; issue its decision with a decision letter.",
      "conflict",
    );
  }
}

async function assertIdempotencyBinding(
  tx: Prisma.TransactionClient,
  key: string,
  requestHash: string,
  conflictMessage: string,
): Promise<void> {
  const claim = await tx.idempotencyKey.findUnique({ where: { key } });
  if (claim?.requestHash !== requestHash) {
    throw new SubmissionError(conflictMessage, "conflict");
  }
}

function validateRequestedSelection(selection: string[], candidateIds: string[]): void {
  const candidates = new Set(candidateIds);
  const unknown = selection.filter((id) => !candidates.has(id));
  if (unknown.length > 0) {
    throw new SubmissionError(
      `Selected node ids are not candidates from this capture: ${unknown.join(", ")}.`,
      "conflict",
    );
  }
}

function parseSelectionJson(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some((entry) => typeof entry !== "string") ||
      canonicalJson(parsed) !== value
    ) {
      throw new Error("invalid selection");
    }
    return parsed;
  } catch {
    throw new SubmissionError("Accepted node selection is invalid.", "conflict");
  }
}

async function acceptedResultInTransaction(
  tx: Prisma.TransactionClient,
  submissionId: string,
  selectionJson: string,
  idempotent: boolean,
): Promise<AcceptanceResult> {
  const accepted = await tx.submission.findUnique({
    where: { id: submissionId },
    select: {
      resultingReviewId: true,
      sourceNodeVersions: {
        select: { id: true, knowledgeNode: { select: { localNodeId: true } } },
      },
    },
  });
  if (!accepted) throw new SubmissionError("Submission not found.");
  const review = accepted.resultingReviewId
    ? await tx.review.findUnique({
        where: { id: accepted.resultingReviewId },
        select: { slug: true },
      })
    : null;
  const versions = [...accepted.sourceNodeVersions].sort((left, right) =>
    left.knowledgeNode.localNodeId.localeCompare(right.knowledgeNode.localNodeId),
  );
  return {
    reviewSlug: review?.slug,
    nodeVersionIds: versions.map((version) => version.id),
    selectedNodeIds: parseSelectionJson(selectionJson),
    idempotent,
  };
}

function verifyStoredCaptureForAcceptance(capture: {
  payloadJson: string;
  payloadHash: string;
}): InspectionCapturePayload {
  try {
    return parseAndVerifyCapture(capture.payloadJson, capture.payloadHash);
  } catch {
    throw new SubmissionError("Inspection capture integrity check failed.", "conflict");
  }
}

export async function decideSubmission(
  submissionId: string,
  reviewerId: string,
  decision: "reject" | "request-changes",
  note?: string,
  transactionClient?: Prisma.TransactionClient,
  formalRoundId?: string,
  conflictOutcome: ConflictOfInterestOutcomeInput = LEGACY_CONFLICT_OUTCOME,
): Promise<{ idempotent: boolean }> {
  const status = decision === "reject" ? "rejected" : "changes-requested";
  const operationHash = sha256(
    canonicalJson({
      reviewerId,
      decision,
      note: note ?? null,
      conflictOfInterest: conflictOutcome.conflictOfInterest,
      administratorOverride: conflictOutcome.administratorOverride,
    }),
  );
  const operation = async (tx: Prisma.TransactionClient) => {
    const current = await tx.submission.findUnique({ where: { id: submissionId } });
    if (!current) throw new SubmissionError("Submission not found.");
    await assertFormalRoundDecisionScope(tx, submissionId, formalRoundId);
    if (current.status === status) {
      await assertIdempotencyBinding(
        tx,
        `submission.${decision}:${submissionId}`,
        operationHash,
        "Submission decision is bound to a different editor decision payload.",
      );
      return { idempotent: true };
    }
    if (!isDecidableStatus(current.status)) {
      throw new SubmissionError(
        `Submission is already ${current.status}; this decision cannot replace it.`,
        "conflict",
      );
    }
    if (!formalRoundId) {
      await decisionConflictProvenance(tx, current, reviewerId, conflictOutcome);
    }
    const changed = await tx.submission.updateMany({
      where: { id: submissionId, status: current.status },
      data: { status, reviewerId, reviewedAt: new Date(), editorialNote: note },
    });
    if (changed.count !== 1) {
      throw new SubmissionError("Submission decision changed concurrently.", "conflict");
    }
    await claimSubmissionIdempotency(tx, `submission.${decision}:${submissionId}`, operationHash);
    const decisionHash = formalRoundId
      ? undefined
      : await createDirectDecisionProvenance(
          tx,
          current,
          reviewerId,
          decision,
          note,
          conflictOutcome,
        );
    await tx.auditEvent.create({
      data: {
        actorId: reviewerId,
        action: `submission.${decision}`,
        subjectType: "submission",
        subjectId: submissionId,
        idempotencyKey: `submission.${decision}:${submissionId}`,
        detailsJson: canonicalJson({
          note,
          conflictOfInterest: conflictOutcome.conflictOfInterest,
          administratorOverride: conflictOutcome.administratorOverride,
          decisionHash,
        }),
      },
    });
    return { idempotent: false };
  };
  if (transactionClient) return operation(transactionClient);
  return withSubmissionSqliteRetry(() =>
    prisma.$transaction(operation, BOUNDED_SERIALIZABLE_TRANSACTION_OPTIONS),
  );
}

export function decideSubmissionInTransaction(
  tx: Prisma.TransactionClient,
  submissionId: string,
  reviewerId: string,
  decision: "reject" | "request-changes",
  note: string | undefined,
  formalRoundId: string,
  conflictOutcome: ConflictOfInterestOutcomeInput,
): Promise<{ idempotent: boolean }> {
  return decideSubmission(
    submissionId,
    reviewerId,
    decision,
    note,
    tx,
    formalRoundId,
    conflictOutcome,
  );
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

function isDecidableStatus(status: string): boolean {
  return status === "pending-editorial-review" || status === "automated-checks-failed";
}
