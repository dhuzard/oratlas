import type { PrismaClient } from "../generated/client/index.js";

export const DATABASE_GUARD_NAMES = [
  "Review_source_union_check",
  "ReviewVersion_source_union_check",
  "SynthesisDraft_status_check",
  "SynthesisGenerationRequestClaim_status_check",
  "SynthesisDraftMembership_identifier_shape_check",
  "SynthesisStalenessEvaluation_status_check",
  "SynthesisRegenerationProposal_status_check",
  "NodeIdentityProposal_status_check",
  "TrustAssessment_coi_check",
  "NodeRelationTrustAssessment_coi_check",
  "DecisionLetter_coi_check",
  "EditorialDecisionProvenance_coi_check",
  "ChallengeTransition_coi_check",
  "Challenge_subject_union_check",
  "ChallengeResponse_contributor_union_check",
  "TrustAdjudicatorDesignation_state_check",
  "TrustAdjudication_shape_check",
  "TrustAdjudicationReference_shape_check",
] as const;

export const POSTGRES_DATABASE_GUARD_TRIGGER_NAMES = [
  "SynthesisDraftMembership_reference_guard",
  "SynthesisDraftCitation_reference_guard",
  "TrustAssessment_coi_immutable_guard",
  "NodeRelationTrustAssessment_coi_immutable_guard",
  "DecisionLetter_coi_immutable_guard",
  "DecisionLetter_immutable_delete_guard",
  "EditorialDecisionProvenance_immutable_guard",
  "EditorialDecisionProvenance_immutable_delete_guard",
  "TrustAdjudication_immutable_guard",
  "TrustAdjudicationReference_immutable_guard",
  "TrustAdjudicationReference_subject_guard",
  "Challenge_adjudication_container_guard",
  "ChallengeResponse_contributor_container_guard",
] as const;

export const POSTGRES_DATABASE_GUARD_SQL = [
  'ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_source_union_check"',
  `ALTER TABLE "Review" ADD CONSTRAINT "Review_source_union_check" CHECK (
    ("reviewType" = 'ai-synthesis' AND "repositoryId" IS NULL AND "currentSnapshotId" IS NULL AND "synthesisSeriesKey" IS NOT NULL)
    OR (("reviewType" IS NULL OR "reviewType" <> 'ai-synthesis') AND "synthesisSeriesKey" IS NULL AND "currentSynthesisVersionId" IS NULL)
  )`,
  'ALTER TABLE "ReviewVersion" DROP CONSTRAINT IF EXISTS "ReviewVersion_source_union_check"',
  `ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_source_union_check" CHECK (
    ("recordSourceType" = 'repository' AND "snapshotId" IS NOT NULL AND "synthesisDraftId" IS NULL AND "synthesisDocumentJson" IS NULL AND "synthesisOrdinal" IS NULL)
    OR ("recordSourceType" = 'synthesis' AND "snapshotId" IS NULL AND "synthesisDraftId" IS NOT NULL AND "synthesisDocumentJson" IS NOT NULL AND "synthesisOrdinal" IS NOT NULL)
  )`,
  'ALTER TABLE "SynthesisDraft" DROP CONSTRAINT IF EXISTS "SynthesisDraft_status_check"',
  `ALTER TABLE "SynthesisDraft" ADD CONSTRAINT "SynthesisDraft_status_check" CHECK (
    "status" IN ('pending', 'accepted', 'rejected', 'regeneration-requested')
  )`,
  'ALTER TABLE "SynthesisGenerationRequestClaim" DROP CONSTRAINT IF EXISTS "SynthesisGenerationRequestClaim_status_check"',
  `ALTER TABLE "SynthesisGenerationRequestClaim" ADD CONSTRAINT "SynthesisGenerationRequestClaim_status_check" CHECK (
    ("status" = 'running' AND "draftId" IS NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("status" = 'completed' AND "draftId" IS NOT NULL AND "agentRunId" IS NOT NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
    OR ("status" = 'failed' AND "draftId" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL AND "errorCode" IS NOT NULL)
  )`,
  'ALTER TABLE "SynthesisDraftMembership" DROP CONSTRAINT IF EXISTS "SynthesisDraftMembership_identifier_shape_check"',
  `ALTER TABLE "SynthesisDraftMembership" ADD CONSTRAINT "SynthesisDraftMembership_identifier_shape_check" CHECK (
    ("kind" = 'node' AND "identifierScheme" IS NULL AND "identifierRole" IS NULL AND "identifierValue" IS NULL)
    OR ("kind" = 'identifier' AND "identifierScheme" IS NOT NULL AND "identifierRole" IS NOT NULL AND "identifierValue" IS NOT NULL)
  )`,
  'ALTER TABLE "SynthesisStalenessEvaluation" DROP CONSTRAINT IF EXISTS "SynthesisStalenessEvaluation_status_check"',
  `ALTER TABLE "SynthesisStalenessEvaluation" ADD CONSTRAINT "SynthesisStalenessEvaluation_status_check" CHECK (
    "status" IN ('fresh', 'stale') AND "affectedReferenceCount" >= 0
    AND (("evaluatedPacketHash" IS NULL AND "evaluatedPacketJson" IS NULL) OR ("evaluatedPacketHash" IS NOT NULL AND "evaluatedPacketJson" IS NOT NULL))
    AND (("failureCode" IS NULL AND "failureFingerprint" IS NULL AND "evaluatedPacketJson" IS NOT NULL)
      OR ("failureCode" IS NOT NULL AND "failureFingerprint" IS NOT NULL AND "evaluatedPacketJson" IS NULL))
  )`,
  'ALTER TABLE "SynthesisRegenerationProposal" DROP CONSTRAINT IF EXISTS "SynthesisRegenerationProposal_status_check"',
  `ALTER TABLE "SynthesisRegenerationProposal" ADD CONSTRAINT "SynthesisRegenerationProposal_status_check" CHECK (
    ("status" = 'open' AND "openHeadKey" = "acceptedReviewVersionId" AND "resolvedById" IS NULL AND "resolvedAt" IS NULL AND "resolutionRationale" IS NULL AND "resolutionIdempotencyKey" IS NULL AND "resolutionInputHash" IS NULL)
    OR ("status" = 'superseded' AND "openHeadKey" IS NULL AND "resolvedById" IS NULL AND "resolvedAt" IS NULL AND "resolutionRationale" IS NULL AND "resolutionIdempotencyKey" IS NULL AND "resolutionInputHash" IS NULL)
    OR ("status" IN ('regeneration-requested', 'dismissed') AND "openHeadKey" IS NULL AND "resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolutionRationale" IS NOT NULL AND "resolutionIdempotencyKey" IS NOT NULL AND "resolutionInputHash" IS NOT NULL)
  )`,
  'ALTER TABLE "NodeIdentityProposal" DROP CONSTRAINT IF EXISTS "NodeIdentityProposal_status_check"',
  `ALTER TABLE "NodeIdentityProposal" ADD CONSTRAINT "NodeIdentityProposal_status_check" CHECK (
    "kind" = 'same-claim' AND "sourceNodeId" <> "targetNodeId" AND "revision" >= 0
    AND (("status" = 'proposed' AND "revision" = 0 AND "reviewedById" IS NULL AND "reviewedAt" IS NULL AND "reviewNote" IS NULL)
      OR ("status" IN ('confirmed', 'rejected') AND "revision" >= 1 AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewNote" IS NOT NULL))
  )`,
  'ALTER TABLE "ChallengeTransition" DROP CONSTRAINT IF EXISTS "ChallengeTransition_coi_check"',
  `ALTER TABLE "ChallengeTransition" ADD CONSTRAINT "ChallengeTransition_coi_check" CHECK (
    ("conflictOfInterestStatus" IS NULL OR ("toStatus" IN ('resolved', 'dismissed') AND "conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided')))
    AND (("administratorOverride" = false AND "administratorOverrideById" IS NULL AND "administratorOverrideGithubLoginSnapshot" IS NULL AND "administratorOverrideAt" IS NULL)
      OR ("administratorOverride" = true AND "toStatus" IN ('resolved', 'dismissed') AND "conflictOfInterestStatus" = 'conflict-declared' AND "actorRoleSnapshot" = 'ADMIN' AND "administratorOverrideById" = "actorId" AND "administratorOverrideGithubLoginSnapshot" IS NOT NULL AND "administratorOverrideAt" IS NOT NULL))
  )`,
  'ALTER TABLE "Challenge" DROP CONSTRAINT IF EXISTS "Challenge_subject_union_check"',
  `ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_subject_union_check" CHECK (
    (("reviewVersionId" IS NOT NULL AND "nodeEdgeProposalId" IS NULL)
      OR ("reviewVersionId" IS NULL AND "nodeEdgeProposalId" IS NOT NULL AND "subjectType" = 'adjudication'))
    AND (("subjectType" = 'claim' AND "claimId" IS NOT NULL AND "claimEvidenceRelationId" IS NULL AND "trustAssessmentId" IS NULL AND "trustAdjudicationId" IS NULL AND "criterion" IS NULL)
      OR ("subjectType" = 'relation' AND "claimId" IS NULL AND "claimEvidenceRelationId" IS NOT NULL AND "trustAssessmentId" IS NULL AND "trustAdjudicationId" IS NULL AND "criterion" IS NULL)
      OR ("subjectType" = 'assessment-criterion' AND "claimId" IS NULL AND "claimEvidenceRelationId" IS NULL AND "trustAssessmentId" IS NOT NULL AND "trustAdjudicationId" IS NULL AND "criterion" IS NOT NULL)
      OR ("subjectType" = 'adjudication' AND "claimId" IS NULL AND "claimEvidenceRelationId" IS NULL AND "trustAssessmentId" IS NULL AND "trustAdjudicationId" IS NOT NULL AND "criterion" IS NULL))
  )`,
  'ALTER TABLE "ChallengeResponse" DROP CONSTRAINT IF EXISTS "ChallengeResponse_contributor_union_check"',
  `ALTER TABLE "ChallengeResponse" ADD CONSTRAINT "ChallengeResponse_contributor_union_check" CHECK (
    ("contributorPersonId" IS NOT NULL AND "nodeContributorUserId" IS NULL)
    OR ("contributorPersonId" IS NULL AND "nodeContributorUserId" IS NOT NULL)
  )`,
  'ALTER TABLE "TrustAssessment" DROP CONSTRAINT IF EXISTS "TrustAssessment_coi_check"',
  `ALTER TABLE "TrustAssessment" ADD CONSTRAINT "TrustAssessment_coi_check" CHECK (
    "conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided')
  )`,
  'ALTER TABLE "NodeRelationTrustAssessment" DROP CONSTRAINT IF EXISTS "NodeRelationTrustAssessment_coi_check"',
  `ALTER TABLE "NodeRelationTrustAssessment" ADD CONSTRAINT "NodeRelationTrustAssessment_coi_check" CHECK (
    "conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided')
  )`,
  'ALTER TABLE "DecisionLetter" DROP CONSTRAINT IF EXISTS "DecisionLetter_coi_check"',
  `ALTER TABLE "DecisionLetter" ADD CONSTRAINT "DecisionLetter_coi_check" CHECK (
    "conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided')
    AND ("decisionHash" IS NULL OR ("editorGithubLoginSnapshot" IS NOT NULL AND "editorRoleSnapshot" IS NOT NULL))
    AND (("administratorOverride" = false AND "administratorOverrideById" IS NULL AND "administratorOverrideGithubLoginSnapshot" IS NULL AND "administratorOverrideAt" IS NULL)
      OR ("administratorOverride" = true AND "conflictOfInterestStatus" = 'conflict-declared' AND "editorRoleSnapshot" = 'ADMIN' AND "administratorOverrideById" = "editorId" AND "administratorOverrideGithubLoginSnapshot" IS NOT NULL AND "administratorOverrideAt" IS NOT NULL))
  )`,
  'ALTER TABLE "EditorialDecisionProvenance" DROP CONSTRAINT IF EXISTS "EditorialDecisionProvenance_coi_check"',
  `ALTER TABLE "EditorialDecisionProvenance" ADD CONSTRAINT "EditorialDecisionProvenance_coi_check" CHECK (
    "conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided')
    AND (("administratorOverride" = false AND "administratorOverrideById" IS NULL AND "administratorOverrideGithubLoginSnapshot" IS NULL AND "administratorOverrideAt" IS NULL)
      OR ("administratorOverride" = true AND "conflictOfInterestStatus" = 'conflict-declared' AND "actorRoleSnapshot" = 'ADMIN' AND "administratorOverrideById" = "actorId" AND "administratorOverrideGithubLoginSnapshot" IS NOT NULL AND "administratorOverrideAt" IS NOT NULL))
  )`,
  'ALTER TABLE "TrustAdjudicatorDesignation" DROP CONSTRAINT IF EXISTS "TrustAdjudicatorDesignation_state_check"',
  `ALTER TABLE "TrustAdjudicatorDesignation" ADD CONSTRAINT "TrustAdjudicatorDesignation_state_check" CHECK (
    ("active" = true AND "revokedAt" IS NULL) OR ("active" = false AND "revokedAt" IS NOT NULL)
  )`,
  'ALTER TABLE "TrustAdjudication" DROP CONSTRAINT IF EXISTS "TrustAdjudication_shape_check"',
  `ALTER TABLE "TrustAdjudication" ADD CONSTRAINT "TrustAdjudication_shape_check" CHECK (
    (("subjectType" = 'claim-citation' AND "claimEvidenceRelationId" IS NOT NULL AND "nodeEdgeProposalId" IS NULL)
      OR ("subjectType" = 'node-relation' AND "claimEvidenceRelationId" IS NULL AND "nodeEdgeProposalId" IS NOT NULL))
    AND (("outcome" = 'assessment-upheld' AND "selectedAssessmentId" IS NOT NULL)
      OR ("outcome" IN ('disagreement-upheld', 'reassessment-requested') AND "selectedAssessmentId" IS NULL))
    AND "conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided')
    AND (("administratorOverride" = false AND "administratorOverrideById" IS NULL AND "administratorOverrideGithubLoginSnapshot" IS NULL AND "administratorOverrideAt" IS NULL)
      OR ("administratorOverride" = true AND "conflictOfInterestStatus" = 'conflict-declared' AND "adjudicatorRoleSnapshot" = 'ADMIN' AND "administratorOverrideById" = "adjudicatorId" AND "administratorOverrideGithubLoginSnapshot" IS NOT NULL AND "administratorOverrideAt" IS NOT NULL))
  )`,
  'ALTER TABLE "TrustAdjudicationReference" DROP CONSTRAINT IF EXISTS "TrustAdjudicationReference_shape_check"',
  `ALTER TABLE "TrustAdjudicationReference" ADD CONSTRAINT "TrustAdjudicationReference_shape_check" CHECK (
    ("trustAssessmentId" IS NOT NULL AND "nodeRelationTrustAssessmentId" IS NULL AND "assessmentId" = "trustAssessmentId")
    OR ("trustAssessmentId" IS NULL AND "nodeRelationTrustAssessmentId" IS NOT NULL AND "assessmentId" = "nodeRelationTrustAssessmentId")
  )`,
  `CREATE OR REPLACE FUNCTION "oratlas_reject_assessment_coi_update"() RETURNS trigger AS $$
  BEGIN
    IF NEW."conflictOfInterestStatus" IS DISTINCT FROM OLD."conflictOfInterestStatus" THEN
      RAISE EXCEPTION 'Assessment conflict-of-interest snapshot is immutable';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS "TrustAssessment_coi_immutable_guard" ON "TrustAssessment"',
  `CREATE TRIGGER "TrustAssessment_coi_immutable_guard" BEFORE UPDATE ON "TrustAssessment"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_assessment_coi_update"()`,
  'DROP TRIGGER IF EXISTS "NodeRelationTrustAssessment_coi_immutable_guard" ON "NodeRelationTrustAssessment"',
  `CREATE TRIGGER "NodeRelationTrustAssessment_coi_immutable_guard" BEFORE UPDATE ON "NodeRelationTrustAssessment"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_assessment_coi_update"()`,
  `CREATE OR REPLACE FUNCTION "oratlas_reject_immutable_editorial_decision_update"() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'Editorial decision provenance is immutable';
  END;
  $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS "DecisionLetter_coi_immutable_guard" ON "DecisionLetter"',
  `CREATE TRIGGER "DecisionLetter_coi_immutable_guard" BEFORE UPDATE ON "DecisionLetter"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_immutable_editorial_decision_update"()`,
  'DROP TRIGGER IF EXISTS "DecisionLetter_immutable_delete_guard" ON "DecisionLetter"',
  `CREATE TRIGGER "DecisionLetter_immutable_delete_guard" BEFORE DELETE ON "DecisionLetter"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_immutable_editorial_decision_update"()`,
  'DROP TRIGGER IF EXISTS "EditorialDecisionProvenance_immutable_guard" ON "EditorialDecisionProvenance"',
  `CREATE TRIGGER "EditorialDecisionProvenance_immutable_guard" BEFORE UPDATE ON "EditorialDecisionProvenance"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_immutable_editorial_decision_update"()`,
  'DROP TRIGGER IF EXISTS "EditorialDecisionProvenance_immutable_delete_guard" ON "EditorialDecisionProvenance"',
  `CREATE TRIGGER "EditorialDecisionProvenance_immutable_delete_guard" BEFORE DELETE ON "EditorialDecisionProvenance"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_immutable_editorial_decision_update"()`,
  'DROP TRIGGER IF EXISTS "TrustAdjudication_immutable_guard" ON "TrustAdjudication"',
  `CREATE TRIGGER "TrustAdjudication_immutable_guard" BEFORE UPDATE OR DELETE ON "TrustAdjudication"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_immutable_editorial_decision_update"()`,
  'DROP TRIGGER IF EXISTS "TrustAdjudicationReference_immutable_guard" ON "TrustAdjudicationReference"',
  `CREATE TRIGGER "TrustAdjudicationReference_immutable_guard" BEFORE UPDATE OR DELETE ON "TrustAdjudicationReference"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_immutable_editorial_decision_update"()`,
  `CREATE OR REPLACE FUNCTION "oratlas_validate_adjudication_reference_subject"() RETURNS trigger AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM "TrustAdjudication" a
      WHERE a."id" = NEW."adjudicationId" AND (
        (a."subjectType" = 'claim-citation' AND NEW."trustAssessmentId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "TrustAssessment" t WHERE t."id" = NEW."trustAssessmentId"
            AND t."claimEvidenceRelationId" = a."claimEvidenceRelationId" AND t."protocolVersion" = a."protocolVersion"))
        OR (a."subjectType" = 'node-relation' AND NEW."nodeRelationTrustAssessmentId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "NodeRelationTrustAssessment" n WHERE n."id" = NEW."nodeRelationTrustAssessmentId"
            AND n."nodeEdgeProposalId" = a."nodeEdgeProposalId" AND n."protocolVersion" = a."protocolVersion"))
      )
    ) THEN RAISE EXCEPTION 'Adjudication reference subject mismatch'; END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS "TrustAdjudicationReference_subject_guard" ON "TrustAdjudicationReference"',
  `CREATE TRIGGER "TrustAdjudicationReference_subject_guard" BEFORE INSERT OR UPDATE ON "TrustAdjudicationReference"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_adjudication_reference_subject"()`,
  `CREATE OR REPLACE FUNCTION "oratlas_validate_challenge_adjudication_container"() RETURNS trigger AS $$
  BEGIN
    IF NEW."subjectType" = 'adjudication' AND NOT EXISTS (
      SELECT 1 FROM "TrustAdjudication" a WHERE a."id" = NEW."trustAdjudicationId" AND (
        (NEW."reviewVersionId" IS NOT NULL AND NEW."nodeEdgeProposalId" IS NULL
          AND a."subjectType" = 'claim-citation' AND EXISTS (
            SELECT 1 FROM "ClaimEvidenceRelation" r
            JOIN "Claim" c ON c."id" = r."claimId"
            JOIN "Citation" i ON i."id" = r."citationId"
            WHERE r."id" = a."claimEvidenceRelationId"
              AND c."reviewVersionId" = NEW."reviewVersionId"
              AND i."reviewVersionId" = NEW."reviewVersionId"))
        OR (NEW."reviewVersionId" IS NULL AND NEW."nodeEdgeProposalId" IS NOT NULL
          AND a."subjectType" = 'node-relation'
          AND a."nodeEdgeProposalId" = NEW."nodeEdgeProposalId")
      )
    ) THEN RAISE EXCEPTION 'Challenge adjudication container mismatch'; END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS "Challenge_adjudication_container_guard" ON "Challenge"',
  `CREATE TRIGGER "Challenge_adjudication_container_guard" BEFORE INSERT OR UPDATE ON "Challenge"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_challenge_adjudication_container"()`,
  `CREATE OR REPLACE FUNCTION "oratlas_validate_challenge_response_container"() RETURNS trigger AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM "Challenge" c WHERE c."id" = NEW."challengeId" AND (
        (c."reviewVersionId" IS NOT NULL AND c."nodeEdgeProposalId" IS NULL
          AND NEW."contributorPersonId" IS NOT NULL AND NEW."nodeContributorUserId" IS NULL)
        OR (c."reviewVersionId" IS NULL AND c."nodeEdgeProposalId" IS NOT NULL
          AND NEW."contributorPersonId" IS NULL AND NEW."nodeContributorUserId" IS NOT NULL)
      )
    ) THEN RAISE EXCEPTION 'Challenge response contributor container mismatch'; END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS "ChallengeResponse_contributor_container_guard" ON "ChallengeResponse"',
  `CREATE TRIGGER "ChallengeResponse_contributor_container_guard" BEFORE INSERT OR UPDATE ON "ChallengeResponse"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_challenge_response_container"()`,
  `CREATE OR REPLACE FUNCTION "oratlas_validate_synthesis_membership_reference"() RETURNS trigger AS $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM "SynthesisDraftCitation" c
      WHERE c."draftId" = NEW."draftId" AND c."referenceId" = NEW."referenceId"
        AND (c."nodeId" <> NEW."nodeId" OR c."nodeVersionId" <> NEW."nodeVersionId"
          OR (NEW."kind" = 'node' AND (c."identifierScheme" IS NOT NULL OR c."identifierRole" IS NOT NULL OR c."identifierValue" IS NOT NULL))
          OR (NEW."kind" = 'identifier' AND (c."identifierScheme" IS DISTINCT FROM NEW."identifierScheme" OR c."identifierRole" IS DISTINCT FROM NEW."identifierRole" OR c."identifierValue" IS DISTINCT FROM NEW."identifierValue")))
    ) THEN RAISE EXCEPTION 'Synthesis membership would invalidate stored citations'; END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS "SynthesisDraftMembership_reference_guard" ON "SynthesisDraftMembership"',
  `CREATE TRIGGER "SynthesisDraftMembership_reference_guard" BEFORE INSERT OR UPDATE ON "SynthesisDraftMembership"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_synthesis_membership_reference"()`,
  `CREATE OR REPLACE FUNCTION "oratlas_validate_synthesis_citation_reference"() RETURNS trigger AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM "SynthesisDraftMembership" m
      WHERE m."draftId" = NEW."draftId" AND m."referenceId" = NEW."referenceId"
        AND m."nodeId" = NEW."nodeId" AND m."nodeVersionId" = NEW."nodeVersionId"
        AND ((m."kind" = 'node' AND NEW."identifierScheme" IS NULL AND NEW."identifierRole" IS NULL AND NEW."identifierValue" IS NULL)
          OR (m."kind" = 'identifier' AND NEW."identifierScheme" IS NOT DISTINCT FROM m."identifierScheme" AND NEW."identifierRole" IS NOT DISTINCT FROM m."identifierRole" AND NEW."identifierValue" IS NOT DISTINCT FROM m."identifierValue"))
    ) THEN RAISE EXCEPTION 'Synthesis citation does not match its reference membership'; END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS "SynthesisDraftCitation_reference_guard" ON "SynthesisDraftCitation"',
  `CREATE TRIGGER "SynthesisDraftCitation_reference_guard" BEFORE INSERT OR UPDATE ON "SynthesisDraftCitation"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_synthesis_citation_reference"()`,
] as const;

const sqliteGuardConditions = {
  Review: `CASE WHEN
    (NEW."reviewType" = 'ai-synthesis' AND NEW."repositoryId" IS NULL AND NEW."currentSnapshotId" IS NULL AND NEW."synthesisSeriesKey" IS NOT NULL)
    OR ((NEW."reviewType" IS NULL OR NEW."reviewType" <> 'ai-synthesis') AND NEW."synthesisSeriesKey" IS NULL AND NEW."currentSynthesisVersionId" IS NULL)
    THEN 1 ELSE 0 END`,
  ReviewVersion: `CASE WHEN
    (NEW."recordSourceType" = 'repository' AND NEW."snapshotId" IS NOT NULL AND NEW."synthesisDraftId" IS NULL AND NEW."synthesisDocumentJson" IS NULL AND NEW."synthesisOrdinal" IS NULL)
    OR (NEW."recordSourceType" = 'synthesis' AND NEW."snapshotId" IS NULL AND NEW."synthesisDraftId" IS NOT NULL AND NEW."synthesisDocumentJson" IS NOT NULL AND NEW."synthesisOrdinal" IS NOT NULL)
    THEN 1 ELSE 0 END`,
  SynthesisDraft: `CASE WHEN NEW."status" IN ('pending', 'accepted', 'rejected', 'regeneration-requested') THEN 1 ELSE 0 END`,
  SynthesisGenerationRequestClaim: `CASE WHEN
    (NEW."status" = 'running' AND NEW."draftId" IS NULL AND NEW."leaseToken" IS NOT NULL AND NEW."leaseExpiresAt" IS NOT NULL)
    OR (NEW."status" = 'completed' AND NEW."draftId" IS NOT NULL AND NEW."agentRunId" IS NOT NULL AND NEW."leaseToken" IS NULL AND NEW."leaseExpiresAt" IS NULL)
    OR (NEW."status" = 'failed' AND NEW."draftId" IS NULL AND NEW."leaseToken" IS NULL AND NEW."leaseExpiresAt" IS NULL AND NEW."errorCode" IS NOT NULL)
    THEN 1 ELSE 0 END`,
  SynthesisDraftMembership: `CASE WHEN
    ((NEW."kind" = 'node' AND NEW."identifierScheme" IS NULL AND NEW."identifierRole" IS NULL AND NEW."identifierValue" IS NULL)
      OR (NEW."kind" = 'identifier' AND NEW."identifierScheme" IS NOT NULL AND NEW."identifierRole" IS NOT NULL AND NEW."identifierValue" IS NOT NULL))
    AND NOT EXISTS (
      SELECT 1 FROM "SynthesisDraftCitation" c
      WHERE c."draftId" = NEW."draftId" AND c."referenceId" = NEW."referenceId"
        AND (c."nodeId" <> NEW."nodeId" OR c."nodeVersionId" <> NEW."nodeVersionId"
          OR (NEW."kind" = 'node' AND (c."identifierScheme" IS NOT NULL OR c."identifierRole" IS NOT NULL OR c."identifierValue" IS NOT NULL))
          OR (NEW."kind" = 'identifier' AND (c."identifierScheme" IS NOT NEW."identifierScheme" OR c."identifierRole" IS NOT NEW."identifierRole" OR c."identifierValue" IS NOT NEW."identifierValue")))
    )
    THEN 1 ELSE 0 END`,
  SynthesisDraftCitation: `CASE WHEN EXISTS (
    SELECT 1 FROM "SynthesisDraftMembership" m
    WHERE m."draftId" = NEW."draftId" AND m."referenceId" = NEW."referenceId"
      AND m."nodeId" = NEW."nodeId" AND m."nodeVersionId" = NEW."nodeVersionId"
      AND ((m."kind" = 'node' AND NEW."identifierScheme" IS NULL AND NEW."identifierRole" IS NULL AND NEW."identifierValue" IS NULL)
        OR (m."kind" = 'identifier' AND NEW."identifierScheme" IS m."identifierScheme" AND NEW."identifierRole" IS m."identifierRole" AND NEW."identifierValue" IS m."identifierValue"))
  )
    THEN 1 ELSE 0 END`,
  SynthesisStalenessEvaluation: `CASE WHEN
    NEW."status" IN ('fresh', 'stale') AND NEW."affectedReferenceCount" >= 0
    AND ((NEW."evaluatedPacketHash" IS NULL AND NEW."evaluatedPacketJson" IS NULL) OR (NEW."evaluatedPacketHash" IS NOT NULL AND NEW."evaluatedPacketJson" IS NOT NULL))
    AND ((NEW."failureCode" IS NULL AND NEW."failureFingerprint" IS NULL AND NEW."evaluatedPacketJson" IS NOT NULL)
      OR (NEW."failureCode" IS NOT NULL AND NEW."failureFingerprint" IS NOT NULL AND NEW."evaluatedPacketJson" IS NULL))
    THEN 1 ELSE 0 END`,
  SynthesisRegenerationProposal: `CASE WHEN
    (NEW."status" = 'open' AND NEW."openHeadKey" = NEW."acceptedReviewVersionId" AND NEW."resolvedById" IS NULL AND NEW."resolvedAt" IS NULL AND NEW."resolutionRationale" IS NULL AND NEW."resolutionIdempotencyKey" IS NULL AND NEW."resolutionInputHash" IS NULL)
    OR (NEW."status" = 'superseded' AND NEW."openHeadKey" IS NULL AND NEW."resolvedById" IS NULL AND NEW."resolvedAt" IS NULL AND NEW."resolutionRationale" IS NULL AND NEW."resolutionIdempotencyKey" IS NULL AND NEW."resolutionInputHash" IS NULL)
    OR (NEW."status" IN ('regeneration-requested', 'dismissed') AND NEW."openHeadKey" IS NULL AND NEW."resolvedById" IS NOT NULL AND NEW."resolvedAt" IS NOT NULL AND NEW."resolutionRationale" IS NOT NULL AND NEW."resolutionIdempotencyKey" IS NOT NULL AND NEW."resolutionInputHash" IS NOT NULL)
    THEN 1 ELSE 0 END`,
  NodeIdentityProposal: `CASE WHEN
    NEW."kind" = 'same-claim' AND NEW."sourceNodeId" <> NEW."targetNodeId" AND NEW."revision" >= 0
    AND ((NEW."status" = 'proposed' AND NEW."revision" = 0 AND NEW."reviewedById" IS NULL AND NEW."reviewedAt" IS NULL AND NEW."reviewNote" IS NULL)
      OR (NEW."status" IN ('confirmed', 'rejected') AND NEW."revision" >= 1 AND NEW."reviewedById" IS NOT NULL AND NEW."reviewedAt" IS NOT NULL AND NEW."reviewNote" IS NOT NULL))
    THEN 1 ELSE 0 END`,
  TrustAssessment: `CASE WHEN NEW."conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided') THEN 1 ELSE 0 END`,
  NodeRelationTrustAssessment: `CASE WHEN NEW."conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided') THEN 1 ELSE 0 END`,
  DecisionLetter: `CASE WHEN
    NEW."conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided')
    AND (NEW."decisionHash" IS NULL OR (NEW."editorGithubLoginSnapshot" IS NOT NULL AND NEW."editorRoleSnapshot" IS NOT NULL))
    AND ((NEW."administratorOverride" = 0 AND NEW."administratorOverrideById" IS NULL AND NEW."administratorOverrideGithubLoginSnapshot" IS NULL AND NEW."administratorOverrideAt" IS NULL)
      OR (NEW."administratorOverride" = 1 AND NEW."conflictOfInterestStatus" = 'conflict-declared' AND NEW."editorRoleSnapshot" = 'ADMIN' AND NEW."administratorOverrideById" = NEW."editorId" AND NEW."administratorOverrideGithubLoginSnapshot" IS NOT NULL AND NEW."administratorOverrideAt" IS NOT NULL))
    THEN 1 ELSE 0 END`,
  EditorialDecisionProvenance: `CASE WHEN
    NEW."conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided')
    AND ((NEW."administratorOverride" = 0 AND NEW."administratorOverrideById" IS NULL AND NEW."administratorOverrideGithubLoginSnapshot" IS NULL AND NEW."administratorOverrideAt" IS NULL)
      OR (NEW."administratorOverride" = 1 AND NEW."conflictOfInterestStatus" = 'conflict-declared' AND NEW."actorRoleSnapshot" = 'ADMIN' AND NEW."administratorOverrideById" = NEW."actorId" AND NEW."administratorOverrideGithubLoginSnapshot" IS NOT NULL AND NEW."administratorOverrideAt" IS NOT NULL))
    THEN 1 ELSE 0 END`,
  ChallengeTransition: `CASE WHEN
    (NEW."conflictOfInterestStatus" IS NULL OR (NEW."toStatus" IN ('resolved', 'dismissed') AND NEW."conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided')))
    AND ((NEW."administratorOverride" = 0 AND NEW."administratorOverrideById" IS NULL AND NEW."administratorOverrideGithubLoginSnapshot" IS NULL AND NEW."administratorOverrideAt" IS NULL)
      OR (NEW."administratorOverride" = 1 AND NEW."toStatus" IN ('resolved', 'dismissed') AND NEW."conflictOfInterestStatus" = 'conflict-declared' AND NEW."actorRoleSnapshot" = 'ADMIN' AND NEW."administratorOverrideById" = NEW."actorId" AND NEW."administratorOverrideGithubLoginSnapshot" IS NOT NULL AND NEW."administratorOverrideAt" IS NOT NULL))
    THEN 1 ELSE 0 END`,
  Challenge: `CASE WHEN
    ((NEW."reviewVersionId" IS NOT NULL AND NEW."nodeEdgeProposalId" IS NULL)
      OR (NEW."reviewVersionId" IS NULL AND NEW."nodeEdgeProposalId" IS NOT NULL AND NEW."subjectType" = 'adjudication'))
    AND ((NEW."subjectType" = 'claim' AND NEW."claimId" IS NOT NULL AND NEW."claimEvidenceRelationId" IS NULL AND NEW."trustAssessmentId" IS NULL AND NEW."trustAdjudicationId" IS NULL AND NEW."criterion" IS NULL)
      OR (NEW."subjectType" = 'relation' AND NEW."claimId" IS NULL AND NEW."claimEvidenceRelationId" IS NOT NULL AND NEW."trustAssessmentId" IS NULL AND NEW."trustAdjudicationId" IS NULL AND NEW."criterion" IS NULL)
      OR (NEW."subjectType" = 'assessment-criterion' AND NEW."claimId" IS NULL AND NEW."claimEvidenceRelationId" IS NULL AND NEW."trustAssessmentId" IS NOT NULL AND NEW."trustAdjudicationId" IS NULL AND NEW."criterion" IS NOT NULL)
      OR (NEW."subjectType" = 'adjudication' AND NEW."claimId" IS NULL AND NEW."claimEvidenceRelationId" IS NULL AND NEW."trustAssessmentId" IS NULL AND NEW."trustAdjudicationId" IS NOT NULL AND NEW."criterion" IS NULL))
    AND (NEW."subjectType" <> 'adjudication' OR EXISTS (
      SELECT 1 FROM "TrustAdjudication" a WHERE a."id" = NEW."trustAdjudicationId" AND (
        (NEW."reviewVersionId" IS NOT NULL AND NEW."nodeEdgeProposalId" IS NULL
          AND a."subjectType" = 'claim-citation' AND EXISTS (
            SELECT 1 FROM "ClaimEvidenceRelation" r
            JOIN "Claim" c ON c."id" = r."claimId"
            JOIN "Citation" i ON i."id" = r."citationId"
            WHERE r."id" = a."claimEvidenceRelationId"
              AND c."reviewVersionId" = NEW."reviewVersionId"
              AND i."reviewVersionId" = NEW."reviewVersionId"))
        OR (NEW."reviewVersionId" IS NULL AND NEW."nodeEdgeProposalId" IS NOT NULL
          AND a."subjectType" = 'node-relation'
          AND a."nodeEdgeProposalId" = NEW."nodeEdgeProposalId")
      )))
    THEN 1 ELSE 0 END`,
  ChallengeResponse: `CASE WHEN
    ((NEW."contributorPersonId" IS NOT NULL AND NEW."nodeContributorUserId" IS NULL)
      OR (NEW."contributorPersonId" IS NULL AND NEW."nodeContributorUserId" IS NOT NULL))
    AND EXISTS (
      SELECT 1 FROM "Challenge" c WHERE c."id" = NEW."challengeId" AND (
        (c."reviewVersionId" IS NOT NULL AND c."nodeEdgeProposalId" IS NULL
          AND NEW."contributorPersonId" IS NOT NULL AND NEW."nodeContributorUserId" IS NULL)
        OR (c."reviewVersionId" IS NULL AND c."nodeEdgeProposalId" IS NOT NULL
          AND NEW."contributorPersonId" IS NULL AND NEW."nodeContributorUserId" IS NOT NULL)
      ))
    THEN 1 ELSE 0 END`,
  TrustAdjudicatorDesignation: `CASE WHEN
    (NEW."active" = 1 AND NEW."revokedAt" IS NULL) OR (NEW."active" = 0 AND NEW."revokedAt" IS NOT NULL)
    THEN 1 ELSE 0 END`,
  TrustAdjudication: `CASE WHEN
    ((NEW."subjectType" = 'claim-citation' AND NEW."claimEvidenceRelationId" IS NOT NULL AND NEW."nodeEdgeProposalId" IS NULL)
      OR (NEW."subjectType" = 'node-relation' AND NEW."claimEvidenceRelationId" IS NULL AND NEW."nodeEdgeProposalId" IS NOT NULL))
    AND ((NEW."outcome" = 'assessment-upheld' AND NEW."selectedAssessmentId" IS NOT NULL)
      OR (NEW."outcome" IN ('disagreement-upheld', 'reassessment-requested') AND NEW."selectedAssessmentId" IS NULL))
    AND NEW."conflictOfInterestStatus" IN ('none-declared', 'conflict-declared', 'not-provided')
    AND ((NEW."administratorOverride" = 0 AND NEW."administratorOverrideById" IS NULL AND NEW."administratorOverrideGithubLoginSnapshot" IS NULL AND NEW."administratorOverrideAt" IS NULL)
      OR (NEW."administratorOverride" = 1 AND NEW."conflictOfInterestStatus" = 'conflict-declared' AND NEW."adjudicatorRoleSnapshot" = 'ADMIN' AND NEW."administratorOverrideById" = NEW."adjudicatorId" AND NEW."administratorOverrideGithubLoginSnapshot" IS NOT NULL AND NEW."administratorOverrideAt" IS NOT NULL))
    THEN 1 ELSE 0 END`,
  TrustAdjudicationReference: `CASE WHEN
    ((NEW."trustAssessmentId" IS NOT NULL AND NEW."nodeRelationTrustAssessmentId" IS NULL AND NEW."assessmentId" = NEW."trustAssessmentId")
      OR (NEW."trustAssessmentId" IS NULL AND NEW."nodeRelationTrustAssessmentId" IS NOT NULL AND NEW."assessmentId" = NEW."nodeRelationTrustAssessmentId"))
    AND EXISTS (
      SELECT 1 FROM "TrustAdjudication" a WHERE a."id" = NEW."adjudicationId" AND (
        (a."subjectType" = 'claim-citation' AND NEW."trustAssessmentId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "TrustAssessment" t WHERE t."id" = NEW."trustAssessmentId" AND t."claimEvidenceRelationId" = a."claimEvidenceRelationId" AND t."protocolVersion" = a."protocolVersion"))
        OR (a."subjectType" = 'node-relation' AND NEW."nodeRelationTrustAssessmentId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "NodeRelationTrustAssessment" n WHERE n."id" = NEW."nodeRelationTrustAssessmentId" AND n."nodeEdgeProposalId" = a."nodeEdgeProposalId" AND n."protocolVersion" = a."protocolVersion"))
      )
    )
    THEN 1 ELSE 0 END`,
} as const;

export const SQLITE_DATABASE_GUARD_NAMES = Object.keys(sqliteGuardConditions).flatMap((table) => [
  `${table}_guard_insert`,
  `${table}_guard_update`,
]);

export const SQLITE_ASSESSMENT_COI_IMMUTABLE_GUARD_NAMES = [
  "TrustAssessment_coi_immutable_guard",
  "NodeRelationTrustAssessment_coi_immutable_guard",
  "DecisionLetter_coi_immutable_guard",
  "DecisionLetter_immutable_delete_guard",
  "EditorialDecisionProvenance_immutable_guard",
  "EditorialDecisionProvenance_immutable_delete_guard",
  "TrustAdjudication_immutable_guard_update",
  "TrustAdjudication_immutable_guard_delete",
  "TrustAdjudicationReference_immutable_guard_update",
  "TrustAdjudicationReference_immutable_guard_delete",
] as const;

/** Apply database-native guards after Prisma db push for the selected provider. */
export async function applyDatabaseGuards(
  client: PrismaClient,
  provider: "sqlite" | "postgresql",
): Promise<void> {
  if (provider === "postgresql") {
    await client.$transaction(async (tx) => {
      for (const statement of POSTGRES_DATABASE_GUARD_SQL) {
        await tx.$executeRawUnsafe(statement);
      }
    });
    return;
  }

  await client.$transaction(async (tx) => {
    for (const [table, condition] of Object.entries(sqliteGuardConditions)) {
      for (const operation of ["INSERT", "UPDATE"] as const) {
        const name = `${table}_guard_${operation.toLowerCase()}`;
        await tx.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}"`);
        await tx.$executeRawUnsafe(`
          CREATE TRIGGER "${name}"
          BEFORE ${operation} ON "${table}"
          FOR EACH ROW WHEN (${condition}) = 0
          BEGIN
            SELECT RAISE(ABORT, '${table} database guard rejected invalid state');
          END
        `);
      }
    }
    for (const table of ["TrustAssessment", "NodeRelationTrustAssessment"] as const) {
      const name = `${table}_coi_immutable_guard`;
      await tx.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}"`);
      await tx.$executeRawUnsafe(`
        CREATE TRIGGER "${name}"
        BEFORE UPDATE OF "conflictOfInterestStatus" ON "${table}"
        FOR EACH ROW WHEN NEW."conflictOfInterestStatus" IS NOT OLD."conflictOfInterestStatus"
        BEGIN
          SELECT RAISE(ABORT, 'Assessment conflict-of-interest snapshot is immutable');
        END
      `);
    }
    for (const table of ["DecisionLetter", "EditorialDecisionProvenance"] as const) {
      const name =
        table === "DecisionLetter"
          ? "DecisionLetter_coi_immutable_guard"
          : "EditorialDecisionProvenance_immutable_guard";
      await tx.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}"`);
      await tx.$executeRawUnsafe(`
        CREATE TRIGGER "${name}"
        BEFORE UPDATE ON "${table}"
        FOR EACH ROW
        BEGIN
          SELECT RAISE(ABORT, 'Editorial decision provenance is immutable');
        END
      `);
      const deleteName = `${table}_immutable_delete_guard`;
      await tx.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${deleteName}"`);
      await tx.$executeRawUnsafe(`
        CREATE TRIGGER "${deleteName}"
        BEFORE DELETE ON "${table}"
        FOR EACH ROW
        BEGIN
          SELECT RAISE(ABORT, 'Editorial decision provenance is immutable');
        END
      `);
    }
    for (const table of ["TrustAdjudication", "TrustAdjudicationReference"] as const) {
      const name = `${table}_immutable_guard`;
      for (const operation of ["UPDATE", "DELETE"] as const) {
        const operationName = `${name}_${operation.toLowerCase()}`;
        await tx.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${operationName}"`);
        await tx.$executeRawUnsafe(`
          CREATE TRIGGER "${operationName}"
          BEFORE ${operation} ON "${table}"
          FOR EACH ROW
          BEGIN
            SELECT RAISE(ABORT, 'TRUST adjudication provenance is immutable');
          END
        `);
      }
    }
  });
}
