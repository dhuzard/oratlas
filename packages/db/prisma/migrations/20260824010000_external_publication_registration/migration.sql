-- Phase 2: immutable external-publication registration audit details.
ALTER TABLE "PublicationVersion"
  ADD COLUMN "verificationWarningsJson" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "PublicationCapture"
  ADD COLUMN "requestedUrl" TEXT,
  ADD COLUMN "httpProvenanceJson" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "PublicationCapture" DROP CONSTRAINT IF EXISTS "PublicationCapture_shape_check";
ALTER TABLE "PublicationCapture" ADD CONSTRAINT "PublicationCapture_shape_check" CHECK (
  "structuralProvenance" IN ('published-structure', 'source-byte')
  AND "artifactKind" IN ('publication-manifest', 'cross-reference-inventory', 'claim-stream', 'review-manifest', 'review-claim-stream', 'published-page-data', 'source-document')
  AND "contentSha256" ~ '^[a-f0-9]{64}$'
  AND ("declaredSha256" IS NULL OR "declaredSha256" ~ '^[a-f0-9]{64}$')
  AND "byteLength" >= 0
);

ALTER TABLE "PublicationClaimOccurrence"
  DROP CONSTRAINT IF EXISTS "PublicationClaimOccurrence_declaration_check";
ALTER TABLE "PublicationClaimOccurrence" ADD CONSTRAINT "PublicationClaimOccurrence_declaration_check" CHECK (
  ("declarationAuthority" = 'publication-source' AND "text" IS NOT NULL)
  OR ("declarationAuthority" = 'review-manifest' AND "text" IS NOT NULL)
);
