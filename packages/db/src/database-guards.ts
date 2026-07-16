import type { PrismaClient } from "../generated/client/index.js";

export const DATABASE_GUARD_NAMES = [
  "Review_source_union_check",
  "ReviewVersion_source_union_check",
  "SynthesisDraft_status_check",
  "SynthesisGenerationRequestClaim_status_check",
  "SynthesisDraftMembership_identifier_shape_check",
  "SynthesisStalenessEvaluation_status_check",
  "SynthesisRegenerationProposal_status_check",
] as const;

export const POSTGRES_DATABASE_GUARD_TRIGGER_NAMES = [
  "SynthesisDraftMembership_reference_guard",
  "SynthesisDraftCitation_reference_guard",
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
  )`,
  'ALTER TABLE "SynthesisRegenerationProposal" DROP CONSTRAINT IF EXISTS "SynthesisRegenerationProposal_status_check"',
  `ALTER TABLE "SynthesisRegenerationProposal" ADD CONSTRAINT "SynthesisRegenerationProposal_status_check" CHECK (
    ("status" = 'open' AND "openHeadKey" = "acceptedReviewVersionId" AND "resolvedById" IS NULL AND "resolvedAt" IS NULL)
    OR ("status" = 'superseded' AND "openHeadKey" IS NULL)
    OR ("status" IN ('regeneration-requested', 'dismissed') AND "openHeadKey" IS NULL AND "resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolutionRationale" IS NOT NULL AND "resolutionIdempotencyKey" IS NOT NULL AND "resolutionInputHash" IS NOT NULL)
  )`,
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
    THEN 1 ELSE 0 END`,
  SynthesisRegenerationProposal: `CASE WHEN
    (NEW."status" = 'open' AND NEW."openHeadKey" = NEW."acceptedReviewVersionId" AND NEW."resolvedById" IS NULL AND NEW."resolvedAt" IS NULL)
    OR (NEW."status" = 'superseded' AND NEW."openHeadKey" IS NULL)
    OR (NEW."status" IN ('regeneration-requested', 'dismissed') AND NEW."openHeadKey" IS NULL AND NEW."resolvedById" IS NOT NULL AND NEW."resolvedAt" IS NOT NULL AND NEW."resolutionRationale" IS NOT NULL AND NEW."resolutionIdempotencyKey" IS NOT NULL AND NEW."resolutionInputHash" IS NOT NULL)
    THEN 1 ELSE 0 END`,
} as const;

export const SQLITE_DATABASE_GUARD_NAMES = Object.keys(sqliteGuardConditions).flatMap((table) => [
  `${table}_guard_insert`,
  `${table}_guard_update`,
]);

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
  });
}
