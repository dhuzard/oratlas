-- Generic publication boundary (expand only).
--
-- Adds the four federation tables an independently hosted publication is
-- observed through, plus the nullable external-publication source for the
-- canonical graph's exact-version union. No existing column is dropped, no row
-- is rewritten, and no existing constraint is relaxed: the node-version source
-- union stays exclusive and simply admits one more real source.
--
-- Nothing writes the new external-publication source yet. Registration,
-- fetching and canonical materialization are separate, later work.

-- AlterTable
ALTER TABLE "KnowledgeNodeVersion" ADD COLUMN     "sourcePublicationClaimOccurrenceId" TEXT;

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "publicationType" TEXT NOT NULL,
    "recordSource" TEXT NOT NULL,
    "identityEvidenceJson" TEXT NOT NULL,
    "sourceLocalPublicationId" TEXT,
    "reviewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationVersion" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "sourceLocalPublicationId" TEXT,
    "sourcesSha256" TEXT NOT NULL,
    "versionLabel" TEXT,
    "title" TEXT,
    "canonicalUrl" TEXT,
    "adapterType" TEXT NOT NULL,
    "adapterBindingJson" TEXT NOT NULL,
    "sourceDescriptorJson" TEXT,
    "structuralProvenance" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationCapture" (
    "id" TEXT NOT NULL,
    "publicationVersionId" TEXT NOT NULL,
    "artifactKind" TEXT NOT NULL,
    "declaredPath" TEXT,
    "observedUrl" TEXT,
    "mediaType" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "contentBytes" TEXT,
    "declaredSha256" TEXT,
    "structuralProvenance" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationClaimOccurrence" (
    "id" TEXT NOT NULL,
    "publicationVersionId" TEXT NOT NULL,
    "sourceLocalClaimId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "targetJson" TEXT NOT NULL,
    "sourceBindingJson" TEXT NOT NULL,
    "selectorJson" TEXT NOT NULL,
    "declarationSha256" TEXT NOT NULL,
    "declarationAuthority" TEXT NOT NULL,
    "text" TEXT,
    "claimType" TEXT,
    "qualification" TEXT,
    "knowledgeNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationClaimOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Publication_stableKey_key" ON "Publication"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_reviewId_key" ON "Publication"("reviewId");

-- CreateIndex
CREATE INDEX "Publication_publicationType_idx" ON "Publication"("publicationType");

-- CreateIndex
CREATE INDEX "Publication_recordSource_idx" ON "Publication"("recordSource");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationVersion_stableKey_key" ON "PublicationVersion"("stableKey");

-- CreateIndex
CREATE INDEX "PublicationVersion_publicationId_idx" ON "PublicationVersion"("publicationId");

-- CreateIndex
CREATE INDEX "PublicationVersion_structuralProvenance_idx" ON "PublicationVersion"("structuralProvenance");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationVersion_publicationId_sourcesSha256_key" ON "PublicationVersion"("publicationId", "sourcesSha256");

-- CreateIndex
CREATE INDEX "PublicationCapture_publicationVersionId_idx" ON "PublicationCapture"("publicationVersionId");

-- CreateIndex
CREATE INDEX "PublicationCapture_contentSha256_idx" ON "PublicationCapture"("contentSha256");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationCapture_publicationVersionId_artifactKind_conten_key" ON "PublicationCapture"("publicationVersionId", "artifactKind", "contentSha256");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationClaimOccurrence_stableKey_key" ON "PublicationClaimOccurrence"("stableKey");

-- CreateIndex
CREATE INDEX "PublicationClaimOccurrence_publicationVersionId_idx" ON "PublicationClaimOccurrence"("publicationVersionId");

-- CreateIndex
CREATE INDEX "PublicationClaimOccurrence_declarationSha256_idx" ON "PublicationClaimOccurrence"("declarationSha256");

-- CreateIndex
CREATE INDEX "PublicationClaimOccurrence_knowledgeNodeId_idx" ON "PublicationClaimOccurrence"("knowledgeNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationClaimOccurrence_publicationVersionId_sourceLocal_key" ON "PublicationClaimOccurrence"("publicationVersionId", "sourceLocalClaimId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeNodeVersion_sourcePublicationClaimOccurrenceId_key" ON "KnowledgeNodeVersion"("sourcePublicationClaimOccurrenceId");

-- AddForeignKey
ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_sourcePublicationClaimOccurrenceId_fkey" FOREIGN KEY ("sourcePublicationClaimOccurrenceId") REFERENCES "PublicationClaimOccurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationVersion" ADD CONSTRAINT "PublicationVersion_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationCapture" ADD CONSTRAINT "PublicationCapture_publicationVersionId_fkey" FOREIGN KEY ("publicationVersionId") REFERENCES "PublicationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationClaimOccurrence" ADD CONSTRAINT "PublicationClaimOccurrence_publicationVersionId_fkey" FOREIGN KEY ("publicationVersionId") REFERENCES "PublicationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationClaimOccurrence" ADD CONSTRAINT "PublicationClaimOccurrence_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The exact-version source union stays exclusive: exactly one real source per
-- node version, now including an external publication claim occurrence.
ALTER TABLE "KnowledgeNodeVersion" DROP CONSTRAINT IF EXISTS "KnowledgeNodeVersion_source_union_check";
ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_source_union_check" CHECK (
  (("snapshotId" IS NOT NULL)::int + ("sourceReviewVersionId" IS NOT NULL)::int + ("sourceClaimId" IS NOT NULL)::int + ("sourceCitationId" IS NOT NULL)::int + ("sourcePublicationClaimOccurrenceId" IS NOT NULL)::int) = 1
);

-- The dormant canonical-graph contract also protects the new exact source.
CREATE OR REPLACE FUNCTION "oratlas_protect_canonical_graph_objects"() RETURNS trigger AS $$
BEGIN
  IF NOT "oratlas_canonical_graph_contract_enabled"() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'KnowledgeNodeVersion' THEN
    IF OLD."sourceReviewVersionId" IS NOT NULL OR OLD."sourceClaimId" IS NOT NULL
      OR OLD."sourceCitationId" IS NOT NULL OR OLD."sourcePublicationClaimOccurrenceId" IS NOT NULL
    THEN RAISE EXCEPTION 'Canonical graph contract: exact source versions are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'NodeEdge' THEN
    IF OLD."status" = 'source-assertion' AND OLD."provenance" = 'imported-from-review'
    THEN RAISE EXCEPTION 'Canonical graph contract: imported source assertions are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'KnowledgeNode' THEN
    IF OLD."originType" IN ('review-record', 'claim-occurrence', 'canonical-work')
    THEN RAISE EXCEPTION 'Canonical graph contract: canonical source identities are immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A review projection owns exactly one review; a natively registered external
-- publication owns none.
ALTER TABLE "Publication" DROP CONSTRAINT IF EXISTS "Publication_record_source_check";
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_record_source_check" CHECK (
  ("recordSource" = 'external-publication' AND "reviewId" IS NULL)
  OR ("recordSource" = 'atlas-review-projection' AND "reviewId" IS NOT NULL)
);

-- Structural provenance is never a scientific validation state, and source-byte
-- provenance is unreachable without an obtainable source.
ALTER TABLE "PublicationVersion" DROP CONSTRAINT IF EXISTS "PublicationVersion_provenance_check";
ALTER TABLE "PublicationVersion" ADD CONSTRAINT "PublicationVersion_provenance_check" CHECK (
  "structuralProvenance" IN ('published-structure', 'source-byte')
  AND ("structuralProvenance" = 'published-structure' OR "sourceDescriptorJson" IS NOT NULL)
  AND "sourcesSha256" ~ '^[a-f0-9]{64}$'
  AND "adapterType" IN ('myst')
);

ALTER TABLE "PublicationCapture" DROP CONSTRAINT IF EXISTS "PublicationCapture_shape_check";
ALTER TABLE "PublicationCapture" ADD CONSTRAINT "PublicationCapture_shape_check" CHECK (
  "structuralProvenance" IN ('published-structure', 'source-byte')
  AND "artifactKind" IN ('publication-manifest', 'cross-reference-inventory', 'claim-stream', 'review-manifest')
  AND "contentSha256" ~ '^[a-f0-9]{64}$'
  AND ("declaredSha256" IS NULL OR "declaredSha256" ~ '^[a-f0-9]{64}$')
  AND "byteLength" >= 0
);

-- Exactly one artifact owns a claim declaration: the publication source, or the
-- review manifest the publication ships.
ALTER TABLE "PublicationClaimOccurrence" DROP CONSTRAINT IF EXISTS "PublicationClaimOccurrence_declaration_check";
ALTER TABLE "PublicationClaimOccurrence" ADD CONSTRAINT "PublicationClaimOccurrence_declaration_check" CHECK (
  ("declarationAuthority" = 'publication-source' AND "text" IS NOT NULL)
  OR ("declarationAuthority" = 'review-manifest' AND "text" IS NULL AND "claimType" IS NULL AND "qualification" IS NULL)
);

-- A publication's identity key and the evidence it was keyed from are fixed.
-- Presentation fields may still be corrected editorially.
CREATE OR REPLACE FUNCTION "oratlas_protect_publication_identity"() RETURNS trigger AS $$
BEGIN
  IF NEW."stableKey" IS DISTINCT FROM OLD."stableKey"
    OR NEW."recordSource" IS DISTINCT FROM OLD."recordSource"
    OR NEW."identityEvidenceJson" IS DISTINCT FROM OLD."identityEvidenceJson"
    OR NEW."reviewId" IS DISTINCT FROM OLD."reviewId"
  THEN
    RAISE EXCEPTION 'Publication identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "Publication_identity_immutable_guard" ON "Publication";
CREATE TRIGGER "Publication_identity_immutable_guard" BEFORE UPDATE ON "Publication"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_publication_identity"();

-- An observed version and its captures are exactly what ORAtlas saw: no update,
-- no delete, so captured bytes can never silently mutate.
CREATE OR REPLACE FUNCTION "oratlas_protect_publication_version"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'An observed publication version is immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "PublicationVersion_immutable_guard" ON "PublicationVersion";
CREATE TRIGGER "PublicationVersion_immutable_guard" BEFORE UPDATE OR DELETE ON "PublicationVersion"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_publication_version"();

CREATE OR REPLACE FUNCTION "oratlas_protect_publication_capture"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Publication capture bytes are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "PublicationCapture_immutable_guard" ON "PublicationCapture";
CREATE TRIGGER "PublicationCapture_immutable_guard" BEFORE UPDATE OR DELETE ON "PublicationCapture"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_publication_capture"();

-- A source occurrence is immutable. Its canonical binding is write-once and set
-- only by an explicit reviewed decision; it is never rewritten.
CREATE OR REPLACE FUNCTION "oratlas_protect_publication_claim_occurrence"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A publication claim occurrence is immutable';
  END IF;
  IF NEW."publicationVersionId" IS DISTINCT FROM OLD."publicationVersionId"
    OR NEW."sourceLocalClaimId" IS DISTINCT FROM OLD."sourceLocalClaimId"
    OR NEW."stableKey" IS DISTINCT FROM OLD."stableKey"
    OR NEW."targetJson" IS DISTINCT FROM OLD."targetJson"
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
DROP TRIGGER IF EXISTS "PublicationClaimOccurrence_immutable_guard" ON "PublicationClaimOccurrence";
CREATE TRIGGER "PublicationClaimOccurrence_immutable_guard" BEFORE UPDATE OR DELETE ON "PublicationClaimOccurrence"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_protect_publication_claim_occurrence"();
