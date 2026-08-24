-- Preserve the exact verified public target resolved by the format adapter.
-- Nullable supports existing Phase-2 rows; the Phase-3 materializer fails
-- closed when an older occurrence lacks this provenance.
ALTER TABLE "PublicationClaimOccurrence" ADD COLUMN "publishedUrl" TEXT;

CREATE OR REPLACE FUNCTION "oratlas_protect_publication_claim_occurrence"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A publication claim occurrence is immutable';
  END IF;
  IF NEW."publicationVersionId" IS DISTINCT FROM OLD."publicationVersionId"
    OR NEW."sourceLocalClaimId" IS DISTINCT FROM OLD."sourceLocalClaimId"
    OR NEW."stableKey" IS DISTINCT FROM OLD."stableKey"
    OR NEW."targetJson" IS DISTINCT FROM OLD."targetJson"
    OR NEW."publishedUrl" IS DISTINCT FROM OLD."publishedUrl"
    OR NEW."sourceBindingJson" IS DISTINCT FROM OLD."sourceBindingJson"
    OR NEW."selectorJson" IS DISTINCT FROM OLD."selectorJson"
    OR NEW."declarationSha256" IS DISTINCT FROM OLD."declarationSha256"
    OR NEW."declarationAuthority" IS DISTINCT FROM OLD."declarationAuthority"
    OR NEW."text" IS DISTINCT FROM OLD."text"
    OR NEW."claimType" IS DISTINCT FROM OLD."claimType"
    OR NEW."qualification" IS DISTINCT FROM OLD."qualification"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'A publication claim occurrence is immutable';
  END IF;
  IF OLD."knowledgeNodeId" IS NOT NULL
    AND NEW."knowledgeNodeId" IS DISTINCT FROM OLD."knowledgeNodeId"
  THEN
    RAISE EXCEPTION 'A canonical claim binding cannot be rewritten';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
