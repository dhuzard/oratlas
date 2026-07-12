import "server-only";
import { type PlatformTrustReviewStatus } from "@oratlas/contracts";
import {
  resolveTrustVerification,
  trustSubjectInputFromDatabaseRows,
  type DatabaseTrustSubjectRows,
  type ResolvedTrustVerification,
} from "@oratlas/trust";
import { type Prisma } from "@oratlas/db";
import { prisma } from "./db";

const loadedTrustInclude = {
  verification: { include: { reviewer: true } },
  relation: {
    include: {
      citation: true,
      claim: { include: { reviewVersion: { include: { review: true } } } },
    },
  },
} as const;

export type LoadedTrustAssessment = Prisma.TrustAssessmentGetPayload<{
  include: typeof loadedTrustInclude;
}>;

export interface ResolvedTrustAssessment extends ResolvedTrustVerification {
  subject: ReturnType<typeof trustSubjectInputFromDatabaseRows>;
}

export function resolveLoadedTrustAssessment(row: LoadedTrustAssessment): ResolvedTrustAssessment {
  return resolveTrustAssessmentRows(
    {
      assessment: row,
      relation: row.relation,
      claim: row.relation.claim,
      citation: row.relation.citation,
    },
    row.verification,
  );
}

export function resolveTrustAssessmentRows(
  rows: DatabaseTrustSubjectRows,
  verification: { status: string; assessmentHash: string } | null | undefined,
): ResolvedTrustAssessment {
  const subject = trustSubjectInputFromDatabaseRows(rows);
  return { subject, ...resolveTrustVerification(subject, verification) };
}

export class TrustEditorialError extends Error {
  constructor(
    message: string,
    public readonly code: "not-found" | "conflict" | "bad-request",
  ) {
    super(message);
    this.name = "TrustEditorialError";
  }
}

export interface VerifyTrustInput {
  assessmentId: string;
  status: PlatformTrustReviewStatus;
  rationale: string;
  expectedRevision: number;
  expectedAssessmentHash: string;
}

export interface TrustEditorIdentity {
  id: string;
  role: "EDITOR" | "ADMIN";
}

interface TrustEditorialTransaction {
  trustAssessment: {
    findUnique(args: unknown): Promise<LoadedTrustAssessment | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  trustVerification: { upsert(args: unknown): Promise<unknown> };
  auditEvent: { create(args: unknown): Promise<unknown> };
}

/**
 * Verify the exact loaded subject with optimistic concurrency. The revision CAS
 * and marker/audit writes run in one transaction.
 */
export async function verifyTrustAssessmentInTransaction(
  tx: TrustEditorialTransaction,
  input: VerifyTrustInput,
  editor: TrustEditorIdentity,
) {
  const row = await tx.trustAssessment.findUnique({
    where: { id: input.assessmentId },
    include: loadedTrustInclude,
  });
  if (!row) throw new TrustEditorialError("TRUST assessment not found.", "not-found");

  const resolved = resolveLoadedTrustAssessment(row);
  if (
    row.revision !== input.expectedRevision ||
    resolved.currentHash !== input.expectedAssessmentHash
  ) {
    throw new TrustEditorialError(
      "The assessment changed after this queue item was loaded. Refresh and review it again.",
      "conflict",
    );
  }

  const changed = await tx.trustAssessment.updateMany({
    where: { id: row.id, revision: input.expectedRevision },
    data: { revision: { increment: 1 } },
  });
  if (changed.count !== 1) {
    throw new TrustEditorialError(
      "Another editor updated this assessment. Refresh and review it again.",
      "conflict",
    );
  }

  const rationale = input.rationale.trim();
  if (rationale.length < 10 || rationale.length > 4_000) {
    throw new TrustEditorialError(
      "A verification rationale between 10 and 4,000 characters is required.",
      "bad-request",
    );
  }

  await tx.trustVerification.upsert({
    where: { trustAssessmentId: row.id },
    update: {
      status: input.status,
      reviewerId: editor.id,
      reviewerRoleSnapshot: editor.role,
      rationale,
      assessmentHash: resolved.currentHash,
    },
    create: {
      trustAssessmentId: row.id,
      status: input.status,
      reviewerId: editor.id,
      reviewerRoleSnapshot: editor.role,
      rationale,
      assessmentHash: resolved.currentHash,
    },
  });
  await tx.auditEvent.create({
    data: {
      actorId: editor.id,
      action: input.status === "adjudicated" ? "trust.adjudicated" : "trust.verified",
      subjectType: "trustAssessment",
      subjectId: row.id,
      detailsJson: JSON.stringify({
        status: input.status,
        assessmentHash: resolved.currentHash,
        previousVerificationState: resolved.state,
        revision: input.expectedRevision + 1,
      }),
    },
  });

  return {
    status: input.status,
    assessmentHash: resolved.currentHash,
    revision: input.expectedRevision + 1,
  };
}

export async function verifyTrustAssessment(input: VerifyTrustInput, editor: TrustEditorIdentity) {
  return prisma.$transaction((tx) =>
    verifyTrustAssessmentInTransaction(tx as unknown as TrustEditorialTransaction, input, editor),
  );
}

export type TrustQueueFilter = "all" | "needs-review" | "stale" | "legacy" | "verified";

export interface TrustQueueItem {
  assessmentId: string;
  reviewSlug: string;
  claimLocalId: string;
  claimText: string;
  citationLocalId: string;
  citationTitle?: string;
  relationType: string;
  sourceReviewStatus?: string;
  sourceAssessorType?: string;
  sourceRelationHumanReviewed?: boolean;
  sourceAggregateScore: number | null;
  computedAggregateScore: number | null;
  effectiveStatus: string;
  verificationState: ResolvedTrustVerification["state"];
  reviewerLogin?: string;
  reviewerRoleSnapshot?: string;
  rationale?: string;
  revision: number;
  assessmentHash: string;
}

export async function listTrustEditorialQueue(
  filter: TrustQueueFilter = "needs-review",
): Promise<TrustQueueItem[]> {
  const rows = await prisma.trustAssessment.findMany({
    include: loadedTrustInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
  });

  return rows
    .map((row) => {
      const resolved = resolveLoadedTrustAssessment(row);
      return {
        assessmentId: row.id,
        reviewSlug: row.relation.claim.reviewVersion.review.slug,
        claimLocalId: row.relation.claim.localClaimId,
        claimText: row.relation.claim.text,
        citationLocalId: row.relation.citation.localCitationId,
        citationTitle: row.relation.citation.title ?? undefined,
        relationType: row.relation.relationType,
        sourceReviewStatus: row.sourceReviewStatus ?? undefined,
        sourceAssessorType: row.sourceAssessorType ?? undefined,
        sourceRelationHumanReviewed: row.sourceRelationHumanReviewed ?? undefined,
        sourceAggregateScore: row.sourceAggregateScore,
        computedAggregateScore: row.aggregateScore,
        effectiveStatus: resolved.effectiveStatus,
        verificationState: resolved.state,
        reviewerLogin: row.verification?.reviewer.githubLogin,
        reviewerRoleSnapshot: row.verification?.reviewerRoleSnapshot,
        rationale: row.verification?.rationale,
        revision: row.revision,
        assessmentHash: resolved.currentHash,
      } satisfies TrustQueueItem;
    })
    .filter((item) => {
      if (filter === "all") return true;
      if (filter === "verified") return item.verificationState === "platform-verified";
      if (filter === "stale") return item.verificationState === "stale-verification";
      if (filter === "legacy") return item.verificationState === "legacy-unknown";
      return item.verificationState !== "platform-verified";
    });
}
