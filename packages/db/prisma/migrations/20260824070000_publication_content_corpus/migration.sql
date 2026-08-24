-- Persist the generic normalized publication-content corpus on the exact
-- immutable PublicationVersion. Existing versions explicitly record that
-- content normalization was unsupported; they are never backfilled from a
-- mutable external website.

ALTER TABLE "PublicationVersion"
  ADD COLUMN "contentCorpusJson" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "contentCorpusSha256" TEXT NOT NULL DEFAULT '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  ADD COLUMN "contentCompletenessJson" TEXT NOT NULL DEFAULT '{"coverage":"unsupported","returnedDocuments":0,"totalDocumentsKnown":null,"truncated":false}';

ALTER TABLE "PublicationVersion" DROP CONSTRAINT IF EXISTS "PublicationVersion_provenance_check";
ALTER TABLE "PublicationVersion" ADD CONSTRAINT "PublicationVersion_provenance_check" CHECK (
  "structuralProvenance" IN ('published-structure', 'source-byte')
  AND ("structuralProvenance" = 'published-structure' OR "sourceDescriptorJson" IS NOT NULL)
  AND "sourcesSha256" ~ '^[a-f0-9]{64}$'
  AND "contentCorpusSha256" ~ '^[a-f0-9]{64}$'
  AND "adapterType" IN ('myst')
);
