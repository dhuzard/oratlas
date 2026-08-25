-- Generic scientific verification infrastructure. ORAtlas freezes exact
-- inputs and retains attributed evidence; scientific execution stays external.

CREATE TABLE "Verifier" (
  "id" TEXT NOT NULL, "slug" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT NOT NULL, "publicUrl" TEXT, "status" TEXT NOT NULL DEFAULT 'active',
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3), "retiredAt" TIMESTAMP(3),
  CONSTRAINT "Verifier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Verifier_createdBy_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Verifier_slug_key" ON "Verifier"("slug");
CREATE INDEX "Verifier_status_name_idx" ON "Verifier"("status", "name");

CREATE TABLE "VerificationProtocol" (
  "id" TEXT NOT NULL, "authorityVerifierId" TEXT NOT NULL, "seriesKey" TEXT NOT NULL,
  "protocolVersion" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT NOT NULL,
  "verificationType" TEXT NOT NULL, "executionMode" TEXT NOT NULL,
  "supportedSubjectTypesJson" TEXT NOT NULL, "definitionJson" TEXT NOT NULL,
  "definitionSha256" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'active',
  "supersedesProtocolId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationProtocol_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VerificationProtocol_authority_fkey" FOREIGN KEY ("authorityVerifierId") REFERENCES "Verifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationProtocol_supersedes_fkey" FOREIGN KEY ("supersedesProtocolId") REFERENCES "VerificationProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VerificationProtocol_supersedes_key" ON "VerificationProtocol"("supersedesProtocolId");
CREATE UNIQUE INDEX "VerificationProtocol_version_key" ON "VerificationProtocol"("authorityVerifierId", "seriesKey", "protocolVersion");
CREATE INDEX "VerificationProtocol_status_type_idx" ON "VerificationProtocol"("status", "verificationType");

CREATE TABLE "VerifierCredential" (
  "id" TEXT NOT NULL, "verifierId" TEXT NOT NULL, "label" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "scopesJson" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "issuedById" TEXT NOT NULL,
  "revokedById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3), CONSTRAINT "VerifierCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VerifierCredential_verifier_fkey" FOREIGN KEY ("verifierId") REFERENCES "Verifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerifierCredential_issuer_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerifierCredential_revoker_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VerifierCredential_tokenPrefix_key" ON "VerifierCredential"("tokenPrefix");
CREATE UNIQUE INDEX "VerifierCredential_tokenHash_key" ON "VerifierCredential"("tokenHash");
CREATE INDEX "VerifierCredential_verifier_revoked_idx" ON "VerifierCredential"("verifierId", "revokedAt");

CREATE TABLE "VerificationRun" (
  "id" TEXT NOT NULL, "protocolId" TEXT NOT NULL, "publicationVersionId" TEXT,
  "publicationClaimOccurrenceId" TEXT, "knowledgeNodeVersionId" TEXT,
  "claimedVerifierId" TEXT, "status" TEXT NOT NULL DEFAULT 'requested',
  "inputProfile" TEXT NOT NULL, "inputProfileVersion" TEXT NOT NULL,
  "inputSchemaVersion" TEXT NOT NULL, "inputJson" TEXT NOT NULL,
  "inputSha256" TEXT NOT NULL, "inputCapturedAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "requestedById" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL, "claimedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "terminalReason" TEXT,
  "leaseTokenHash" TEXT, "leaseIssuedAt" TIMESTAMP(3), "leaseExpiresAt" TIMESTAMP(3),
  "leaseGeneration" INTEGER NOT NULL DEFAULT 0, "agentRunId" TEXT,
  "executionPassportId" TEXT, "replicationBriefId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VerificationRun_protocol_fkey" FOREIGN KEY ("protocolId") REFERENCES "VerificationProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationRun_version_fkey" FOREIGN KEY ("publicationVersionId") REFERENCES "PublicationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationRun_occurrence_fkey" FOREIGN KEY ("publicationClaimOccurrenceId") REFERENCES "PublicationClaimOccurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationRun_node_version_fkey" FOREIGN KEY ("knowledgeNodeVersionId") REFERENCES "KnowledgeNodeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationRun_claimant_fkey" FOREIGN KEY ("claimedVerifierId") REFERENCES "Verifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationRun_requester_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationRun_agent_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationRun_passport_fkey" FOREIGN KEY ("executionPassportId") REFERENCES "ExecutionPassport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationRun_replication_fkey" FOREIGN KEY ("replicationBriefId") REFERENCES "ReplicationBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VerificationRun_idempotency_key" ON "VerificationRun"("idempotencyKey");
CREATE INDEX "VerificationRun_version_created_idx" ON "VerificationRun"("publicationVersionId", "createdAt");
CREATE INDEX "VerificationRun_occurrence_created_idx" ON "VerificationRun"("publicationClaimOccurrenceId", "createdAt");
CREATE INDEX "VerificationRun_node_version_created_idx" ON "VerificationRun"("knowledgeNodeVersionId", "createdAt");
CREATE INDEX "VerificationRun_protocol_status_idx" ON "VerificationRun"("protocolId", "status");
CREATE INDEX "VerificationRun_status_lease_idx" ON "VerificationRun"("status", "leaseExpiresAt");

CREATE TABLE "VerificationArtifact" (
  "id" TEXT NOT NULL, "verificationRunId" TEXT NOT NULL, "submittedByVerifierId" TEXT NOT NULL,
  "artifactKey" TEXT NOT NULL, "kind" TEXT NOT NULL, "mediaType" TEXT NOT NULL,
  "sha256" TEXT NOT NULL, "byteLength" INTEGER NOT NULL, "visibility" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'prepared', "storageRef" TEXT, "provenanceJson" TEXT NOT NULL,
  "preparedAt" TIMESTAMP(3) NOT NULL, "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
  "uploadedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VerificationArtifact_run_fkey" FOREIGN KEY ("verificationRunId") REFERENCES "VerificationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationArtifact_submitter_fkey" FOREIGN KEY ("submittedByVerifierId") REFERENCES "Verifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VerificationArtifact_run_key" ON "VerificationArtifact"("verificationRunId", "artifactKey");
CREATE INDEX "VerificationArtifact_run_status_idx" ON "VerificationArtifact"("verificationRunId", "status");
CREATE INDEX "VerificationArtifact_sha_idx" ON "VerificationArtifact"("sha256");

CREATE TABLE "VerificationArtifactBlob" (
  "artifactId" TEXT NOT NULL, "bytes" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationArtifactBlob_pkey" PRIMARY KEY ("artifactId"),
  CONSTRAINT "VerificationArtifactBlob_artifact_fkey" FOREIGN KEY ("artifactId") REFERENCES "VerificationArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "VerificationFinding" (
  "id" TEXT NOT NULL, "verificationRunId" TEXT NOT NULL, "submittedByVerifierId" TEXT NOT NULL,
  "findingKey" TEXT NOT NULL, "findingType" TEXT NOT NULL, "status" TEXT NOT NULL,
  "impact" TEXT NOT NULL, "statement" TEXT NOT NULL, "rationale" TEXT NOT NULL,
  "reportedJson" TEXT, "observedJson" TEXT, "toleranceJson" TEXT,
  "evidenceRefsJson" TEXT NOT NULL, "payloadJson" TEXT NOT NULL, "payloadSha256" TEXT NOT NULL,
  "supersedesFindingId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationFinding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VerificationFinding_run_fkey" FOREIGN KEY ("verificationRunId") REFERENCES "VerificationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationFinding_submitter_fkey" FOREIGN KEY ("submittedByVerifierId") REFERENCES "Verifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationFinding_supersedes_fkey" FOREIGN KEY ("supersedesFindingId") REFERENCES "VerificationFinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VerificationFinding_supersedes_key" ON "VerificationFinding"("supersedesFindingId");
CREATE UNIQUE INDEX "VerificationFinding_run_key" ON "VerificationFinding"("verificationRunId", "findingKey");
CREATE INDEX "VerificationFinding_run_status_idx" ON "VerificationFinding"("verificationRunId", "status");
CREATE INDEX "VerificationFinding_type_status_idx" ON "VerificationFinding"("findingType", "status");

CREATE TABLE "VerificationFindingArtifact" (
  "verificationFindingId" TEXT NOT NULL, "verificationArtifactId" TEXT NOT NULL,
  CONSTRAINT "VerificationFindingArtifact_pkey" PRIMARY KEY ("verificationFindingId", "verificationArtifactId"),
  CONSTRAINT "VerificationFindingArtifact_finding_fkey" FOREIGN KEY ("verificationFindingId") REFERENCES "VerificationFinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationFindingArtifact_artifact_fkey" FOREIGN KEY ("verificationArtifactId") REFERENCES "VerificationArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "VerificationFindingArtifact_artifact_idx" ON "VerificationFindingArtifact"("verificationArtifactId");

CREATE TABLE "VerificationRunLifecycleEvent" (
  "id" TEXT NOT NULL, "verificationRunId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "actorUserId" TEXT, "actorVerifierId" TEXT, "detailsJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationRunLifecycleEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VerificationRunLifecycleEvent_run_fkey" FOREIGN KEY ("verificationRunId") REFERENCES "VerificationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationRunLifecycleEvent_user_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationRunLifecycleEvent_verifier_fkey" FOREIGN KEY ("actorVerifierId") REFERENCES "Verifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "VerificationRunLifecycleEvent_run_created_idx" ON "VerificationRunLifecycleEvent"("verificationRunId", "createdAt");

ALTER TABLE "Verifier" ADD CONSTRAINT "Verifier_shape_check" CHECK (
  "status" IN ('active', 'suspended', 'retired')
  AND (("status" = 'retired' AND "retiredAt" IS NOT NULL) OR "status" <> 'retired')
);
ALTER TABLE "VerificationProtocol" ADD CONSTRAINT "VerificationProtocol_shape_check" CHECK (
  "status" IN ('active', 'retired')
  AND "executionMode" IN ('deterministic', 'human', 'ai', 'hybrid', 'external-execution')
  AND length("definitionSha256") = 64
  AND ("supersedesProtocolId" IS NULL OR "supersedesProtocolId" <> "id")
);
ALTER TABLE "VerifierCredential" ADD CONSTRAINT "VerifierCredential_shape_check" CHECK (
  length("tokenPrefix") = 12 AND length("tokenHash") = 64
  AND "scopesJson" IN ('["verification:read"]', '["verification:submit"]', '["verification:read","verification:submit"]')
  AND (("revokedAt" IS NULL AND "revokedById" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL))
);
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_shape_check" CHECK (
  (("publicationVersionId" IS NOT NULL)::int + ("publicationClaimOccurrenceId" IS NOT NULL)::int + ("knowledgeNodeVersionId" IS NOT NULL)::int) = 1
  AND "status" IN ('requested', 'claimed', 'running', 'completed', 'failed', 'cancelled')
  AND "inputProfile" IN ('full', 'blinded-scientific') AND length("inputSha256") = 64
  AND (("status" = 'requested' AND "claimedVerifierId" IS NULL AND "leaseTokenHash" IS NULL AND "leaseIssuedAt" IS NULL AND "leaseExpiresAt" IS NULL AND "leaseGeneration" = 0)
    OR ("status" IN ('claimed', 'running') AND "claimedVerifierId" IS NOT NULL AND length("leaseTokenHash") = 64 AND "leaseIssuedAt" IS NOT NULL AND "leaseExpiresAt" > "leaseIssuedAt" AND "leaseGeneration" > 0)
    OR ("status" IN ('completed', 'failed', 'cancelled') AND "completedAt" IS NOT NULL))
  AND (("status" IN ('failed', 'cancelled') AND length("terminalReason") BETWEEN 1 AND 4000)
    OR ("status" IN ('requested', 'claimed', 'running', 'completed') AND "terminalReason" IS NULL))
);
ALTER TABLE "VerificationArtifact" ADD CONSTRAINT "VerificationArtifact_shape_check" CHECK (
  "status" IN ('prepared', 'uploaded', 'completed') AND "visibility" IN ('private', 'public')
  AND length("sha256") = 64 AND "byteLength" BETWEEN 0 AND 8388608 AND "uploadExpiresAt" > "preparedAt"
  AND (("status" = 'prepared' AND "storageRef" IS NULL AND "uploadedAt" IS NULL AND "completedAt" IS NULL)
    OR ("status" = 'uploaded' AND "storageRef" IS NOT NULL AND "uploadedAt" IS NOT NULL AND "completedAt" IS NULL)
    OR ("status" = 'completed' AND "storageRef" IS NOT NULL AND "uploadedAt" IS NOT NULL AND "completedAt" IS NOT NULL))
);
ALTER TABLE "VerificationFinding" ADD CONSTRAINT "VerificationFinding_shape_check" CHECK (
  "status" IN ('verified', 'partially-verified', 'discrepancy', 'failed', 'unverifiable', 'not-applicable')
  AND "impact" IN ('informational', 'minor', 'major', 'critical') AND length("payloadSha256") = 64
  AND length("statement") BETWEEN 1 AND 10000 AND length("rationale") BETWEEN 1 AND 20000
  AND ("supersedesFindingId" IS NULL OR "supersedesFindingId" <> "id")
);
ALTER TABLE "VerificationFindingArtifact" ADD CONSTRAINT "VerificationFindingArtifact_shape_check" CHECK (
  "verificationFindingId" <> '' AND "verificationArtifactId" <> ''
);
ALTER TABLE "VerificationRunLifecycleEvent" ADD CONSTRAINT "VerificationRunLifecycleEvent_shape_check" CHECK (
  "kind" IN ('requested', 'claimed', 'reclaimed', 'running', 'completed', 'failed', 'cancelled')
  AND (("actorUserId" IS NOT NULL)::int + ("actorVerifierId" IS NOT NULL)::int) = 1
);

CREATE OR REPLACE FUNCTION "oratlas_protect_verification"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'VerificationProtocol' AND TG_OP = 'UPDATE' THEN
    IF NEW."authorityVerifierId" IS DISTINCT FROM OLD."authorityVerifierId" OR NEW."seriesKey" IS DISTINCT FROM OLD."seriesKey"
      OR NEW."protocolVersion" IS DISTINCT FROM OLD."protocolVersion" OR NEW."title" IS DISTINCT FROM OLD."title"
      OR NEW."description" IS DISTINCT FROM OLD."description" OR NEW."verificationType" IS DISTINCT FROM OLD."verificationType"
      OR NEW."executionMode" IS DISTINCT FROM OLD."executionMode" OR NEW."supportedSubjectTypesJson" IS DISTINCT FROM OLD."supportedSubjectTypesJson"
      OR NEW."definitionJson" IS DISTINCT FROM OLD."definitionJson" OR NEW."definitionSha256" IS DISTINCT FROM OLD."definitionSha256"
      OR NEW."supersedesProtocolId" IS DISTINCT FROM OLD."supersedesProtocolId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN RAISE EXCEPTION 'Verification protocol definition is immutable'; END IF;
    IF OLD."status" = 'retired' AND NEW."status" IS DISTINCT FROM OLD."status"
    THEN RAISE EXCEPTION 'A retired verification protocol cannot be reactivated'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'VerifierCredential' AND TG_OP = 'UPDATE' THEN
    IF NEW."verifierId" IS DISTINCT FROM OLD."verifierId" OR NEW."label" IS DISTINCT FROM OLD."label"
      OR NEW."tokenPrefix" IS DISTINCT FROM OLD."tokenPrefix" OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash"
      OR NEW."scopesJson" IS DISTINCT FROM OLD."scopesJson" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
      OR NEW."issuedById" IS DISTINCT FROM OLD."issuedById" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR (OLD."revokedAt" IS NOT NULL AND (NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" OR NEW."revokedById" IS DISTINCT FROM OLD."revokedById"))
    THEN RAISE EXCEPTION 'Verifier credential ownership and scopes are immutable'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'VerificationRun' AND TG_OP = 'UPDATE' THEN
    IF NEW."protocolId" IS DISTINCT FROM OLD."protocolId" OR NEW."publicationVersionId" IS DISTINCT FROM OLD."publicationVersionId"
      OR NEW."publicationClaimOccurrenceId" IS DISTINCT FROM OLD."publicationClaimOccurrenceId" OR NEW."knowledgeNodeVersionId" IS DISTINCT FROM OLD."knowledgeNodeVersionId"
      OR NEW."inputProfile" IS DISTINCT FROM OLD."inputProfile" OR NEW."inputProfileVersion" IS DISTINCT FROM OLD."inputProfileVersion"
      OR NEW."inputSchemaVersion" IS DISTINCT FROM OLD."inputSchemaVersion" OR NEW."inputJson" IS DISTINCT FROM OLD."inputJson"
      OR NEW."inputSha256" IS DISTINCT FROM OLD."inputSha256" OR NEW."inputCapturedAt" IS DISTINCT FROM OLD."inputCapturedAt"
      OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById"
      OR NEW."requestedAt" IS DISTINCT FROM OLD."requestedAt" OR NEW."agentRunId" IS DISTINCT FROM OLD."agentRunId"
      OR NEW."executionPassportId" IS DISTINCT FROM OLD."executionPassportId" OR NEW."replicationBriefId" IS DISTINCT FROM OLD."replicationBriefId"
    THEN RAISE EXCEPTION 'Verification run subject and input snapshot are immutable'; END IF;
    IF OLD."status" IN ('completed', 'failed', 'cancelled') THEN RAISE EXCEPTION 'Verification run terminal state is immutable'; END IF;
    IF NOT ((OLD."status" = 'requested' AND NEW."status" IN ('claimed', 'cancelled'))
      OR (OLD."status" = 'claimed' AND NEW."status" IN ('claimed', 'running', 'failed', 'cancelled'))
      OR (OLD."status" = 'running' AND NEW."status" IN ('claimed', 'completed', 'failed', 'cancelled')))
    THEN RAISE EXCEPTION 'Invalid verification run transition'; END IF;
    IF OLD."status" IN ('claimed', 'running') AND NEW."status" = 'claimed'
      AND (OLD."leaseExpiresAt" > CURRENT_TIMESTAMP OR NEW."leaseGeneration" <> OLD."leaseGeneration" + 1)
    THEN RAISE EXCEPTION 'Verification lease cannot be replaced before expiry'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'VerificationArtifact' AND TG_OP = 'UPDATE' THEN
    IF NEW."verificationRunId" IS DISTINCT FROM OLD."verificationRunId" OR NEW."submittedByVerifierId" IS DISTINCT FROM OLD."submittedByVerifierId"
      OR NEW."artifactKey" IS DISTINCT FROM OLD."artifactKey" OR NEW."kind" IS DISTINCT FROM OLD."kind"
      OR NEW."mediaType" IS DISTINCT FROM OLD."mediaType" OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
      OR NEW."byteLength" IS DISTINCT FROM OLD."byteLength" OR NEW."visibility" IS DISTINCT FROM OLD."visibility"
      OR NEW."provenanceJson" IS DISTINCT FROM OLD."provenanceJson" OR NEW."preparedAt" IS DISTINCT FROM OLD."preparedAt"
      OR NEW."uploadExpiresAt" IS DISTINCT FROM OLD."uploadExpiresAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN RAISE EXCEPTION 'Verification artifact metadata is immutable'; END IF;
    IF NOT ((OLD."status" = 'prepared' AND NEW."status" = 'uploaded') OR (OLD."status" = 'uploaded' AND NEW."status" = 'completed'))
    THEN RAISE EXCEPTION 'Invalid verification artifact transition'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Verification evidence records are append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "VerificationProtocol_immutable_guard" BEFORE UPDATE OR DELETE ON "VerificationProtocol" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_verification"();
CREATE TRIGGER "VerifierCredential_immutable_guard" BEFORE UPDATE OR DELETE ON "VerifierCredential" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_verification"();
CREATE TRIGGER "VerificationRun_immutable_guard" BEFORE UPDATE OR DELETE ON "VerificationRun" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_verification"();
CREATE TRIGGER "VerificationArtifact_immutable_guard" BEFORE UPDATE OR DELETE ON "VerificationArtifact" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_verification"();
CREATE TRIGGER "VerificationArtifactBlob_immutable_guard" BEFORE UPDATE OR DELETE ON "VerificationArtifactBlob" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_verification"();
CREATE TRIGGER "VerificationFinding_immutable_guard" BEFORE UPDATE OR DELETE ON "VerificationFinding" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_verification"();
CREATE TRIGGER "VerificationFindingArtifact_immutable_guard" BEFORE UPDATE OR DELETE ON "VerificationFindingArtifact" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_verification"();
CREATE TRIGGER "VerificationRunLifecycleEvent_immutable_guard" BEFORE UPDATE OR DELETE ON "VerificationRunLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_verification"();

CREATE OR REPLACE FUNCTION "oratlas_validate_verification_binding"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'VerificationArtifact' THEN
    IF NOT EXISTS (SELECT 1 FROM "VerificationRun" r WHERE r."id" = NEW."verificationRunId"
      AND r."claimedVerifierId" = NEW."submittedByVerifierId" AND r."status" IN ('claimed', 'running'))
    THEN RAISE EXCEPTION 'Verification artifact does not match the active run claimant'; END IF;
  ELSIF TG_TABLE_NAME = 'VerificationFinding' THEN
    IF NOT EXISTS (SELECT 1 FROM "VerificationRun" r WHERE r."id" = NEW."verificationRunId"
      AND r."claimedVerifierId" = NEW."submittedByVerifierId" AND r."status" IN ('claimed', 'running'))
    THEN RAISE EXCEPTION 'Verification finding does not match the active run claimant'; END IF;
    IF NEW."supersedesFindingId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "VerificationFinding" f
      WHERE f."id" = NEW."supersedesFindingId" AND f."verificationRunId" = NEW."verificationRunId")
    THEN RAISE EXCEPTION 'Verification finding supersession binding is invalid'; END IF;
  ELSIF TG_TABLE_NAME = 'VerificationFindingArtifact' THEN
    IF NOT EXISTS (SELECT 1 FROM "VerificationFinding" f JOIN "VerificationArtifact" a
        ON a."verificationRunId" = f."verificationRunId"
        WHERE f."id" = NEW."verificationFindingId" AND a."id" = NEW."verificationArtifactId" AND a."status" = 'completed')
    THEN RAISE EXCEPTION 'Verification finding artifact binding is invalid'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "VerificationArtifact_binding_guard" BEFORE INSERT ON "VerificationArtifact" FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_verification_binding"();
CREATE TRIGGER "VerificationFinding_binding_guard" BEFORE INSERT ON "VerificationFinding" FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_verification_binding"();
CREATE TRIGGER "VerificationFindingArtifact_binding_guard" BEFORE INSERT ON "VerificationFindingArtifact" FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_verification_binding"();
