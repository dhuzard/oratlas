import type { NodeRelationTrustRecord, TrustRecord } from "@oratlas/contracts";
import type { Prisma } from "@oratlas/db";
import {
  assessmentSourceIdentity,
  normalizeImportedNodeRelationTrustRecord,
  normalizeImportedTrustRecord,
} from "@oratlas/trust";

export async function ingestTrustAssessment(
  tx: Prisma.TransactionClient,
  claimEvidenceRelationId: string,
  record: TrustRecord,
  sourceRelationHumanReviewed: boolean | null,
) {
  const imported = normalizeImportedTrustRecord(record, sourceRelationHumanReviewed);
  const sourceIdentity = assessmentSourceIdentity(imported.record);
  const exact = await tx.trustAssessment.findUnique({
    where: {
      claimEvidenceRelationId_sourceRecordHash: {
        claimEvidenceRelationId,
        sourceRecordHash: sourceIdentity.sourceRecordHash,
      },
    },
  });
  if (exact) return exact;
  const predecessor = await tx.trustAssessment.findFirst({
    where: { claimEvidenceRelationId, sourceLineageKey: sourceIdentity.sourceLineageKey },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return tx.trustAssessment.upsert({
    where: {
      claimEvidenceRelationId_sourceRecordHash: {
        claimEvidenceRelationId,
        sourceRecordHash: sourceIdentity.sourceRecordHash,
      },
    },
    update: {},
    create: {
      claimEvidenceRelationId,
      protocolVersion: imported.record.protocolVersion,
      assessorType: imported.record.assessorType,
      assessorId: imported.record.assessorId,
      assessedAt: imported.record.assessedAt ? new Date(imported.record.assessedAt) : null,
      conflictOfInterestStatus: imported.record.conflictOfInterest.status,
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
      ...sourceIdentity,
      supersedesAssessmentId: predecessor?.id,
    },
  });
}

export async function ingestNodeRelationTrustAssessment(
  tx: Prisma.TransactionClient,
  nodeEdgeProposalId: string,
  record: NodeRelationTrustRecord,
) {
  const imported = normalizeImportedNodeRelationTrustRecord(record);
  const sourceIdentity = assessmentSourceIdentity(imported.record);
  const exact = await tx.nodeRelationTrustAssessment.findUnique({
    where: {
      nodeEdgeProposalId_sourceRecordHash: {
        nodeEdgeProposalId,
        sourceRecordHash: sourceIdentity.sourceRecordHash,
      },
    },
  });
  if (exact) return exact;
  const predecessor = await tx.nodeRelationTrustAssessment.findFirst({
    where: { nodeEdgeProposalId, sourceLineageKey: sourceIdentity.sourceLineageKey },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return tx.nodeRelationTrustAssessment.upsert({
    where: {
      nodeEdgeProposalId_sourceRecordHash: {
        nodeEdgeProposalId,
        sourceRecordHash: sourceIdentity.sourceRecordHash,
      },
    },
    update: {},
    create: {
      nodeEdgeProposalId,
      protocolVersion: imported.record.protocolVersion,
      assessorType: imported.record.assessorType,
      assessorId: imported.record.assessorId,
      assessedAt: imported.record.assessedAt ? new Date(imported.record.assessedAt) : null,
      conflictOfInterestStatus: imported.record.conflictOfInterest.status,
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
      ...sourceIdentity,
      supersedesAssessmentId: predecessor?.id,
    },
  });
}
