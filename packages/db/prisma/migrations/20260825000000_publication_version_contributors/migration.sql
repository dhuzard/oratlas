-- Generic, immutable exact-version scholarly contributor snapshots.
-- Existing versions remain valid with an explicitly undeclared snapshot.

ALTER TABLE "PublicationVersion"
  ADD COLUMN "contributorsDeclared" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PublicationVersionContributor" (
  "id" TEXT NOT NULL,
  "publicationVersionId" TEXT NOT NULL,
  "sourceContributorKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "givenName" TEXT,
  "familyName" TEXT,
  "identifiersJson" TEXT NOT NULL DEFAULT '[]',
  "affiliationsJson" TEXT NOT NULL DEFAULT '[]',
  "rolesJson" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "publicUrl" TEXT,
  "sourceDeclarationProvenanceJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationVersionContributor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicationVersionContributor_version_fkey" FOREIGN KEY ("publicationVersionId") REFERENCES "PublicationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PublicationVersionContributor_shape_check" CHECK (
    "kind" IN ('person', 'organization')
    AND length("sourceContributorKey") BETWEEN 1 AND 200
    AND "sourceContributorKey" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    AND length("displayName") BETWEEN 1 AND 300
    AND "position" BETWEEN 1 AND 500
    AND ("kind" = 'person' OR ("givenName" IS NULL AND "familyName" IS NULL))
  )
);

CREATE UNIQUE INDEX "PublicationVersionContributor_source_key" ON "PublicationVersionContributor"("publicationVersionId", "sourceContributorKey");
CREATE UNIQUE INDEX "PublicationVersionContributor_position_key" ON "PublicationVersionContributor"("publicationVersionId", "position");
CREATE INDEX "PublicationVersionContributor_version_position_idx" ON "PublicationVersionContributor"("publicationVersionId", "position");

CREATE OR REPLACE FUNCTION "oratlas_validate_publication_contributor_binding"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "PublicationVersion" v
    WHERE v."id" = NEW."publicationVersionId" AND v."contributorsDeclared" = true
  ) THEN
    RAISE EXCEPTION 'Publication contributor requires an exact declared version snapshot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PublicationVersionContributor_binding_guard"
  BEFORE INSERT ON "PublicationVersionContributor"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_publication_contributor_binding"();

CREATE OR REPLACE FUNCTION "oratlas_reject_publication_contributor_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Publication contributor snapshots are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PublicationVersionContributor_immutable_guard"
  BEFORE UPDATE OR DELETE ON "PublicationVersionContributor"
  FOR EACH ROW EXECUTE FUNCTION "oratlas_reject_publication_contributor_mutation"();
