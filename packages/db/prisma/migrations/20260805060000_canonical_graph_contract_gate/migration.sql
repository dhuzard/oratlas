-- Dormant until oratlas_finalize_canonical_graph_contract() globally verifies
-- the backfill. Deferred triggers let atomic writers create relational rows
-- before graph bindings while still rejecting incomplete commits.

-- Publication lifecycle is mutable access-control state, not immutable review
-- knowledge. Normalize graph versions created by the expand/dual-write phase
-- before activating the contract. Fail closed if a row is not the exact legacy
-- shape this migration knows how to upgrade.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "KnowledgeNodeVersion" v
    JOIN "ReviewVersion" rv ON rv."id" = v."sourceReviewVersionId"
    WHERE v."payloadJson"::jsonb <> jsonb_build_object(
      'publicState', v."payloadJson"::jsonb ->> 'publicState',
      'recordSourceType', rv."recordSourceType",
      'reviewId', rv."reviewId",
      'reviewVersionId', rv."id"
    )
      OR NOT (v."payloadJson"::jsonb ? 'publicState')
  ) THEN
    RAISE EXCEPTION 'Cannot normalize canonical review payload: unexpected legacy bytes';
  END IF;
END;
$$;

UPDATE "KnowledgeNodeVersion" v
SET "payloadJson" = format(
  '{"recordSourceType":%s,"reviewId":%s,"reviewVersionId":%s}',
  to_jsonb(rv."recordSourceType")::text,
  to_jsonb(rv."reviewId")::text,
  to_jsonb(rv."id")::text
)
FROM "ReviewVersion" rv
WHERE rv."id" = v."sourceReviewVersionId";

CREATE TABLE "CanonicalGraphContractState" (
  "id" INTEGER NOT NULL,
  "enforced" BOOLEAN NOT NULL DEFAULT false,
  "backupId" TEXT,
  "manifestDigest" TEXT,
  "enforcedAt" TIMESTAMP(3),
  CONSTRAINT "CanonicalGraphContractState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CanonicalGraphContractState_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "CanonicalGraphContractState_shape_check" CHECK (
    ("enforced" = false AND "backupId" IS NULL AND "manifestDigest" IS NULL AND "enforcedAt" IS NULL)
    OR ("enforced" = true
      AND "backupId" IS NOT NULL
      AND char_length("backupId") BETWEEN 1 AND 300
      AND "backupId" ~ '^[A-Za-z0-9._/-]+$'
      AND "manifestDigest" IS NOT NULL
      AND "manifestDigest" ~ '^[a-f0-9]{64}$'
      AND "enforcedAt" IS NOT NULL)
  )
);
INSERT INTO "CanonicalGraphContractState" ("id", "enforced") VALUES (1, false);

ALTER TABLE "Review" DROP CONSTRAINT "Review_knowledgeNodeId_fkey";
ALTER TABLE "Review" ADD CONSTRAINT "Review_knowledgeNodeId_fkey"
  FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Citation" DROP CONSTRAINT "Citation_knowledgeNodeId_fkey";
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_knowledgeNodeId_fkey"
  FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClaimEvidenceRelation" DROP CONSTRAINT "ClaimEvidenceRelation_nodeEdgeId_fkey";
ALTER TABLE "ClaimEvidenceRelation" ADD CONSTRAINT "ClaimEvidenceRelation_nodeEdgeId_fkey"
  FOREIGN KEY ("nodeEdgeId") REFERENCES "NodeEdge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "oratlas_canonical_graph_contract_enabled"() RETURNS boolean AS $$
  SELECT COALESCE((SELECT "enforced" FROM "CanonicalGraphContractState" WHERE "id" = 1), false);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION "oratlas_validate_canonical_graph_row"() RETURNS trigger AS $$
BEGIN
  IF NOT "oratlas_canonical_graph_contract_enabled"() THEN RETURN NEW; END IF;
  -- Deferred trigger events retain their original NEW image. Always re-read
  -- the surviving row so insert-null/update-complete transactions validate
  -- their final committed state, while insert-then-delete leaves no row to reject.
  IF TG_TABLE_NAME = 'Review' AND EXISTS (SELECT 1 FROM "Review" r WHERE r."id" = NEW."id" AND (
    r."knowledgeNodeId" IS NULL OR NOT EXISTS (SELECT 1 FROM "KnowledgeNode" n
      WHERE n."id" = r."knowledgeNodeId" AND n."kind" = 'review' AND n."originType" = 'review-record'
        AND n."stableKey" = 'review:' || r."id")))
  THEN RAISE EXCEPTION 'Canonical graph contract: invalid review binding'; END IF;
  IF TG_TABLE_NAME = 'ReviewVersion' AND EXISTS (SELECT 1 FROM "ReviewVersion" rv
    WHERE rv."id" = NEW."id" AND NOT EXISTS (SELECT 1 FROM "Review" r JOIN "KnowledgeNodeVersion" v
      ON v."sourceReviewVersionId" = rv."id" AND v."knowledgeNodeId" = r."knowledgeNodeId"
      WHERE r."id" = rv."reviewId" AND v."payloadJson"::jsonb = jsonb_build_object(
        'recordSourceType', rv."recordSourceType",
        'reviewId', rv."reviewId",
        'reviewVersionId', rv."id"
      )))
  THEN RAISE EXCEPTION 'Canonical graph contract: missing exact review-version binding'; END IF;
  IF TG_TABLE_NAME = 'Claim' AND EXISTS (SELECT 1 FROM "Claim" current_claim
    WHERE current_claim."id" = NEW."id" AND (current_claim."knowledgeNodeId" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "KnowledgeNode" n JOIN "KnowledgeNodeVersion" cv
      ON cv."knowledgeNodeId" = n."id" AND cv."sourceClaimId" = current_claim."id"
    JOIN "ReviewVersion" rv ON rv."id" = current_claim."reviewVersionId"
    JOIN "KnowledgeNodeVersion" rgv ON rgv."sourceReviewVersionId" = rv."id"
    JOIN "NodeEdge" e ON e."sourceNodeVersionId" = rgv."id" AND e."targetNodeId" = n."id"
      AND e."confirmedTargetNodeVersionId" = cv."id" AND e."relationType" = 'asserts'
      AND e."edgeDiscriminator" = current_claim."id" AND e."status" = 'source-assertion'
      AND e."provenance" = 'imported-from-review' AND e."confirmedById" IS NULL
    WHERE n."id" = current_claim."knowledgeNodeId" AND n."kind" = 'claim')))
  THEN RAISE EXCEPTION 'Canonical graph contract: invalid claim binding'; END IF;
  IF TG_TABLE_NAME = 'Citation' AND EXISTS (SELECT 1 FROM "Citation" current_citation
    WHERE current_citation."id" = NEW."id" AND (current_citation."workId" IS NULL
      OR current_citation."knowledgeNodeId" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "KnowledgeNode" n JOIN "KnowledgeNodeVersion" v
      ON v."knowledgeNodeId" = n."id" AND v."sourceCitationId" = current_citation."id"
    WHERE n."id" = current_citation."knowledgeNodeId" AND n."kind" = 'work'
      AND n."originType" = 'canonical-work' AND n."stableKey" = current_citation."workId")))
  THEN RAISE EXCEPTION 'Canonical graph contract: invalid citation/work binding'; END IF;
  IF TG_TABLE_NAME = 'ClaimEvidenceRelation' AND EXISTS (SELECT 1 FROM "ClaimEvidenceRelation" current_relation
    WHERE current_relation."id" = NEW."id" AND (current_relation."nodeEdgeId" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "Claim" c JOIN "KnowledgeNodeVersion" cv ON cv."sourceClaimId" = c."id"
    JOIN "Citation" i ON i."id" = current_relation."citationId"
    JOIN "KnowledgeNodeVersion" iv ON iv."sourceCitationId" = i."id"
    JOIN "NodeEdge" e ON e."id" = current_relation."nodeEdgeId" AND e."sourceNodeVersionId" = cv."id"
      AND e."targetNodeId" = i."knowledgeNodeId" AND e."confirmedTargetNodeVersionId" = iv."id"
      AND e."relationType" = current_relation."relationType" AND e."edgeDiscriminator" = current_relation."id"
      AND e."status" = 'source-assertion' AND e."provenance" = 'imported-from-review'
      AND e."confirmedById" IS NULL WHERE c."id" = current_relation."claimId")))
  THEN RAISE EXCEPTION 'Canonical graph contract: invalid compatibility edge binding'; END IF;
  IF TG_TABLE_NAME = 'KnowledgeNodeVersion' AND EXISTS (SELECT 1 FROM "KnowledgeNodeVersion" v
    WHERE v."id" = NEW."id" AND ((v."sourceReviewVersionId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "ReviewVersion" rv JOIN "Review" r ON r."id" = rv."reviewId"
      WHERE rv."id" = v."sourceReviewVersionId" AND r."knowledgeNodeId" = v."knowledgeNodeId"))
    OR (v."sourceClaimId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Claim" c
      WHERE c."id" = v."sourceClaimId" AND c."knowledgeNodeId" = v."knowledgeNodeId"))
    OR (v."sourceCitationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Citation" i
      WHERE i."id" = v."sourceCitationId" AND i."knowledgeNodeId" = v."knowledgeNodeId"))))
  THEN RAISE EXCEPTION 'Canonical graph contract: reverse exact-version binding mismatch'; END IF;
  IF TG_TABLE_NAME = 'NodeEdge' AND EXISTS (SELECT 1 FROM "NodeEdge" current_edge
    WHERE current_edge."id" = NEW."id" AND current_edge."status" = 'source-assertion'
      AND current_edge."provenance" = 'imported-from-review'
      AND NOT EXISTS (SELECT 1 FROM "ClaimEvidenceRelation" r WHERE r."nodeEdgeId" = current_edge."id")
      AND NOT (current_edge."relationType" = 'asserts' AND EXISTS (
      SELECT 1 FROM "Claim" c JOIN "KnowledgeNodeVersion" cv ON cv."sourceClaimId" = c."id"
      JOIN "ReviewVersion" rv ON rv."id" = c."reviewVersionId"
      JOIN "KnowledgeNodeVersion" rgv ON rgv."sourceReviewVersionId" = rv."id"
      WHERE c."id" = current_edge."edgeDiscriminator" AND c."knowledgeNodeId" = current_edge."targetNodeId"
        AND cv."id" = current_edge."confirmedTargetNodeVersionId" AND rgv."id" = current_edge."sourceNodeVersionId")))
  THEN RAISE EXCEPTION 'Canonical graph contract: orphan source assertion'; END IF;
  IF TG_TABLE_NAME = 'NodeEdge' AND EXISTS (SELECT 1 FROM "NodeEdge" current_edge
    WHERE current_edge."id" = NEW."id" AND EXISTS (
      SELECT 1 FROM "ClaimEvidenceRelation" r WHERE r."nodeEdgeId" = current_edge."id") AND NOT EXISTS (
    SELECT 1 FROM "ClaimEvidenceRelation" r
    JOIN "KnowledgeNodeVersion" cv ON cv."sourceClaimId" = r."claimId"
    JOIN "Citation" i ON i."id" = r."citationId"
    JOIN "KnowledgeNodeVersion" iv ON iv."sourceCitationId" = i."id"
    WHERE r."nodeEdgeId" = current_edge."id" AND current_edge."sourceNodeVersionId" = cv."id"
      AND current_edge."targetNodeId" = i."knowledgeNodeId" AND current_edge."confirmedTargetNodeVersionId" = iv."id"
      AND current_edge."relationType" = r."relationType" AND current_edge."edgeDiscriminator" = r."id"
      AND current_edge."status" = 'source-assertion' AND current_edge."provenance" = 'imported-from-review'
      AND current_edge."confirmedById" IS NULL))
  THEN RAISE EXCEPTION 'Canonical graph contract: source assertion semantics mismatch'; END IF;
  IF TG_TABLE_NAME = 'KnowledgeNode' AND EXISTS (SELECT 1 FROM "KnowledgeNode" n WHERE n."id" = NEW."id" AND (
    (n."originType" = 'review-record' AND NOT EXISTS (SELECT 1 FROM "Review" r
      WHERE r."knowledgeNodeId" = n."id" AND n."stableKey" = 'review:' || r."id"))
    OR (n."originType" = 'claim-occurrence' AND NOT EXISTS (SELECT 1 FROM "Claim" c WHERE c."knowledgeNodeId" = n."id"))
    OR (n."originType" = 'canonical-work' AND NOT EXISTS (SELECT 1 FROM "Citation" i
      WHERE i."knowledgeNodeId" = n."id" AND i."workId" = n."stableKey"))))
  THEN RAISE EXCEPTION 'Canonical graph contract: orphan canonical source node'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Review_canonical_graph_contract" AFTER INSERT OR UPDATE ON "Review"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_canonical_graph_row"();
CREATE CONSTRAINT TRIGGER "ReviewVersion_canonical_graph_contract" AFTER INSERT OR UPDATE ON "ReviewVersion"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_canonical_graph_row"();
CREATE CONSTRAINT TRIGGER "Claim_canonical_graph_contract" AFTER INSERT OR UPDATE ON "Claim"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_canonical_graph_row"();
CREATE CONSTRAINT TRIGGER "Citation_canonical_graph_contract" AFTER INSERT OR UPDATE ON "Citation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_canonical_graph_row"();
CREATE CONSTRAINT TRIGGER "ClaimEvidenceRelation_canonical_graph_contract" AFTER INSERT OR UPDATE ON "ClaimEvidenceRelation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_canonical_graph_row"();
CREATE CONSTRAINT TRIGGER "KnowledgeNodeVersion_canonical_graph_contract" AFTER INSERT OR UPDATE ON "KnowledgeNodeVersion"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_canonical_graph_row"();
CREATE CONSTRAINT TRIGGER "NodeEdge_canonical_graph_contract" AFTER INSERT OR UPDATE ON "NodeEdge"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_canonical_graph_row"();
CREATE CONSTRAINT TRIGGER "KnowledgeNode_canonical_graph_contract" AFTER INSERT OR UPDATE ON "KnowledgeNode"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_canonical_graph_row"();

CREATE OR REPLACE FUNCTION "oratlas_protect_canonical_graph_contract_state"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Canonical graph contract state singleton cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."enforced" AND (NEW."enforced" = false
    OR NEW."backupId" IS DISTINCT FROM OLD."backupId"
    OR NEW."manifestDigest" IS DISTINCT FROM OLD."manifestDigest"
    OR NEW."enforcedAt" IS DISTINCT FROM OLD."enforcedAt")
  THEN RAISE EXCEPTION 'Canonical graph contract activation is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CanonicalGraphContractState_immutable_guard" BEFORE UPDATE OR DELETE ON "CanonicalGraphContractState"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_canonical_graph_contract_state"();

CREATE OR REPLACE FUNCTION "oratlas_protect_canonical_graph_objects"() RETURNS trigger AS $$
BEGIN
  IF NOT "oratlas_canonical_graph_contract_enabled"() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'KnowledgeNodeVersion'
    AND (OLD."sourceReviewVersionId" IS NOT NULL OR OLD."sourceClaimId" IS NOT NULL OR OLD."sourceCitationId" IS NOT NULL)
  THEN RAISE EXCEPTION 'Canonical graph contract: exact source versions are immutable'; END IF;
  IF TG_TABLE_NAME = 'NodeEdge' AND OLD."status" = 'source-assertion' AND OLD."provenance" = 'imported-from-review'
  THEN RAISE EXCEPTION 'Canonical graph contract: imported source assertions are immutable'; END IF;
  IF TG_TABLE_NAME = 'KnowledgeNode' AND OLD."originType" IN ('review-record', 'claim-occurrence', 'canonical-work')
  THEN RAISE EXCEPTION 'Canonical graph contract: canonical source identities are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "KnowledgeNodeVersion_canonical_graph_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeNodeVersion"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_canonical_graph_objects"();
CREATE TRIGGER "NodeEdge_canonical_graph_immutable" BEFORE UPDATE OR DELETE ON "NodeEdge"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_canonical_graph_objects"();
CREATE TRIGGER "KnowledgeNode_canonical_graph_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeNode"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_canonical_graph_objects"();

CREATE OR REPLACE FUNCTION "oratlas_finalize_canonical_graph_contract"(
  supplied_backup_id text, supplied_manifest_digest text
) RETURNS boolean AS $$
BEGIN
  IF supplied_backup_id IS NULL
    OR char_length(supplied_backup_id) NOT BETWEEN 1 AND 300
    OR supplied_backup_id !~ '^[A-Za-z0-9._/-]+$'
    OR supplied_manifest_digest IS NULL
    OR supplied_manifest_digest !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Canonical graph contract activation metadata is invalid';
  END IF;
  LOCK TABLE "Review", "ReviewVersion", "Claim", "Citation", "ClaimEvidenceRelation",
    "KnowledgeNode", "KnowledgeNodeVersion", "NodeEdge" IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM "Review" r LEFT JOIN "KnowledgeNode" n ON n."id" = r."knowledgeNodeId"
      WHERE n."id" IS NULL OR n."kind" <> 'review' OR n."originType" <> 'review-record' OR n."stableKey" <> 'review:' || r."id")
    OR EXISTS (SELECT 1 FROM "ReviewVersion" rv LEFT JOIN "Review" r ON r."id" = rv."reviewId"
      LEFT JOIN "KnowledgeNodeVersion" v ON v."sourceReviewVersionId" = rv."id" AND v."knowledgeNodeId" = r."knowledgeNodeId"
      WHERE v."id" IS NULL OR v."payloadJson"::jsonb <> jsonb_build_object(
        'recordSourceType', rv."recordSourceType",
        'reviewId', rv."reviewId",
        'reviewVersionId', rv."id"
      ))
    OR EXISTS (SELECT 1 FROM "Claim" c LEFT JOIN "KnowledgeNode" n ON n."id" = c."knowledgeNodeId"
      LEFT JOIN "KnowledgeNodeVersion" v ON v."sourceClaimId" = c."id" AND v."knowledgeNodeId" = n."id" WHERE n."id" IS NULL OR n."kind" <> 'claim' OR v."id" IS NULL)
    OR EXISTS (SELECT 1 FROM "Citation" i LEFT JOIN "KnowledgeNode" n ON n."id" = i."knowledgeNodeId"
      LEFT JOIN "KnowledgeNodeVersion" v ON v."sourceCitationId" = i."id" AND v."knowledgeNodeId" = n."id"
      WHERE i."workId" IS NULL OR n."id" IS NULL OR n."kind" <> 'work' OR n."originType" <> 'canonical-work' OR n."stableKey" <> i."workId" OR v."id" IS NULL)
    OR EXISTS (SELECT 1 FROM "ClaimEvidenceRelation" r
      LEFT JOIN "Claim" c ON c."id" = r."claimId" LEFT JOIN "KnowledgeNodeVersion" cv ON cv."sourceClaimId" = c."id"
      LEFT JOIN "Citation" i ON i."id" = r."citationId" LEFT JOIN "KnowledgeNodeVersion" iv ON iv."sourceCitationId" = i."id"
      LEFT JOIN "NodeEdge" e ON e."id" = r."nodeEdgeId" WHERE e."id" IS NULL OR e."sourceNodeVersionId" <> cv."id"
        OR e."targetNodeId" <> i."knowledgeNodeId" OR e."confirmedTargetNodeVersionId" <> iv."id"
        OR e."relationType" <> r."relationType" OR e."edgeDiscriminator" <> r."id"
        OR e."status" <> 'source-assertion' OR e."provenance" <> 'imported-from-review' OR e."confirmedById" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "Claim" c JOIN "ReviewVersion" rv ON rv."id" = c."reviewVersionId"
      LEFT JOIN "KnowledgeNodeVersion" rgv ON rgv."sourceReviewVersionId" = rv."id"
      LEFT JOIN "KnowledgeNodeVersion" cv ON cv."sourceClaimId" = c."id"
      LEFT JOIN "NodeEdge" e ON e."sourceNodeVersionId" = rgv."id" AND e."targetNodeId" = c."knowledgeNodeId"
        AND e."confirmedTargetNodeVersionId" = cv."id" AND e."relationType" = 'asserts'
        AND e."edgeDiscriminator" = c."id" AND e."status" = 'source-assertion'
        AND e."provenance" = 'imported-from-review' AND e."confirmedById" IS NULL WHERE e."id" IS NULL)
  THEN RAISE EXCEPTION 'Canonical graph contract cannot activate: backfill validation failed'; END IF;
  IF EXISTS (SELECT 1 FROM "CanonicalGraphContractState" WHERE "id" = 1 AND "enforced" = true) THEN
    RETURN false;
  END IF;
  UPDATE "CanonicalGraphContractState" SET "enforced" = true, "backupId" = supplied_backup_id,
    "manifestDigest" = supplied_manifest_digest, "enforcedAt" = CURRENT_TIMESTAMP WHERE "id" = 1 AND "enforced" = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical graph contract state singleton is missing'; END IF;
  RETURN true;
END;
$$ LANGUAGE plpgsql;
