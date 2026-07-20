import "server-only";
import {
  authorResponseBodySchema,
  canonicalJson,
  conflictOfInterestSchema,
  decisionLetterBodySchema,
  formalReviewReportBodySchema,
  orcidSchema,
  reviewRecommendationSchema,
  roundDecisionSchema,
  type AuthorResponseBody,
  type ConflictOfInterest,
  type DecisionLetterBody,
  type FormalReviewReportBody,
  type NotificationKind,
  type ReviewRecommendation,
  type RoundDecision,
} from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";
import { prisma } from "./db";
import { prismaCode, withSqliteRetry as sharedWithSqliteRetry } from "./db-retry";
import { sha256 } from "./hash";
import {
  acceptSubmissionInTransaction,
  decideSubmissionInTransaction,
  SubmissionError,
  type EditorialOverrideInput,
} from "./submissions";
import { parseStoredSubmissionPayload, validNodeCandidates } from "./submission-payload";

/**
 * Formal editorial-review lifecycle (issue #6). Archive acceptance stays
 * distinct from peer review: these records document the open, attributable
 * process around a submission. Reports, responses and decision letters are
 * append-only — there is no update or delete path — and every write carries
 * an audit event.
 */

export class LifecycleError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "forbidden" | "not-found" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "LifecycleError";
  }
}

export interface Actor {
  id: string;
  role: string;
}

function isEditorRole(role: string): boolean {
  return role === "EDITOR" || role === "ADMIN";
}

function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  return sharedWithSqliteRetry(
    operation,
    (error) => error instanceof LifecycleError || error instanceof SubmissionError,
  );
}

const ASSIGNABLE_STATUSES = new Set([
  "submitted",
  "automated-checks-failed",
  "pending-editorial-review",
  "changes-requested",
]);

async function notify(
  tx: Prisma.TransactionClient,
  userIds: string[],
  kind: NotificationKind,
  subjectType: string,
  subjectId: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  for (const userId of new Set(userIds)) {
    await tx.notification.create({
      data: { userId, kind, subjectType, subjectId, payloadJson: canonicalJson(payload) },
    });
  }
}

async function audit(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  details: Record<string, unknown>,
  idempotencyKey?: string,
  requestHash?: string,
): Promise<void> {
  if (idempotencyKey) {
    await tx.idempotencyKey.create({ data: { key: idempotencyKey, requestHash } });
  }
  await tx.auditEvent.create({
    data: {
      actorId,
      action,
      subjectType,
      subjectId,
      idempotencyKey,
      detailsJson: canonicalJson(details),
    },
  });
}

async function activeEditorIds(
  tx: Prisma.TransactionClient,
  submissionId: string,
): Promise<string[]> {
  const assignments = await tx.editorAssignment.findMany({
    where: { submissionId, status: "active" },
    select: { editorId: true },
  });
  return assignments.map((assignment) => assignment.editorId);
}

/** Assign an editor. A declared conflict records the assignment as recused. */
export async function assignEditor(
  actor: Actor,
  submissionId: string,
  editorId: string,
  coi: ConflictOfInterest,
): Promise<{ assignmentId: string; status: string }> {
  if (!isEditorRole(actor.role)) {
    throw new LifecycleError("Editor role required.", "forbidden");
  }
  const parsedCoi = conflictOfInterestSchema.parse(coi);
  if (parsedCoi.declared && parsedCoi.statement.trim().length < 10) {
    throw new LifecycleError("A declared conflict needs a statement (≥10 characters).");
  }
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const submission = await tx.submission.findUnique({ where: { id: submissionId } });
        if (!submission) throw new LifecycleError("Submission not found.", "not-found");
        if (!ASSIGNABLE_STATUSES.has(submission.status)) {
          throw new LifecycleError(
            `Submission is ${submission.status}; editors can no longer be assigned.`,
            "conflict",
          );
        }
        const editor = await tx.user.findUnique({ where: { id: editorId } });
        if (!editor || !isEditorRole(editor.role)) {
          throw new LifecycleError("Assignee must hold the editor role.");
        }
        if (editorId === submission.submitterId) {
          throw new LifecycleError(
            "An editor can never be assigned to their own submission.",
            "conflict",
          );
        }
        const status = parsedCoi.declared ? "recused" : "active";
        let assignment;
        try {
          assignment = await tx.editorAssignment.create({
            data: {
              submissionId,
              editorId,
              assignedById: actor.id,
              status,
              coiDeclared: parsedCoi.declared,
              coiStatement: parsedCoi.statement || null,
            },
          });
        } catch (error) {
          if (prismaCode(error) === "P2002") {
            throw new LifecycleError(
              "This editor is already assigned to the submission.",
              "conflict",
            );
          }
          throw error;
        }
        await audit(tx, actor.id, "editorial.editor-assigned", "submission", submissionId, {
          editorLogin: editor.githubLogin,
          status,
          coiDeclared: parsedCoi.declared,
        });
        await notify(
          tx,
          [editorId],
          parsedCoi.declared ? "editor-recused" : "editor-assigned",
          "submission",
          submissionId,
          { assignedBy: actor.id },
        );
        return { assignmentId: assignment.id, status };
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    ),
  );
}

/** Recuse an active assignment (the editor themselves, or an admin). */
export async function recuseEditor(
  actor: Actor,
  assignmentId: string,
  statement: string,
): Promise<void> {
  const trimmed = statement.trim();
  if (trimmed.length < 10 || trimmed.length > 2_000) {
    throw new LifecycleError("A recusal statement of 10–2000 characters is required.");
  }
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const assignment = await tx.editorAssignment.findUnique({ where: { id: assignmentId } });
        if (!assignment) throw new LifecycleError("Assignment not found.", "not-found");
        if (assignment.editorId !== actor.id && actor.role !== "ADMIN") {
          throw new LifecycleError("Only the assigned editor or an admin can recuse.", "forbidden");
        }
        const changed = await tx.editorAssignment.updateMany({
          where: { id: assignmentId, status: "active" },
          data: { status: "recused", coiDeclared: true, coiStatement: trimmed },
        });
        if (changed.count !== 1) {
          throw new LifecycleError("Only an active assignment can be recused.", "conflict");
        }
        await audit(
          tx,
          actor.id,
          "editorial.editor-recused",
          "submission",
          assignment.submissionId,
          { assignmentId },
        );
        await notify(
          tx,
          [assignment.assignedById],
          "editor-recused",
          "submission",
          assignment.submissionId,
          {
            assignmentId,
          },
        );
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    ),
  );
}

/** Open the next numbered review round. Active assigned editors only. */
export async function openReviewRound(
  actor: Actor,
  submissionId: string,
): Promise<{ roundId: string; roundNumber: number }> {
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const submission = await tx.submission.findUnique({
          where: { id: submissionId },
          include: { submitter: true },
        });
        if (!submission) throw new LifecycleError("Submission not found.", "not-found");
        if (submission.status !== "pending-editorial-review") {
          throw new LifecycleError(
            `Rounds can only open while a submission is pending editorial review (currently ${submission.status}).`,
            "conflict",
          );
        }
        const assignment = await tx.editorAssignment.findUnique({
          where: { submissionId_editorId: { submissionId, editorId: actor.id } },
        });
        if (assignment?.status !== "active") {
          throw new LifecycleError(
            "Only an actively assigned, non-recused editor can open a round.",
            "forbidden",
          );
        }
        const openRound = await tx.reviewRound.findFirst({
          where: { submissionId, status: "open" },
        });
        if (openRound) {
          throw new LifecycleError("A round is already open for this submission.", "conflict");
        }
        const roundNumber = (await tx.reviewRound.count({ where: { submissionId } })) + 1;
        const round = await tx.reviewRound.create({
          data: { submissionId, roundNumber, openedById: actor.id },
        });
        await audit(tx, actor.id, "editorial.round-opened", "submission", submissionId, {
          roundId: round.id,
          roundNumber,
        });
        await notify(tx, [submission.submitterId], "round-opened", "review-round", round.id, {
          roundNumber,
        });
        return { roundId: round.id, roundNumber };
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    ),
  );
}

/**
 * Submit an immutable formal review report. One per reviewer per round;
 * neither the submitter nor an assigned editor of the submission may review.
 */
export async function submitReviewReport(
  actor: Actor,
  roundId: string,
  recommendation: ReviewRecommendation,
  body: FormalReviewReportBody,
  coiStatement?: string,
): Promise<{ reportId: string; bodyHash: string }> {
  const parsedRecommendation = reviewRecommendationSchema.parse(recommendation);
  const parsedBody = formalReviewReportBodySchema.parse(body);
  const bodyJson = canonicalJson(parsedBody);
  const bodyHash = sha256(bodyJson);
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const round = await tx.reviewRound.findUnique({
          where: { id: roundId },
          include: { submission: true },
        });
        if (!round) throw new LifecycleError("Review round not found.", "not-found");
        if (round.status !== "open") {
          throw new LifecycleError("This round is decided; reports are closed.", "conflict");
        }
        if (round.submission.submitterId === actor.id) {
          throw new LifecycleError("The submitter cannot review their own submission.", "conflict");
        }
        const editorAssignment = await tx.editorAssignment.findUnique({
          where: {
            submissionId_editorId: { submissionId: round.submissionId, editorId: actor.id },
          },
        });
        if (editorAssignment) {
          throw new LifecycleError(
            "An assigned editor cannot also act as a formal reviewer for the same submission.",
            "conflict",
          );
        }
        const reviewer = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
        let report;
        try {
          report = await tx.formalReviewReport.create({
            data: {
              roundId,
              reviewerId: actor.id,
              reviewerOrcid: reviewer.orcid,
              reviewerOrcidVerified: Boolean(reviewer.orcid && reviewer.orcidVerifiedAt),
              recommendation: parsedRecommendation,
              bodyJson,
              bodyHash,
              coiStatement: coiStatement?.trim() || null,
            },
          });
        } catch (error) {
          if (prismaCode(error) === "P2002") {
            throw new LifecycleError(
              "A report already exists for this reviewer and round; reports are immutable.",
              "conflict",
            );
          }
          throw error;
        }
        await audit(tx, actor.id, "editorial.report-submitted", "review-round", roundId, {
          reportId: report.id,
          recommendation: parsedRecommendation,
          bodyHash,
        });
        await notify(
          tx,
          await activeEditorIds(tx, round.submissionId),
          "report-submitted",
          "review-round",
          roundId,
          { reportId: report.id },
        );
        return { reportId: report.id, bodyHash };
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    ),
  );
}

/** Submitter's response within an open round. Append-only. */
export async function submitAuthorResponse(
  actor: Actor,
  roundId: string,
  body: AuthorResponseBody,
): Promise<{ responseId: string; bodyHash: string }> {
  const parsedBody = authorResponseBodySchema.parse(body);
  const bodyJson = canonicalJson(parsedBody);
  const bodyHash = sha256(bodyJson);
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const round = await tx.reviewRound.findUnique({
          where: { id: roundId },
          include: { submission: true },
        });
        if (!round) throw new LifecycleError("Review round not found.", "not-found");
        if (round.status !== "open") {
          throw new LifecycleError("This round is decided; responses are closed.", "conflict");
        }
        if (round.submission.submitterId !== actor.id) {
          throw new LifecycleError("Only the submitter can respond to this round.", "forbidden");
        }
        const response = await tx.authorResponse.create({
          data: { roundId, authorId: actor.id, bodyJson, bodyHash },
        });
        await audit(tx, actor.id, "editorial.author-responded", "review-round", roundId, {
          responseId: response.id,
          bodyHash,
        });
        await notify(
          tx,
          await activeEditorIds(tx, round.submissionId),
          "author-responded",
          "review-round",
          roundId,
          { responseId: response.id },
        );
        return { responseId: response.id, bodyHash };
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    ),
  );
}

export interface IssueDecisionResult {
  decision: RoundDecision;
  reviewSlug?: string;
}

/**
 * Close a round with a decision letter and apply the archive decision in one
 * serializable transaction. Publication, the immutable letter, round closure,
 * assignment updates, audit records, and notification either all commit or
 * all roll back.
 */
export async function issueDecision(
  actor: Actor,
  roundId: string,
  decision: RoundDecision,
  letter: DecisionLetterBody,
  note?: string,
  overrides: EditorialOverrideInput[] = [],
  selectedNodeIds: string[] = [],
): Promise<IssueDecisionResult> {
  if (!isEditorRole(actor.role)) {
    throw new LifecycleError("Only a current editor can issue a decision.", "forbidden");
  }
  const parsedDecision = roundDecisionSchema.parse(decision);
  const parsedLetter = decisionLetterBodySchema.parse(letter);
  const bodyJson = canonicalJson(parsedLetter);
  const bodyHash = sha256(bodyJson);
  const operationKey = `editorial.decision-issued:${roundId}`;
  const operationHash = sha256(
    canonicalJson({
      actorId: actor.id,
      decision: parsedDecision,
      letter: parsedLetter,
      note: note ?? null,
      overrides: [...overrides].sort(
        (left, right) =>
          left.checkId.localeCompare(right.checkId) ||
          left.rationale.localeCompare(right.rationale),
      ),
      selectedNodeIds: [...selectedNodeIds].sort((left, right) => left.localeCompare(right)),
    }),
  );

  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const currentActor = await tx.user.findUnique({
          where: { id: actor.id },
          select: { role: true },
        });
        if (!currentActor || !isEditorRole(currentActor.role)) {
          throw new LifecycleError("Only a current editor can issue a decision.", "forbidden");
        }
        const round = await tx.reviewRound.findUnique({
          where: { id: roundId },
          include: { submission: true, decisionLetter: true },
        });
        if (!round) throw new LifecycleError("Review round not found.", "not-found");
        const priorClaim = await tx.idempotencyKey.findUnique({ where: { key: operationKey } });
        if (priorClaim) {
          if (priorClaim.requestHash !== operationHash) {
            throw new LifecycleError(
              "This round decision is bound to a different payload.",
              "conflict",
            );
          }
          if (
            round.status !== "decided" ||
            round.decisionLetter?.editorId !== actor.id ||
            round.decisionLetter.decision !== parsedDecision ||
            round.decisionLetter.bodyHash !== bodyHash
          ) {
            throw new LifecycleError(
              "Round decision idempotency record is incomplete.",
              "conflict",
            );
          }
          const review = round.submission.resultingReviewId
            ? await tx.review.findUnique({
                where: { id: round.submission.resultingReviewId },
                select: { slug: true },
              })
            : null;
          return { decision: parsedDecision, reviewSlug: review?.slug };
        }
        if (round.status !== "open" || round.decisionLetter) {
          throw new LifecycleError("This round already has a decision.", "conflict");
        }
        const assignment = await tx.editorAssignment.findUnique({
          where: {
            submissionId_editorId: { submissionId: round.submissionId, editorId: actor.id },
          },
        });
        if (assignment?.status !== "active") {
          throw new LifecycleError(
            "Only an actively assigned, non-recused editor can issue a decision.",
            "forbidden",
          );
        }

        let reviewSlug: string | undefined;
        if (parsedDecision === "accept") {
          reviewSlug = (
            await acceptSubmissionInTransaction(
              tx,
              round.submissionId,
              actor.id,
              note,
              overrides,
              selectedNodeIds,
              round.id,
            )
          ).reviewSlug;
        } else {
          await decideSubmissionInTransaction(
            tx,
            round.submissionId,
            actor.id,
            parsedDecision === "reject" ? "reject" : "request-changes",
            note,
            round.id,
          );
        }

        await tx.decisionLetter.create({
          data: { roundId, editorId: actor.id, decision: parsedDecision, bodyJson, bodyHash },
        });
        const closed = await tx.reviewRound.updateMany({
          where: { id: roundId, status: "open" },
          data: { status: "decided", decidedAt: new Date() },
        });
        if (closed.count !== 1) {
          throw new LifecycleError("Round was decided concurrently.", "conflict");
        }
        if (parsedDecision !== "request-changes") {
          await tx.editorAssignment.updateMany({
            where: { submissionId: round.submissionId, status: "active" },
            data: { status: "completed" },
          });
        }
        await audit(
          tx,
          actor.id,
          "editorial.decision-issued",
          "review-round",
          roundId,
          { decision: parsedDecision, bodyHash, reviewSlug },
          operationKey,
          operationHash,
        );
        await notify(
          tx,
          [round.submission.submitterId],
          "decision-issued",
          "review-round",
          roundId,
          { decision: parsedDecision },
        );
        return { decision: parsedDecision, reviewSlug };
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    ),
  );
}

/** Attach or clear the signed-in user's ORCID. Always recorded unverified. */
export async function setUserOrcid(actor: Actor, orcid: string | null): Promise<void> {
  const value = orcid === null ? null : orcidSchema.parse(orcid);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.id },
      data: { orcid: value, orcidVerifiedAt: null },
    });
    await audit(tx, actor.id, "profile.orcid-set", "user", actor.id, {
      orcid: value,
      verified: false,
    });
  });
}

export interface ProcessHistoryReport {
  reviewerLogin: string;
  reviewerOrcid?: string;
  orcidVerified: boolean;
  recommendation: string;
  body: FormalReviewReportBody;
  bodyHash: string;
  coiStatement?: string;
  submittedAt: string;
}

export interface ProcessHistoryRound {
  roundId: string;
  roundNumber: number;
  status: string;
  openedAt: string;
  reports: ProcessHistoryReport[];
  responses: Array<{ authorLogin: string; body: AuthorResponseBody; submittedAt: string }>;
  decision?: {
    editorLogin: string;
    decision: string;
    letter: DecisionLetterBody;
    bodyHash: string;
    issuedAt: string;
  };
}

export interface ProcessHistoryEntry {
  submissionId: string;
  submittedAt?: string;
  submitterLogin: string;
  status: string;
  rounds: ProcessHistoryRound[];
}

type ReportRow = Prisma.FormalReviewReportGetPayload<{ include: { reviewer: true } }>;
type ResponseRow = Prisma.AuthorResponseGetPayload<{ include: { author: true } }>;
type LetterRow = Prisma.DecisionLetterGetPayload<{ include: { editor: true } }>;

function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Stored bodies are canonical JSON written by this module; a row that fails
 * validation is corrupt and is omitted (logged) rather than crashing every
 * public history view.
 */
function mapReportRow(report: ReportRow): ProcessHistoryReport | null {
  const body = formalReviewReportBodySchema.safeParse(parseStoredJson(report.bodyJson));
  if (!body.success) {
    console.error(`[editorial] report ${report.id} failed stored-body validation; omitted.`);
    return null;
  }
  return {
    reviewerLogin: report.reviewer.githubLogin,
    reviewerOrcid: report.reviewerOrcid ?? undefined,
    orcidVerified: report.reviewerOrcidVerified,
    recommendation: report.recommendation,
    body: body.data,
    bodyHash: report.bodyHash,
    coiStatement: report.coiStatement ?? undefined,
    submittedAt: report.submittedAt.toISOString(),
  };
}

function mapResponseRow(
  response: ResponseRow,
): { authorLogin: string; body: AuthorResponseBody; submittedAt: string } | null {
  const body = authorResponseBodySchema.safeParse(parseStoredJson(response.bodyJson));
  if (!body.success) {
    console.error(`[editorial] response ${response.id} failed stored-body validation; omitted.`);
    return null;
  }
  return {
    authorLogin: response.author.githubLogin,
    body: body.data,
    submittedAt: response.submittedAt.toISOString(),
  };
}

function mapLetterRow(letter: LetterRow):
  | {
      editorLogin: string;
      decision: string;
      letter: DecisionLetterBody;
      bodyHash: string;
      issuedAt: string;
    }
  | undefined {
  const body = decisionLetterBodySchema.safeParse(parseStoredJson(letter.bodyJson));
  if (!body.success) {
    console.error(`[editorial] letter ${letter.id} failed stored-body validation; omitted.`);
    return undefined;
  }
  return {
    editorLogin: letter.editor.githubLogin,
    decision: letter.decision,
    letter: body.data,
    bodyHash: letter.bodyHash,
    issuedAt: letter.createdAt.toISOString(),
  };
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

type SubmissionWithProcess = Prisma.SubmissionGetPayload<{
  include: {
    submitter: true;
    reviewRounds: {
      include: {
        reports: { include: { reviewer: true } };
        responses: { include: { author: true } };
        decisionLetter: { include: { editor: true } };
      };
    };
  };
}>;

/**
 * Public, immutable process history for a submission and its revision
 * lineage, oldest first. Reports and responses become public with the
 * process itself — this is an open-review archive.
 */
export async function getProcessHistory(submissionId: string): Promise<ProcessHistoryEntry[]> {
  const chain: ProcessHistoryEntry[] = [];
  let currentId: string | null = submissionId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const submission: SubmissionWithProcess | null = await prisma.submission.findUnique({
      where: { id: currentId },
      include: {
        submitter: true,
        reviewRounds: {
          orderBy: { roundNumber: "asc" },
          include: {
            reports: { orderBy: { submittedAt: "asc" }, include: { reviewer: true } },
            responses: { orderBy: { submittedAt: "asc" }, include: { author: true } },
            decisionLetter: { include: { editor: true } },
          },
        },
      },
    });
    if (!submission) break;
    chain.push({
      submissionId: submission.id,
      submittedAt: submission.submittedAt?.toISOString(),
      submitterLogin: submission.submitter.githubLogin,
      status: submission.status,
      rounds: submission.reviewRounds.map((round) => ({
        roundId: round.id,
        roundNumber: round.roundNumber,
        status: round.status,
        openedAt: round.openedAt.toISOString(),
        reports: round.reports.map(mapReportRow).filter(notNull),
        responses: round.responses.map(mapResponseRow).filter(notNull),
        decision: round.decisionLetter ? mapLetterRow(round.decisionLetter) : undefined,
      })),
    });
    currentId = submission.previousSubmissionId;
  }
  return chain.reverse();
}

export interface NotificationRow {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  readAt?: string;
  createdAt: string;
}

export async function listNotifications(
  userId: string,
  unreadOnly = false,
): Promise<NotificationRow[]> {
  const rows = await prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    readAt: row.readAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  const changed = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (changed.count !== 1) {
    throw new LifecycleError("Notification not found or already read.", "not-found");
  }
}

export interface SubmissionWorkflow {
  assignments: Array<{
    id: string;
    editorId: string;
    editorLogin: string;
    status: string;
    coiDeclared: boolean;
  }>;
  rounds: Array<{
    id: string;
    roundNumber: number;
    status: string;
    reportCount: number;
    responseCount: number;
    decision?: string;
  }>;
}

/** Editorial-queue state for one submission (dashboard view). */
export async function getSubmissionWorkflow(submissionId: string): Promise<SubmissionWorkflow> {
  const [assignments, rounds] = await Promise.all([
    prisma.editorAssignment.findMany({
      where: { submissionId },
      include: { editor: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.reviewRound.findMany({
      where: { submissionId },
      include: {
        _count: { select: { reports: true, responses: true } },
        decisionLetter: true,
      },
      orderBy: { roundNumber: "asc" },
    }),
  ]);
  return {
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      editorId: assignment.editorId,
      editorLogin: assignment.editor.githubLogin,
      status: assignment.status,
      coiDeclared: assignment.coiDeclared,
    })),
    rounds: rounds.map((round) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      status: round.status,
      reportCount: round._count.reports,
      responseCount: round._count.responses,
      decision: round.decisionLetter?.decision,
    })),
  };
}

export interface RoundDetail {
  roundId: string;
  roundNumber: number;
  status: string;
  submissionId: string;
  submissionStatus: string;
  submissionTitle: string;
  submitterLogin: string;
  viewerIsSubmitter: boolean;
  viewerIsActiveEditor: boolean;
  viewerHasReported: boolean;
  viewerIsAssignedEditor: boolean;
  nodeOnly: boolean;
  nodeCandidates: Array<{ id: string; kind: string; title: string }>;
  reports: ProcessHistoryReport[];
  responses: Array<{ authorLogin: string; body: AuthorResponseBody; submittedAt: string }>;
  decision?: {
    editorLogin: string;
    decision: string;
    letter: DecisionLetterBody;
    bodyHash: string;
    issuedAt: string;
  };
}

/** Round detail for the round page, with viewer eligibility flags. */
export async function getRoundDetail(
  roundId: string,
  viewerId: string,
): Promise<RoundDetail | null> {
  const round = await prisma.reviewRound.findUnique({
    where: { id: roundId },
    include: {
      submission: { include: { submitter: true, repository: true } },
      reports: { orderBy: { submittedAt: "asc" }, include: { reviewer: true } },
      responses: { orderBy: { submittedAt: "asc" }, include: { author: true } },
      decisionLetter: { include: { editor: true } },
    },
  });
  if (!round) return null;
  const assignment = await prisma.editorAssignment.findUnique({
    where: { submissionId_editorId: { submissionId: round.submissionId, editorId: viewerId } },
  });
  const extracted = parseTitle(round.submission.extractedMetadataJson);
  const payload = parseStoredSubmissionPayload(round.submission.submittedPayloadJson);
  return {
    roundId: round.id,
    roundNumber: round.roundNumber,
    status: round.status,
    submissionId: round.submissionId,
    submissionStatus: round.submission.status,
    submissionTitle:
      extracted ?? `${round.submission.repository.owner}/${round.submission.repository.name}`,
    submitterLogin: round.submission.submitter.githubLogin,
    viewerIsSubmitter: round.submission.submitterId === viewerId,
    viewerIsActiveEditor: assignment?.status === "active",
    viewerIsAssignedEditor: Boolean(assignment),
    nodeOnly: payload?.publicationTargets.proseReview === false,
    nodeCandidates: payload
      ? validNodeCandidates(payload).map((candidate) => ({
          id: candidate.node.id,
          kind: candidate.node.kind,
          title: candidate.node.title,
        }))
      : [],
    viewerHasReported: round.reports.some((report) => report.reviewerId === viewerId),
    reports: round.reports.map(mapReportRow).filter(notNull),
    responses: round.responses.map(mapResponseRow).filter(notNull),
    decision: round.decisionLetter ? mapLetterRow(round.decisionLetter) : undefined,
  };
}

function parseTitle(extractedMetadataJson: string | null): string | undefined {
  if (!extractedMetadataJson) return undefined;
  try {
    const parsed: unknown = JSON.parse(extractedMetadataJson);
    const title = (parsed as { fields?: { title?: { value?: unknown } } }).fields?.title?.value;
    return typeof title === "string" ? title : undefined;
  } catch {
    return undefined;
  }
}

/** Process history for the submission that produced a version, if any. */
export async function getProcessHistoryForVersion(
  versionId: string,
): Promise<ProcessHistoryEntry[]> {
  const version = await prisma.reviewVersion.findUnique({
    where: { id: versionId },
    select: { sourceSubmissionId: true },
  });
  if (!version?.sourceSubmissionId) return [];
  return getProcessHistory(version.sourceSubmissionId);
}
