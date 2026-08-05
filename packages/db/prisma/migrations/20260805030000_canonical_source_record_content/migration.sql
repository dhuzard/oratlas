-- Canonical source records need no invented display title or license. Existing
-- repository-backed versions keep their values; only column optionality changes.

ALTER TABLE "KnowledgeNodeVersion" ALTER COLUMN "title" DROP NOT NULL;
ALTER TABLE "KnowledgeNodeVersion" ALTER COLUMN "license" DROP NOT NULL;
