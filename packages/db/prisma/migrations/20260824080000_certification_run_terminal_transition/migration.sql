ALTER TABLE "CertificationRun" ADD COLUMN "terminalReason" TEXT;

ALTER TABLE "CertificationRun" DROP CONSTRAINT IF EXISTS "CertificationRun_shape_check";
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_shape_check" CHECK (
  "assessmentMode" IN ('human', 'ai', 'hybrid')
  AND "status" IN ('requested', 'running', 'completed', 'failed', 'cancelled')
  AND length("inputPacketSha256") = 64
  AND (
    ("status" IN ('completed', 'failed', 'cancelled') AND "completedAt" IS NOT NULL)
    OR ("status" IN ('requested', 'running') AND "completedAt" IS NULL)
  )
  AND (
    ("status" IN ('failed', 'cancelled') AND "terminalReason" IS NOT NULL AND length("terminalReason") BETWEEN 1 AND 4000)
    OR ("status" IN ('requested', 'running', 'completed') AND "terminalReason" IS NULL)
  )
);

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
    IF NEW."publicationVersionId" IS DISTINCT FROM OLD."publicationVersionId"
      OR NEW."certifierId" IS DISTINCT FROM OLD."certifierId" OR NEW."protocolId" IS DISTINCT FROM OLD."protocolId"
      OR NEW."assessmentMode" IS DISTINCT FROM OLD."assessmentMode" OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
      OR NEW."inputPacketJson" IS DISTINCT FROM OLD."inputPacketJson" OR NEW."inputPacketSha256" IS DISTINCT FROM OLD."inputPacketSha256"
      OR NEW."packetSchemaVersion" IS DISTINCT FROM OLD."packetSchemaVersion" OR NEW."completenessJson" IS DISTINCT FROM OLD."completenessJson"
      OR NEW."capturedAt" IS DISTINCT FROM OLD."capturedAt"
    THEN RAISE EXCEPTION 'Certification run input snapshot is immutable'; END IF;
    IF OLD."status" IN ('completed', 'failed', 'cancelled') AND (
      NEW."status" IS DISTINCT FROM OLD."status" OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
      OR NEW."terminalReason" IS DISTINCT FROM OLD."terminalReason"
    ) THEN RAISE EXCEPTION 'Certification run terminal state is immutable'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Certification protocol, result, and lifecycle records are append-only';
END;
$$ LANGUAGE plpgsql;
