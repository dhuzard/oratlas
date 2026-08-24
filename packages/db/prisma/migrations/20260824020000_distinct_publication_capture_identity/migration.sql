-- Preserve distinct declared artifacts even when their observed bytes match.
ALTER TABLE "PublicationCapture"
  ADD COLUMN "artifactIdentitySha256" TEXT;

UPDATE "PublicationCapture"
SET "artifactIdentitySha256" = encode(
  sha256(
    convert_to(
      "artifactKind" || E'\n' ||
      CASE
        WHEN "declaredPath" IS NOT NULL THEN 'path' || E'\n' || "declaredPath"
        ELSE 'url' || E'\n' || COALESCE("requestedUrl", "observedUrl", '')
      END,
      'UTF8'
    )
  ),
  'hex'
);

ALTER TABLE "PublicationCapture"
  ALTER COLUMN "artifactIdentitySha256" SET NOT NULL;

DROP INDEX "PublicationCapture_publicationVersionId_artifactKind_conten_key";
CREATE UNIQUE INDEX "PublicationCapture_publicationVersionId_artifactIdentitySha_key"
  ON "PublicationCapture"("publicationVersionId", "artifactIdentitySha256");

ALTER TABLE "PublicationCapture" DROP CONSTRAINT IF EXISTS "PublicationCapture_shape_check";
ALTER TABLE "PublicationCapture" ADD CONSTRAINT "PublicationCapture_shape_check" CHECK (
  "structuralProvenance" IN ('published-structure', 'source-byte')
  AND "artifactKind" IN ('publication-manifest', 'cross-reference-inventory', 'claim-stream', 'review-manifest', 'review-claim-stream', 'published-page-data', 'source-document')
  AND "artifactIdentitySha256" ~ '^[a-f0-9]{64}$'
  AND "contentSha256" ~ '^[a-f0-9]{64}$'
  AND ("declaredSha256" IS NULL OR "declaredSha256" ~ '^[a-f0-9]{64}$')
  AND "byteLength" >= 0
);
