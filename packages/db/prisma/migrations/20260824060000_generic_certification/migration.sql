-- Generic, certifier-neutral certification infrastructure. Certification is
-- an attributed assertion about one exact PublicationVersion packet snapshot.

CREATE TABLE "Certifier" (
  "id" TEXT NOT NULL, "slug" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT NOT NULL, "publicUrl" TEXT, "governanceUrl" TEXT,
  "publicContact" TEXT, "status" TEXT NOT NULL DEFAULT 'active',
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3), "retiredAt" TIMESTAMP(3),
  CONSTRAINT "Certifier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Certifier_createdBy_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Certifier_slug_key" ON "Certifier"("slug");
CREATE INDEX "Certifier_status_name_idx" ON "Certifier"("status", "name");

CREATE TABLE "CertificationProtocol" (
  "id" TEXT NOT NULL, "certifierId" TEXT NOT NULL, "seriesKey" TEXT NOT NULL,
  "protocolVersion" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT NOT NULL,
  "protocolJson" TEXT NOT NULL, "protocolSha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active', "supersedesProtocolId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CertificationProtocol_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CertificationProtocol_certifier_fkey" FOREIGN KEY ("certifierId") REFERENCES "Certifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationProtocol_supersedes_fkey" FOREIGN KEY ("supersedesProtocolId") REFERENCES "CertificationProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CertificationProtocol_supersedes_key" ON "CertificationProtocol"("supersedesProtocolId");
CREATE UNIQUE INDEX "CertificationProtocol_version_key" ON "CertificationProtocol"("certifierId", "seriesKey", "protocolVersion");
CREATE INDEX "CertificationProtocol_certifier_status_idx" ON "CertificationProtocol"("certifierId", "status");

CREATE TABLE "CertifierCredential" (
  "id" TEXT NOT NULL, "certifierId" TEXT NOT NULL, "label" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "scopesJson" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "issuedById" TEXT NOT NULL,
  "revokedById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3), CONSTRAINT "CertifierCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CertifierCredential_certifier_fkey" FOREIGN KEY ("certifierId") REFERENCES "Certifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertifierCredential_issuer_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertifierCredential_revoker_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CertifierCredential_tokenPrefix_key" ON "CertifierCredential"("tokenPrefix");
CREATE UNIQUE INDEX "CertifierCredential_tokenHash_key" ON "CertifierCredential"("tokenHash");
CREATE INDEX "CertifierCredential_certifier_revoked_idx" ON "CertifierCredential"("certifierId", "revokedAt");

CREATE TABLE "CertificationRun" (
  "id" TEXT NOT NULL, "publicationVersionId" TEXT NOT NULL, "certifierId" TEXT NOT NULL,
  "protocolId" TEXT NOT NULL, "assessmentMode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'requested', "requestedById" TEXT,
  "externalRunReference" TEXT, "idempotencyKey" TEXT NOT NULL,
  "inputPacketJson" TEXT NOT NULL, "inputPacketSha256" TEXT NOT NULL,
  "packetSchemaVersion" TEXT NOT NULL, "completenessJson" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CertificationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CertificationRun_version_fkey" FOREIGN KEY ("publicationVersionId") REFERENCES "PublicationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationRun_certifier_fkey" FOREIGN KEY ("certifierId") REFERENCES "Certifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationRun_protocol_fkey" FOREIGN KEY ("protocolId") REFERENCES "CertificationProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationRun_requester_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CertificationRun_idempotency_key" ON "CertificationRun"("certifierId", "idempotencyKey");
CREATE INDEX "CertificationRun_version_created_idx" ON "CertificationRun"("publicationVersionId", "createdAt");
CREATE INDEX "CertificationRun_protocol_status_idx" ON "CertificationRun"("protocolId", "status");

CREATE TABLE "CertificationResult" (
  "id" TEXT NOT NULL, "certificationRunId" TEXT NOT NULL,
  "publicationVersionId" TEXT NOT NULL, "certifierId" TEXT NOT NULL,
  "protocolId" TEXT NOT NULL, "inputPacketSha256" TEXT NOT NULL,
  "assessmentMode" TEXT NOT NULL, "criteriaJson" TEXT NOT NULL, "outcome" TEXT NOT NULL,
  "limitationsJson" TEXT NOT NULL, "conflictOfInterestJson" TEXT NOT NULL,
  "independenceJson" TEXT NOT NULL, "provenanceJson" TEXT NOT NULL,
  "resultJson" TEXT NOT NULL, "resultSha256" TEXT NOT NULL, "agentRunId" TEXT,
  "executionPassportId" TEXT, "supersedesResultId" TEXT, "issuedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CertificationResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CertificationResult_run_fkey" FOREIGN KEY ("certificationRunId") REFERENCES "CertificationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationResult_version_fkey" FOREIGN KEY ("publicationVersionId") REFERENCES "PublicationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationResult_certifier_fkey" FOREIGN KEY ("certifierId") REFERENCES "Certifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationResult_protocol_fkey" FOREIGN KEY ("protocolId") REFERENCES "CertificationProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationResult_agentRun_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationResult_passport_fkey" FOREIGN KEY ("executionPassportId") REFERENCES "ExecutionPassport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationResult_supersedes_fkey" FOREIGN KEY ("supersedesResultId") REFERENCES "CertificationResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CertificationResult_run_key" ON "CertificationResult"("certificationRunId");
CREATE UNIQUE INDEX "CertificationResult_supersedes_key" ON "CertificationResult"("supersedesResultId");
CREATE INDEX "CertificationResult_version_issued_idx" ON "CertificationResult"("publicationVersionId", "issuedAt");
CREATE INDEX "CertificationResult_certifier_issued_idx" ON "CertificationResult"("certifierId", "issuedAt");

CREATE TABLE "CertificationLifecycleEvent" (
  "id" TEXT NOT NULL, "resultId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "reason" TEXT, "actorUserId" TEXT, "actorCertifierId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CertificationLifecycleEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CertificationLifecycleEvent_result_fkey" FOREIGN KEY ("resultId") REFERENCES "CertificationResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationLifecycleEvent_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CertificationLifecycleEvent_certifier_fkey" FOREIGN KEY ("actorCertifierId") REFERENCES "Certifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CertificationLifecycleEvent_result_created_idx" ON "CertificationLifecycleEvent"("resultId", "createdAt");
CREATE UNIQUE INDEX "CertificationLifecycleEvent_result_kind_key" ON "CertificationLifecycleEvent"("resultId", "kind");

ALTER TABLE "Certifier" ADD CONSTRAINT "Certifier_shape_check" CHECK ("status" IN ('active', 'suspended', 'retired') AND (("status" = 'retired' AND "retiredAt" IS NOT NULL) OR "status" <> 'retired'));
ALTER TABLE "CertificationProtocol" ADD CONSTRAINT "CertificationProtocol_shape_check" CHECK ("status" IN ('active', 'retired') AND length("protocolSha256") = 64 AND ("supersedesProtocolId" IS NULL OR "supersedesProtocolId" <> "id"));
ALTER TABLE "CertifierCredential" ADD CONSTRAINT "CertifierCredential_shape_check" CHECK (length("tokenPrefix") = 12 AND length("tokenHash") = 64 AND "scopesJson" IN ('["certification:read"]', '["certification:submit"]', '["certification:read","certification:submit"]') AND (("revokedAt" IS NULL AND "revokedById" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL)));
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_shape_check" CHECK ("assessmentMode" IN ('human', 'ai', 'hybrid') AND "status" IN ('requested', 'running', 'completed', 'failed', 'cancelled') AND length("inputPacketSha256") = 64 AND (("status" = 'completed' AND "completedAt" IS NOT NULL) OR "status" <> 'completed'));
ALTER TABLE "CertificationResult" ADD CONSTRAINT "CertificationResult_shape_check" CHECK ("assessmentMode" IN ('human', 'ai', 'hybrid') AND "outcome" IN ('certified', 'certified-with-conditions', 'not-certified', 'inconclusive') AND length("inputPacketSha256") = 64 AND length("resultSha256") = 64 AND ("supersedesResultId" IS NULL OR "supersedesResultId" <> "id"));
ALTER TABLE "CertificationLifecycleEvent" ADD CONSTRAINT "CertificationLifecycleEvent_shape_check" CHECK ("kind" IN ('issued', 'superseded', 'withdrawn', 'revoked') AND (("actorUserId" IS NOT NULL)::int + ("actorCertifierId" IS NOT NULL)::int) = 1);

CREATE OR REPLACE FUNCTION "oratlas_protect_certification"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'CertificationProtocol' AND TG_OP = 'UPDATE' THEN
    IF NEW."certifierId" IS DISTINCT FROM OLD."certifierId" OR NEW."seriesKey" IS DISTINCT FROM OLD."seriesKey"
      OR NEW."protocolVersion" IS DISTINCT FROM OLD."protocolVersion" OR NEW."title" IS DISTINCT FROM OLD."title"
      OR NEW."description" IS DISTINCT FROM OLD."description" OR NEW."protocolJson" IS DISTINCT FROM OLD."protocolJson"
      OR NEW."protocolSha256" IS DISTINCT FROM OLD."protocolSha256" OR NEW."supersedesProtocolId" IS DISTINCT FROM OLD."supersedesProtocolId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN RAISE EXCEPTION 'Certification protocol definition is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'CertificationRun' AND TG_OP = 'UPDATE' THEN
    IF NEW."publicationVersionId" IS DISTINCT FROM OLD."publicationVersionId" OR NEW."certifierId" IS DISTINCT FROM OLD."certifierId"
      OR NEW."protocolId" IS DISTINCT FROM OLD."protocolId" OR NEW."assessmentMode" IS DISTINCT FROM OLD."assessmentMode"
      OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" OR NEW."inputPacketJson" IS DISTINCT FROM OLD."inputPacketJson"
      OR NEW."inputPacketSha256" IS DISTINCT FROM OLD."inputPacketSha256" OR NEW."packetSchemaVersion" IS DISTINCT FROM OLD."packetSchemaVersion"
      OR NEW."completenessJson" IS DISTINCT FROM OLD."completenessJson" OR NEW."capturedAt" IS DISTINCT FROM OLD."capturedAt"
    THEN RAISE EXCEPTION 'Certification run input snapshot is immutable'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Certification protocol, result, and lifecycle records are append-only';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "CertificationProtocol_immutable_guard" BEFORE UPDATE OR DELETE ON "CertificationProtocol" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_certification"();
CREATE TRIGGER "CertificationRun_snapshot_immutable_guard" BEFORE UPDATE OR DELETE ON "CertificationRun" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_certification"();
CREATE TRIGGER "CertificationResult_immutable_guard" BEFORE UPDATE OR DELETE ON "CertificationResult" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_certification"();
CREATE TRIGGER "CertificationLifecycleEvent_immutable_guard" BEFORE UPDATE OR DELETE ON "CertificationLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_certification"();

CREATE OR REPLACE FUNCTION "oratlas_validate_certification_result_binding"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CertificationRun" r WHERE r."id" = NEW."certificationRunId"
    AND r."publicationVersionId" = NEW."publicationVersionId" AND r."certifierId" = NEW."certifierId"
    AND r."protocolId" = NEW."protocolId" AND r."assessmentMode" = NEW."assessmentMode"
    AND r."inputPacketSha256" = NEW."inputPacketSha256")
  THEN RAISE EXCEPTION 'Certification result does not exactly match its run'; END IF;
  IF NEW."supersedesResultId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CertificationResult" p
    WHERE p."id" = NEW."supersedesResultId" AND p."publicationVersionId" = NEW."publicationVersionId"
    AND p."certifierId" = NEW."certifierId" AND p."protocolId" = NEW."protocolId")
  THEN RAISE EXCEPTION 'Certification supersession binding is invalid'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "CertificationResult_binding_guard" BEFORE INSERT ON "CertificationResult" FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_certification_result_binding"();
