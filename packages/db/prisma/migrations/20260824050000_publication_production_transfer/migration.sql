-- Optional production provenance and explicit reviewed publication transfer.
-- Both records are append-only; corrections create a new assertion that
-- points at its predecessor rather than rewriting historical provenance.

CREATE TABLE "PublicationProductionAssertion" (
  "id" TEXT NOT NULL,
  "publicationVersionId" TEXT NOT NULL,
  "sourceAssertionKey" TEXT,
  "mode" TEXT NOT NULL,
  "actorsJson" TEXT NOT NULL DEFAULT '[]',
  "activitiesJson" TEXT NOT NULL DEFAULT '[]',
  "statement" TEXT,
  "strength" TEXT NOT NULL,
  "publicEvidenceUrl" TEXT,
  "agentRunId" TEXT,
  "executionPassportId" TEXT,
  "supersedesAssertionId" TEXT,
  "assertedById" TEXT,
  "assertedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationProductionAssertion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicationProductionAssertion_version_fkey" FOREIGN KEY ("publicationVersionId") REFERENCES "PublicationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PublicationProductionAssertion_agent_run_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PublicationProductionAssertion_passport_fkey" FOREIGN KEY ("executionPassportId") REFERENCES "ExecutionPassport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PublicationProductionAssertion_actor_fkey" FOREIGN KEY ("assertedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PublicationProductionAssertion_supersedes_fkey" FOREIGN KEY ("supersedesAssertionId") REFERENCES "PublicationProductionAssertion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PublicationProductionAssertion_shape_check" CHECK (
    "mode" IN ('human', 'ai-assisted', 'agentic', 'hybrid', 'unspecified')
    AND (
      ("strength" = 'source-declared' AND "agentRunId" IS NULL AND "executionPassportId" IS NULL)
      OR
      ("strength" = 'oratlas-attested' AND ("agentRunId" IS NOT NULL OR "executionPassportId" IS NOT NULL))
    )
    AND ("supersedesAssertionId" IS NULL OR "supersedesAssertionId" <> "id")
  )
);

CREATE UNIQUE INDEX "PublicationProductionAssertion_supersedes_key" ON "PublicationProductionAssertion"("supersedesAssertionId");
CREATE UNIQUE INDEX "PublicationProductionAssertion_source_key" ON "PublicationProductionAssertion"("publicationVersionId", "sourceAssertionKey");
CREATE INDEX "PublicationProductionAssertion_version_asserted_idx" ON "PublicationProductionAssertion"("publicationVersionId", "assertedAt");
CREATE INDEX "PublicationProductionAssertion_agent_run_idx" ON "PublicationProductionAssertion"("agentRunId");
CREATE INDEX "PublicationProductionAssertion_passport_idx" ON "PublicationProductionAssertion"("executionPassportId");

CREATE TABLE "PublicationRelation" (
  "id" TEXT NOT NULL,
  "sourcePublicationId" TEXT NOT NULL,
  "targetPublicationId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "publicEvidenceUrl" TEXT,
  "reviewedById" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationRelation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicationRelation_source_fkey" FOREIGN KEY ("sourcePublicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PublicationRelation_target_fkey" FOREIGN KEY ("targetPublicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PublicationRelation_reviewer_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PublicationRelation_shape_check" CHECK (
    "sourcePublicationId" <> "targetPublicationId"
    AND "relationType" IN ('same-publication-continuation', 'mirror-of', 'moved-to', 'derived-from', 'republication-of', 'version-of')
  )
);

CREATE UNIQUE INDEX "PublicationRelation_exact_key" ON "PublicationRelation"("sourcePublicationId", "targetPublicationId", "relationType");
CREATE INDEX "PublicationRelation_source_reviewed_idx" ON "PublicationRelation"("sourcePublicationId", "reviewedAt");
CREATE INDEX "PublicationRelation_target_reviewed_idx" ON "PublicationRelation"("targetPublicationId", "reviewedAt");

CREATE OR REPLACE FUNCTION "oratlas_reject_publication_provenance_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Publication provenance and transfer decisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PublicationProductionAssertion_immutable_guard"
  BEFORE UPDATE OR DELETE ON "PublicationProductionAssertion"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_publication_provenance_mutation"();

CREATE TRIGGER "PublicationRelation_immutable_guard"
  BEFORE UPDATE OR DELETE ON "PublicationRelation"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_publication_provenance_mutation"();
