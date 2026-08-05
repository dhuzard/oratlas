-- Preserve editorial edge idempotency while allowing distinct source
-- occurrences to project 1:1 onto canonical graph edges.

ALTER TABLE "NodeEdge" ADD COLUMN "edgeDiscriminator" TEXT NOT NULL DEFAULT 'canonical';

DROP INDEX "NodeEdge_sourceNodeVersionId_targetNodeId_relationType_key";
CREATE UNIQUE INDEX "NodeEdge_sourceNodeVersionId_targetNodeId_relationType_edgeDiscriminator_key"
  ON "NodeEdge"("sourceNodeVersionId", "targetNodeId", "relationType", "edgeDiscriminator");
