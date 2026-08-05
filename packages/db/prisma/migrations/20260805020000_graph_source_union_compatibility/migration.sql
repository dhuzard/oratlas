-- Allow canonical review, claim-occurrence, and work nodes to carry their real
-- source identity without invented repositories or snapshots. Existing rows
-- remain repository-backed and satisfy both source-union checks.

ALTER TABLE "KnowledgeNode" ALTER COLUMN "repositoryId" DROP NOT NULL;
ALTER TABLE "KnowledgeNodeVersion" ALTER COLUMN "snapshotId" DROP NOT NULL;

ALTER TABLE "KnowledgeNode" DROP CONSTRAINT IF EXISTS "KnowledgeNode_source_union_check";
ALTER TABLE "KnowledgeNode" ADD CONSTRAINT "KnowledgeNode_source_union_check" CHECK (
  ("originType" = 'repository-object' AND "repositoryId" IS NOT NULL AND "kind" IN ('claim', 'figure', 'dataset', 'code'))
  OR ("originType" = 'review-record' AND "repositoryId" IS NULL AND "stableKey" IS NOT NULL AND "kind" = 'review')
  OR ("originType" = 'claim-occurrence' AND "repositoryId" IS NULL AND "stableKey" IS NOT NULL AND "kind" = 'claim')
  OR ("originType" = 'canonical-work' AND "repositoryId" IS NULL AND "stableKey" IS NOT NULL AND "kind" = 'work')
);

ALTER TABLE "KnowledgeNodeVersion" DROP CONSTRAINT IF EXISTS "KnowledgeNodeVersion_source_union_check";
ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_source_union_check" CHECK (
  (("snapshotId" IS NOT NULL)::int + ("sourceReviewVersionId" IS NOT NULL)::int + ("sourceClaimId" IS NOT NULL)::int + ("sourceCitationId" IS NOT NULL)::int) = 1
);
