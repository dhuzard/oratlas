import { createHash } from "node:crypto";
import {
  canonicalJson,
  subgraphEvidencePacketSchema,
  synthesisFreshnessSchema,
  synthesisSelectorSchema,
  synthesisStalenessAffectedReferenceSchema,
  synthesisStalenessReasonCodeSchema,
  SYNTHESIS_STALENESS_AFFECTED_REFERENCE_MAX,
  SYNTHESIS_STALENESS_POLICY_VERSION,
} from "@oratlas/contracts";

interface StoredEvaluation {
  id: string;
  evaluationKey: string;
  policyVersion: string;
  reviewId: string;
  acceptedReviewVersionId: string;
  acceptedDraftId: string;
  seriesKey: string;
  selectorJson: string;
  selectorHash: string;
  acceptedMaterializationPolicyVersion: string;
  evaluatedMaterializationPolicyVersion: string;
  acceptedPacketHash: string;
  acceptedPacketJson: string;
  evaluatedPacketHash: string | null;
  evaluatedPacketJson: string | null;
  failureCode: string | null;
  failureFingerprint: string | null;
  status: string;
  reasonCodesJson: string;
  affectedReferencesJson: string;
  affectedReferenceCount: number;
  affectedReferencesTruncated: boolean;
}

interface AcceptedSnapshot {
  reviewId: string;
  acceptedReviewVersionId: string;
  acceptedDraftId: string;
  seriesKey: string;
  selectorJson: string;
  selectorHash: string;
  materializationPolicyVersion: string;
  packetJson: string;
  packetHash: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Fail-closed decoder for the pointer-selected evaluation and its exact accepted lineage. */
export function validateStoredSynthesisStaleness(
  evaluation: StoredEvaluation,
  snapshot: AcceptedSnapshot,
  observedAt: Date,
) {
  try {
    if (
      evaluation.policyVersion !== SYNTHESIS_STALENESS_POLICY_VERSION ||
      !/^[0-9a-f]{64}$/.test(evaluation.evaluationKey) ||
      evaluation.reviewId !== snapshot.reviewId ||
      evaluation.acceptedReviewVersionId !== snapshot.acceptedReviewVersionId ||
      evaluation.acceptedDraftId !== snapshot.acceptedDraftId ||
      evaluation.seriesKey !== snapshot.seriesKey ||
      evaluation.selectorJson !== snapshot.selectorJson ||
      evaluation.selectorHash !== snapshot.selectorHash ||
      evaluation.acceptedMaterializationPolicyVersion !== snapshot.materializationPolicyVersion ||
      evaluation.acceptedPacketJson !== snapshot.packetJson ||
      evaluation.acceptedPacketHash !== snapshot.packetHash ||
      evaluation.evaluatedMaterializationPolicyVersion.length < 1 ||
      evaluation.evaluatedMaterializationPolicyVersion.length > 120 ||
      evaluation.affectedReferenceCount > SYNTHESIS_STALENESS_AFFECTED_REFERENCE_MAX ||
      (evaluation.failureCode === null) !== (evaluation.failureFingerprint === null) ||
      (evaluation.failureFingerprint !== null &&
        !/^[0-9a-f]{64}$/.test(evaluation.failureFingerprint)) ||
      (evaluation.failureCode !== null &&
        ![
          "database-read-failed",
          "invalid-materialization",
          "selection-unavailable",
          "materialization-conflict",
          "bounded-selection-invalid",
          "unexpected-materialization-failure",
        ].includes(evaluation.failureCode)) ||
      Number.isNaN(observedAt.getTime())
    )
      return null;

    const selector = synthesisSelectorSchema.parse(JSON.parse(evaluation.selectorJson) as unknown);
    const acceptedPacket = subgraphEvidencePacketSchema.parse(
      JSON.parse(evaluation.acceptedPacketJson) as unknown,
    );
    if (
      canonicalJson(selector) !== evaluation.selectorJson ||
      digest(evaluation.selectorJson) !== evaluation.selectorHash ||
      canonicalJson(acceptedPacket) !== evaluation.acceptedPacketJson ||
      digest(evaluation.acceptedPacketJson) !== evaluation.acceptedPacketHash
    )
      return null;

    if ((evaluation.evaluatedPacketHash === null) !== (evaluation.evaluatedPacketJson === null))
      return null;
    if (evaluation.evaluatedPacketJson !== null && evaluation.evaluatedPacketHash !== null) {
      const evaluatedPacket = subgraphEvidencePacketSchema.parse(
        JSON.parse(evaluation.evaluatedPacketJson) as unknown,
      );
      if (
        canonicalJson(evaluatedPacket) !== evaluation.evaluatedPacketJson ||
        digest(evaluation.evaluatedPacketJson) !== evaluation.evaluatedPacketHash
      )
        return null;
    }

    const reasonCodes = synthesisStalenessReasonCodeSchema
      .array()
      .parse(JSON.parse(evaluation.reasonCodesJson) as unknown);
    const affectedReferences = synthesisStalenessAffectedReferenceSchema
      .array()
      .max(100)
      .parse(JSON.parse(evaluation.affectedReferencesJson) as unknown);
    if (
      canonicalJson(reasonCodes) !== evaluation.reasonCodesJson ||
      canonicalJson(affectedReferences) !== evaluation.affectedReferencesJson ||
      (evaluation.affectedReferencesTruncated
        ? evaluation.affectedReferenceCount <= affectedReferences.length
        : evaluation.affectedReferenceCount !== affectedReferences.length) ||
      (evaluation.evaluatedPacketJson === null) !==
        reasonCodes.includes("materialization-failed") ||
      (evaluation.failureCode !== null) !== reasonCodes.includes("materialization-failed")
    )
      return null;

    const evaluationIdentity = {
      policyVersion: evaluation.policyVersion,
      acceptedReviewVersionId: evaluation.acceptedReviewVersionId,
      seriesKey: evaluation.seriesKey,
      selectorHash: evaluation.selectorHash,
      acceptedMaterializationPolicyVersion: evaluation.acceptedMaterializationPolicyVersion,
      evaluatedMaterializationPolicyVersion: evaluation.evaluatedMaterializationPolicyVersion,
      acceptedPacketHash: evaluation.acceptedPacketHash,
      evaluatedPacketHash: evaluation.evaluatedPacketHash,
      failureCode: evaluation.failureCode,
      failureFingerprint: evaluation.failureFingerprint,
      status: evaluation.status,
      reasonCodes,
      affectedReferences,
      affectedReferenceCount: evaluation.affectedReferenceCount,
      affectedReferencesTruncated: evaluation.affectedReferencesTruncated,
    };
    if (digest(canonicalJson(evaluationIdentity)) !== evaluation.evaluationKey) return null;

    const freshness = synthesisFreshnessSchema.safeParse({
      status: evaluation.status,
      policyVersion: evaluation.policyVersion,
      evaluatedAt: observedAt.toISOString(),
      reasonCodes,
      affectedReferenceCount: evaluation.affectedReferenceCount,
    });
    return freshness.success
      ? { freshness: freshness.data, reasonCodes, affectedReferences }
      : null;
  } catch {
    return null;
  }
}
