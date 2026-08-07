-- Add immutable, version-scoped W3C-style passage selectors to review comments.
ALTER TABLE "ReviewComment" ADD COLUMN "targetDocumentPath" TEXT;
ALTER TABLE "ReviewComment" ADD COLUMN "targetSelectorJson" TEXT;
ALTER TABLE "ReviewComment" ADD COLUMN "targetSelectorHash" TEXT;

CREATE INDEX "ReviewComment_reviewVersionId_targetDocumentPath_createdAt_idx"
ON "ReviewComment"("reviewVersionId", "targetDocumentPath", "createdAt");
