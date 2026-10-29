import type { NodeRelationTrustRecord, TrustRecord } from "@oratlas/contracts";
import type { Prisma } from "@oratlas/db";
import {
  assessmentSourceIdentity,
  normalizeImportedNodeRelationTrustRecord,
  normalizeImportedTrustRecord,
} from "@oratlas/trust";

function importedTrustData(
  claimEvidenceRelationId: string,
  record: TrustRecord,
  sourceRelationHumanReviewed: boolean | null,
  supersedesAssessmentId?: string,
): Prisma.TrustAssessmentCreateManyInput {
  const imported = normalizeImportedTrustRecord(record, sourceRelationHumanReviewed);
  const sourceIdentity = assessmentSourceIdentity(imported.record);
  return {
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
    supersedesAssessmentId,
  };
}

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
    create: importedTrustData(
      claimEvidenceRelationId,
      record,
      sourceRelationHumanReviewed,
      predecessor?.id,
    ),
  });
}

export interface FreshRelationTrustInput {
  claimEvidenceRelationId: string;
  record: TrustRecord;
  sourceRelationHumanReviewed: boolean | null;
}

/** Only for relation rows created earlier in the same transaction, with no existing assessments. */
export async function ingestTrustAssessmentsForFreshRelations(
  tx: Prisma.TransactionClient,
  entries: FreshRelationTrustInput[],
): Promise<void> {
  const counts = new Map<string, number>();
  for (const entry of entries)
    counts.set(entry.claimEvidenceRelationId, (counts.get(entry.claimEvidenceRelationId) ?? 0) + 1);
  const singletons = entries.filter((entry) => counts.get(entry.claimEvidenceRelationId) === 1);
  // Bound insert size; Prisma also applies the connector's parameter limit.
  for (let offset = 0; offset < singletons.length; offset += 40) {
    await tx.trustAssessment.createMany({
      data: singletons
        .slice(offset, offset + 40)
        .map((entry) =>
          importedTrustData(
            entry.claimEvidenceRelationId,
            entry.record,
            entry.sourceRelationHumanReviewed,
          ),
        ),
    });
  }
  // Preserve source ordering, exact deduplication and supersession for every multi-record subject.
  for (const entry of entries) {
    if (counts.get(entry.claimEvidenceRelationId) === 1) continue;
    await ingestTrustAssessment(
      tx,
      entry.claimEvidenceRelationId,
      entry.record,
      entry.sourceRelationHumanReviewed,
    );
  }
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
