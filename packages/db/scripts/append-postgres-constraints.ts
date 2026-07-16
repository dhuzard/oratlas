import { appendFileSync } from "node:fs";
import { join } from "node:path";

const target = join(import.meta.dirname, "..", "prisma", "schema.postgres.sql");

appendFileSync(
  target,
  `

-- Application source unions also have database-level fail-closed guards in production.
ALTER TABLE "Review" ADD CONSTRAINT "Review_source_union_check" CHECK (
  (
    "reviewType" = 'ai-synthesis' AND "repositoryId" IS NULL AND "currentSnapshotId" IS NULL
    AND "synthesisSeriesKey" IS NOT NULL
  ) OR (
    ("reviewType" IS NULL OR "reviewType" <> 'ai-synthesis') AND "synthesisSeriesKey" IS NULL
    AND "currentSynthesisVersionId" IS NULL
  )
);

ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_source_union_check" CHECK (
  (
    "recordSourceType" = 'repository' AND "snapshotId" IS NOT NULL AND "synthesisDraftId" IS NULL
    AND "synthesisDocumentJson" IS NULL AND "synthesisOrdinal" IS NULL
  ) OR (
    "recordSourceType" = 'synthesis' AND "snapshotId" IS NULL AND "synthesisDraftId" IS NOT NULL
    AND "synthesisDocumentJson" IS NOT NULL AND "synthesisOrdinal" IS NOT NULL
  )
);

ALTER TABLE "SynthesisDraft" ADD CONSTRAINT "SynthesisDraft_status_check" CHECK (
  "status" IN ('pending', 'accepted', 'rejected', 'regeneration-requested')
);

ALTER TABLE "SynthesisGenerationRequestClaim" ADD CONSTRAINT "SynthesisGenerationRequestClaim_status_check" CHECK (
  "status" IN ('running', 'completed', 'failed')
  AND ("status" <> 'completed' OR ("draftId" IS NOT NULL AND "agentRunId" IS NOT NULL))
);
`,
  "utf8",
);
