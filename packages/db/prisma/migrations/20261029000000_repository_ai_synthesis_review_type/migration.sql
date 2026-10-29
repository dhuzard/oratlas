-- reviewType describes source content; repository imports may declare ai-synthesis.
-- Internal synthesis series retain their exclusive source identity and provenance.
BEGIN;
ALTER TABLE "Review" DROP CONSTRAINT "Review_source_union_check";
ALTER TABLE "Review" ADD CONSTRAINT "Review_source_union_check" CHECK (
  (COALESCE("reviewType" = 'ai-synthesis', FALSE) AND "repositoryId" IS NULL AND "currentSnapshotId" IS NULL AND "synthesisSeriesKey" IS NOT NULL)
  OR (("reviewType" IS NULL OR "reviewType" <> 'ai-synthesis' OR ("repositoryId" IS NOT NULL AND "currentSnapshotId" IS NOT NULL)) AND "synthesisSeriesKey" IS NULL AND "currentSynthesisVersionId" IS NULL)
);
COMMIT;
