-- Expand only: every new field remains nullable until dual-write and backfill
-- have been deployed and validated. This migration never invents provenance.

ALTER TABLE "Review" ADD COLUMN "knowledgeNodeId" TEXT;

ALTER TABLE "KnowledgeNode"
  ADD COLUMN "stableKey" TEXT,
  ADD COLUMN "originType" TEXT NOT NULL DEFAULT 'repository-object';

ALTER TABLE "KnowledgeNodeVersion"
  ADD COLUMN "sourceReviewVersionId" TEXT,
  ADD COLUMN "sourceClaimId" TEXT,
  ADD COLUMN "sourceCitationId" TEXT;

ALTER TABLE "Citation"
  ADD COLUMN "workId" TEXT,
  ADD COLUMN "knowledgeNodeId" TEXT;

ALTER TABLE "ClaimEvidenceRelation" ADD COLUMN "nodeEdgeId" TEXT;

CREATE UNIQUE INDEX "Review_knowledgeNodeId_key" ON "Review"("knowledgeNodeId");
CREATE UNIQUE INDEX "KnowledgeNode_stableKey_key" ON "KnowledgeNode"("stableKey");
CREATE INDEX "KnowledgeNode_originType_idx" ON "KnowledgeNode"("originType");
CREATE UNIQUE INDEX "KnowledgeNodeVersion_sourceReviewVersionId_key" ON "KnowledgeNodeVersion"("sourceReviewVersionId");
CREATE UNIQUE INDEX "KnowledgeNodeVersion_sourceClaimId_key" ON "KnowledgeNodeVersion"("sourceClaimId");
CREATE UNIQUE INDEX "KnowledgeNodeVersion_sourceCitationId_key" ON "KnowledgeNodeVersion"("sourceCitationId");
CREATE INDEX "Citation_workId_idx" ON "Citation"("workId");
CREATE INDEX "Citation_knowledgeNodeId_idx" ON "Citation"("knowledgeNodeId");
CREATE UNIQUE INDEX "ClaimEvidenceRelation_nodeEdgeId_key" ON "ClaimEvidenceRelation"("nodeEdgeId");

ALTER TABLE "Review" ADD CONSTRAINT "Review_knowledgeNodeId_fkey"
  FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_sourceReviewVersionId_fkey"
  FOREIGN KEY ("sourceReviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_sourceClaimId_fkey"
  FOREIGN KEY ("sourceClaimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_sourceCitationId_fkey"
  FOREIGN KEY ("sourceCitationId") REFERENCES "Citation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_knowledgeNodeId_fkey"
  FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClaimEvidenceRelation" ADD CONSTRAINT "ClaimEvidenceRelation_nodeEdgeId_fkey"
  FOREIGN KEY ("nodeEdgeId") REFERENCES "NodeEdge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
