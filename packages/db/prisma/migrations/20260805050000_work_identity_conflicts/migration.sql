CREATE TABLE "WorkIdentityConflict" (
  "id" TEXT NOT NULL,
  "citationId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "aliasEvidenceJson" TEXT NOT NULL,
  "candidateNodeIdsJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkIdentityConflict_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkIdentityConflict_citationId_key"
  ON "WorkIdentityConflict"("citationId");

ALTER TABLE "WorkIdentityConflict" ADD CONSTRAINT "WorkIdentityConflict_citationId_fkey"
  FOREIGN KEY ("citationId") REFERENCES "Citation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
