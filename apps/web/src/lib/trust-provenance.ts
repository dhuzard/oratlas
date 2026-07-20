import "server-only";
import {
  publicGraphTrustSchema,
  type PlatformTrustReviewStatus,
  type PublicGraphTrust,
} from "@oratlas/contracts";
import {
  isAuthoritativeNodeRelationTrustSubject,
  nodeRelationTrustSubjectInputFromDatabaseRows,
  resolveNodeRelationTrustVerification,
  resolveTrustVerification,
  orderTrustAssessments,
  trustSubjectInputFromDatabaseRows,
  type DatabaseTrustSubjectRows,
  type ReviewedNodeRelationAssessmentInput,
  type ReviewedNodeRelationTrustSubjectInput,
  type ResolvedTrustVerification,
} from "@oratlas/trust";
import { type Prisma } from "@oratlas/db";
import { type TrustCriterionProfileRow } from "@oratlas/ui";
import { prisma } from "./db";
import { trustCriterionProfileFromJson } from "./trust-profile";

const loadedTrustInclude = {
  verification: { include: { reviewer: true } },
  relation: {
    include: {
      citation: true,
      claim: { include: { reviewVersion: { include: { review: true } } } },
    },
  },
} as const;

export const loadedNodeRelationTrustInclude = {
  verification: { include: { reviewer: true } },
  proposal: {
    include: {
      confirmedEdge: { include: { confirmedBy: true } },
      sourceNodeVersion: {
        include: {
          knowledgeNode: { include: { repository: true } },
          snapshot: true,
          inspectionCapture: true,
          sourceSubmission: true,
        },
      },
      targetNodeVersion: {
        include: {
          knowledgeNode: { include: { repository: true } },
          snapshot: true,
          inspectionCapture: true,
          sourceSubmission: true,
        },
      },
    },
  },
} as const;

export type LoadedTrustAssessment = Prisma.TrustAssessmentGetPayload<{
  include: typeof loadedTrustInclude;
}>;
export type LoadedNodeRelationTrustAssessment = Prisma.NodeRelationTrustAssessmentGetPayload<{
  include: typeof loadedNodeRelationTrustInclude;
}>;

export const PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT = 10_000;
export const PUBLIC_NODE_RELATION_TRUST_PER_KEY_LIMIT = 50;

export interface PublicNodeRelationTrustSummary extends PublicGraphTrust {
  assessmentId: string;
  assessorType: string;
}

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

export interface ResolvedNodeRelationTrustAssessment extends ResolvedTrustVerification {
  subject: ReviewedNodeRelationTrustSubjectInput;
  authoritative: boolean;
}

export function resolveLoadedNodeRelationTrustAssessment(
  row: LoadedNodeRelationTrustAssessment,
): ResolvedNodeRelationTrustAssessment {
  const subject = nodeRelationTrustSubjectInputFromDatabaseRows({
    assessment: mapNodeAssessment(row),
    proposal: {
      id: row.proposal.id,
      originKey: row.proposal.originKey,
      sourceStableKey: row.proposal.sourceStableKey,
      targetStableKey: row.proposal.targetStableKey,
      relationType: row.proposal.relationType,
      sourceNodeVersionId: row.proposal.sourceNodeVersionId,
      targetNodeId: row.proposal.targetNodeId,
      targetNodeVersionId: row.proposal.targetNodeVersionId,
      origin: row.proposal.origin,
      rationale: row.proposal.rationale,
      evidenceJson: row.proposal.evidenceJson,
      sourceSubmissionId: row.proposal.sourceSubmissionId,
      inspectionCaptureId: row.proposal.inspectionCaptureId,
      status: row.proposal.status,
      revision: row.proposal.revision,
      reviewedById: row.proposal.reviewedById,
      reviewedAt: iso(row.proposal.reviewedAt),
      reviewNote: row.proposal.reviewNote,
      confirmedEdgeId: row.proposal.confirmedEdgeId,
    },
    confirmedEdge: row.proposal.confirmedEdge
      ? {
          id: row.proposal.confirmedEdge.id,
          sourceNodeVersionId: row.proposal.confirmedEdge.sourceNodeVersionId,
          targetNodeId: row.proposal.confirmedEdge.targetNodeId,
          relationType: row.proposal.confirmedEdge.relationType,
          status: row.proposal.confirmedEdge.status,
          provenance: row.proposal.confirmedEdge.provenance,
          rationale: row.proposal.confirmedEdge.rationale,
          assertedAt: iso(row.proposal.confirmedEdge.assertedAt),
          confirmedTargetNodeVersionId: row.proposal.confirmedEdge.confirmedTargetNodeVersionId,
          confirmedById: row.proposal.confirmedEdge.confirmedById,
          confirmedAt: iso(row.proposal.confirmedEdge.confirmedAt),
          revision: row.proposal.confirmedEdge.revision,
          confirmerRole: row.proposal.confirmedEdge.confirmedBy?.role ?? null,
        }
      : null,
    claimNode: { ...mapNodeVersion(row.proposal.sourceNodeVersion), kind: "claim" },
    evidenceNode: {
      ...mapNodeVersion(row.proposal.targetNodeVersion),
      kind: row.proposal.targetNodeVersion.knowledgeNode.kind as "dataset" | "code" | "figure",
    },
  });
  return {
    subject,
    authoritative: isAuthoritativeNodeRelationTrustSubject(subject),
    ...resolveNodeRelationTrustVerification(subject, row.verification),
  };
}

/**
 * Resolve one bounded exact-relation group into its complete anonymous assessment set.
 * Persisted review labels are never projected without reconstructing the subject.
 */
export function projectPublicNodeRelationTrustAssessments(
  rows: readonly LoadedNodeRelationTrustAssessment[],
): PublicNodeRelationTrustSummary[] {
  const candidates = rows.flatMap((row) => {
    try {
      const resolved = resolveLoadedNodeRelationTrustAssessment(row);
      if (!resolved.authoritative) return [];
      const parsed = publicGraphTrustSchema.safeParse({
        assessmentId: row.id,
        protocolVersion: row.protocolVersion,
        assessorType: row.assessorType,
        assessorId: row.assessorId ?? undefined,
        assessedAt: row.assessedAt?.toISOString(),
        reviewStatus: resolved.effectiveStatus,
        verificationState: resolved.state,
      });
      if (!parsed.success) return [];
      return [
        {
          id: row.id,
          assessedAt: row.assessedAt?.toISOString() ?? null,
          assessorType: row.assessorType,
          assessorId: row.assessorId,
          protocolVersion: row.protocolVersion,
          value: {
            ...parsed.data,
            assessmentId: row.id,
            assessorType: row.assessorType,
          },
        },
      ];
    } catch {
      // Malformed persisted subjects fail closed for anonymous projections.
      return [];
    }
  });

  return orderTrustAssessments(candidates).map(({ value }) => value);
}

function mapNodeAssessment(
  row: LoadedNodeRelationTrustAssessment,
): ReviewedNodeRelationAssessmentInput {
  return {
    id: row.id,
    protocolVersion: row.protocolVersion,
    assessorType: row.assessorType,
    assessorId: row.assessorId,
    assessedAt: iso(row.assessedAt),
    criteriaJson: {
      identityIntegrity: row.identityIntegrity,
      entailment: row.entailment,
      sourceAccess: row.sourceAccess,
      populationRelevance: row.populationRelevance,
      interventionExposureRelevance: row.interventionExposureRelevance,
      outcomeRelevance: row.outcomeRelevance,
      methodologicalSafeguards: row.methodologicalSafeguards,
      statisticalSafeguards: row.statisticalSafeguards,
      replicationConvergence: row.replicationConvergence,
      conflictDependency: row.conflictDependency,
    },
    limitationsJson: row.limitationsJson,
    evidenceJson: row.evidenceJson,
    aggregateScore: row.aggregateScore,
    aggregateMethod: row.aggregateMethod,
    reviewStatus: row.reviewStatus,
    sourceRecordJson: row.sourceRecordJson,
    sourceReviewStatus: row.sourceReviewStatus,
    sourceAssessorType: row.sourceAssessorType,
    sourceAssessorId: row.sourceAssessorId,
    sourceAssessedAt: iso(row.sourceAssessedAt),
    sourceEvidenceJson: row.sourceEvidenceJson,
    sourceAggregateScore: row.sourceAggregateScore,
    sourceAggregateMethod: row.sourceAggregateMethod,
  };
}

type LoadedNodeVersion = LoadedNodeRelationTrustAssessment["proposal"]["sourceNodeVersion"];

function mapNodeVersion(row: LoadedNodeVersion) {
  return {
    version: {
      id: row.id,
      knowledgeNodeId: row.knowledgeNodeId,
      snapshotId: row.snapshotId,
      sourceSubmissionId: row.sourceSubmissionId,
      inspectionCaptureId: row.inspectionCaptureId,
      capturePayloadHash: row.capturePayloadHash,
      title: row.title,
      abstract: row.abstract,
      text: row.text,
      contributorsJson: row.contributorsJson,
      license: row.license,
      payloadJson: row.payloadJson,
      provenanceJson: row.provenanceJson,
      versionDoi: row.versionDoi,
      conceptDoi: row.conceptDoi,
      isExample: row.isExample,
    },
    node: {
      id: row.knowledgeNode.id,
      repositoryId: row.knowledgeNode.repositoryId,
      localNodeId: row.knowledgeNode.localNodeId,
      kind: row.knowledgeNode.kind,
    },
    repository: {
      id: row.knowledgeNode.repository.id,
      githubRepositoryId: row.knowledgeNode.repository.githubRepositoryId,
      canonicalUrl: row.knowledgeNode.repository.canonicalUrl,
    },
    snapshot: {
      id: row.snapshot.id,
      repositoryId: row.snapshot.repositoryId,
      commitSha: row.snapshot.commitSha,
      sourceTreeSha: row.snapshot.sourceTreeSha,
      sourceKind: row.snapshot.sourceKind,
      inspectionStatus: row.snapshot.inspectionStatus,
      contentHash: row.snapshot.contentHash,
    },
    inspectionCapture: row.inspectionCapture
      ? {
          id: row.inspectionCapture.id,
          payloadHash: row.inspectionCapture.payloadHash,
          githubRepositoryId: row.inspectionCapture.githubRepositoryId,
          commitSha: row.inspectionCapture.commitSha,
        }
      : null,
    sourceSubmission: row.sourceSubmission
      ? {
          id: row.sourceSubmission.id,
          repositoryId: row.sourceSubmission.repositoryId,
          snapshotId: row.sourceSubmission.snapshotId,
          inspectionCaptureId: row.sourceSubmission.inspectionCaptureId,
          submittedPayloadHash: row.sourceSubmission.submittedPayloadHash,
          acceptedNodeSelectionHash: row.sourceSubmission.acceptedNodeSelectionHash,
        }
      : null,
  };
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
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
  subjectType?: "claim-citation" | "node-relation";
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

interface NodeRelationTrustEditorialTransaction {
  nodeRelationTrustAssessment: {
    findUnique(args: unknown): Promise<LoadedNodeRelationTrustAssessment | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  nodeRelationTrustVerification: { upsert(args: unknown): Promise<unknown> };
  auditEvent: { create(args: unknown): Promise<unknown> };
}

export async function verifyNodeRelationTrustAssessmentInTransaction(
  tx: NodeRelationTrustEditorialTransaction,
  input: VerifyTrustInput,
  editor: TrustEditorIdentity,
) {
  const row = await tx.nodeRelationTrustAssessment.findUnique({
    where: { id: input.assessmentId },
    include: loadedNodeRelationTrustInclude,
  });
  if (!row) throw new TrustEditorialError("TRUST assessment not found.", "not-found");
  let resolved: ResolvedNodeRelationTrustAssessment;
  try {
    resolved = resolveLoadedNodeRelationTrustAssessment(row);
  } catch {
    throw new TrustEditorialError(
      "The imported TRUST subject no longer matches its persisted relation.",
      "conflict",
    );
  }
  if (!resolved.authoritative) {
    throw new TrustEditorialError(
      "Node-relation TRUST can only be verified on a currently authoritative confirmed edge.",
      "conflict",
    );
  }
  if (
    row.revision !== input.expectedRevision ||
    resolved.currentHash !== input.expectedAssessmentHash
  ) {
    throw new TrustEditorialError(
      "The assessment changed after this queue item was loaded. Refresh and review it again.",
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
  const changed = await tx.nodeRelationTrustAssessment.updateMany({
    where: { id: row.id, revision: input.expectedRevision },
    data: { revision: { increment: 1 } },
  });
  if (changed.count !== 1) {
    throw new TrustEditorialError(
      "Another editor updated this assessment. Refresh and review it again.",
      "conflict",
    );
  }
  await tx.nodeRelationTrustVerification.upsert({
    where: { nodeRelationTrustAssessmentId: row.id },
    update: {
      status: input.status,
      reviewerId: editor.id,
      reviewerRoleSnapshot: editor.role,
      rationale,
      assessmentHash: resolved.currentHash,
    },
    create: {
      nodeRelationTrustAssessmentId: row.id,
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
      action:
        input.status === "adjudicated"
          ? "node-relation-trust.adjudicated"
          : "node-relation-trust.verified",
      subjectType: "nodeRelationTrustAssessment",
      subjectId: row.id,
      detailsJson: JSON.stringify({
        status: input.status,
        assessmentHash: resolved.currentHash,
        previousVerificationState: resolved.state,
        revision: input.expectedRevision + 1,
        nodeEdgeProposalId: row.nodeEdgeProposalId,
        confirmedEdgeId: row.proposal.confirmedEdgeId,
      }),
    },
  });
  return {
    status: input.status,
    assessmentHash: resolved.currentHash,
    revision: input.expectedRevision + 1,
  };
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
  return prisma.$transaction((tx) => {
    return input.subjectType === "node-relation"
      ? verifyNodeRelationTrustAssessmentInTransaction(
          tx as unknown as NodeRelationTrustEditorialTransaction,
          input,
          editor,
        )
      : verifyTrustAssessmentInTransaction(
          tx as unknown as TrustEditorialTransaction,
          input,
          editor,
        );
  });
}

export type TrustQueueFilter = "all" | "needs-review" | "stale" | "legacy" | "verified";

export interface TrustQueueItem {
  assessmentId: string;
  subjectType: "claim-citation" | "node-relation";
  subjectHref: string;
  subjectLabel: string;
  canVerify: boolean;
  claimLocalId: string;
  claimText: string;
  citationLocalId: string;
  citationTitle?: string;
  relationType: string;
  sourceReviewStatus?: string;
  sourceAssessorType?: string;
  sourceRelationHumanReviewed?: boolean;
  criteria: TrustCriterionProfileRow[];
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
  const [legacyRows, nodeRows] = await Promise.all([
    prisma.trustAssessment.findMany({
      include: loadedTrustInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
    }),
    prisma.nodeRelationTrustAssessment.findMany({
      include: loadedNodeRelationTrustInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
    }),
  ]);

  const items: TrustQueueItem[] = legacyRows.map((row) => {
    const resolved = resolveLoadedTrustAssessment(row);
    return {
      assessmentId: row.id,
      subjectType: "claim-citation",
      subjectHref: `/reviews/${row.relation.claim.reviewVersion.review.slug}`,
      subjectLabel: row.relation.claim.reviewVersion.review.slug,
      canVerify: true,
      claimLocalId: row.relation.claim.localClaimId,
      claimText: row.relation.claim.text,
      citationLocalId: row.relation.citation.localCitationId,
      citationTitle: row.relation.citation.title ?? undefined,
      relationType: row.relation.relationType,
      sourceReviewStatus: row.sourceReviewStatus ?? undefined,
      sourceAssessorType: row.sourceAssessorType ?? undefined,
      sourceRelationHumanReviewed: row.sourceRelationHumanReviewed ?? undefined,
      criteria: trustCriterionProfileFromJson(resolved.subject.assessment.criteriaJson),
      effectiveStatus: resolved.effectiveStatus,
      verificationState: resolved.state,
      reviewerLogin: row.verification?.reviewer.githubLogin,
      reviewerRoleSnapshot: row.verification?.reviewerRoleSnapshot,
      rationale: row.verification?.rationale,
      revision: row.revision,
      assessmentHash: resolved.currentHash,
    } satisfies TrustQueueItem;
  });
  for (const row of nodeRows) {
    try {
      const resolved = resolveLoadedNodeRelationTrustAssessment(row);
      items.push({
        assessmentId: row.id,
        subjectType: "node-relation",
        subjectHref: `/nodes/${row.proposal.sourceNodeVersion.knowledgeNode.id}/versions/${row.proposal.sourceNodeVersion.id}`,
        subjectLabel: `${row.proposal.sourceNodeVersion.knowledgeNode.localNodeId} → ${row.proposal.targetNodeVersion.knowledgeNode.localNodeId}`,
        canVerify: resolved.authoritative,
        claimLocalId: row.proposal.sourceNodeVersion.knowledgeNode.localNodeId,
        claimText: row.proposal.sourceNodeVersion.title,
        citationLocalId: row.proposal.targetNodeVersion.knowledgeNode.localNodeId,
        citationTitle: row.proposal.targetNodeVersion.title,
        relationType: row.proposal.relationType,
        sourceReviewStatus: row.sourceReviewStatus,
        sourceAssessorType: row.sourceAssessorType,
        criteria: trustCriterionProfileFromJson(resolved.subject.assessment.criteriaJson),
        effectiveStatus: resolved.effectiveStatus,
        verificationState: resolved.state,
        reviewerLogin: row.verification?.reviewer.githubLogin,
        reviewerRoleSnapshot: row.verification?.reviewerRoleSnapshot,
        rationale: row.verification?.rationale,
        revision: row.revision,
        assessmentHash: resolved.currentHash,
      });
    } catch {
      items.push({
        assessmentId: row.id,
        subjectType: "node-relation",
        subjectHref: `/nodes/${row.proposal.sourceNodeVersion.knowledgeNode.id}/versions/${row.proposal.sourceNodeVersion.id}`,
        subjectLabel: "Invalid persisted node relation",
        canVerify: false,
        claimLocalId: row.proposal.sourceNodeVersion.knowledgeNode.localNodeId,
        claimText: row.proposal.sourceNodeVersion.title,
        citationLocalId: row.proposal.targetNodeVersion.knowledgeNode.localNodeId,
        citationTitle: row.proposal.targetNodeVersion.title,
        relationType: row.proposal.relationType,
        sourceReviewStatus: row.sourceReviewStatus,
        sourceAssessorType: row.sourceAssessorType,
        criteria: trustCriterionProfileFromJson({
          identityIntegrity: row.identityIntegrity,
          entailment: row.entailment,
          sourceAccess: row.sourceAccess,
          populationRelevance: row.populationRelevance,
          interventionExposureRelevance: row.interventionExposureRelevance,
          outcomeRelevance: row.outcomeRelevance,
          methodologicalSafeguards: row.methodologicalSafeguards,
          statisticalSafeguards: row.statisticalSafeguards,
          replicationConvergence: row.replicationConvergence,
          conflictDependency: row.conflictDependency,
        }),
        effectiveStatus: "unverified-import",
        verificationState: "stale-verification",
        revision: row.revision,
        assessmentHash: "0".repeat(64),
      });
    }
  }
  return items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "verified") return item.verificationState === "platform-verified";
    if (filter === "stale") return item.verificationState === "stale-verification";
    if (filter === "legacy") return item.verificationState === "legacy-unknown";
    return item.verificationState !== "platform-verified";
  });
}
