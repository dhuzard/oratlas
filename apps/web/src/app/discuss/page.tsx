import { type Metadata } from "next";
import { getServerEnv } from "@oratlas/config";
import { DiscussClient } from "./DiscussClient";
import { SpecialistToolBreadcrumb } from "@/components/SpecialistTools";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Grounded Q&A" };

export default async function DiscussPage({
  searchParams,
}: {
  searchParams: Promise<{ review?: string }>;
}) {
  const { review } = await searchParams;
  const env = getServerEnv();
  return (
    <div>
      <SpecialistToolBreadcrumb current="Grounded Q&A" />
      <h1>Grounded Q&amp;A</h1>
      <p className="prose muted">
        A grounded assistant that answers questions using only accepted review versions — their
        claims, citations, evidence relations, and TRUST assessments. It cites the reviews and
        claims it uses, distinguishes agreement from disagreement from missing evidence, and never
        implies scientific consensus from the number of reviews alone. Structural grounding
        preserves provenance; it does not establish scientific correctness.
        {env.llmEnabled
          ? " An LLM provider is configured; answers are generated and then validated so every referenced identifier exists in the evidence."
          : " No LLM provider is configured, so responses are deterministic structured evidence summaries rather than generated prose."}
      </p>
      <p className="notice notice-info" data-register="open-discussion">
        Grounded Q&amp;A output is open discussion, not a formal challenge. It neither creates nor
        changes a TRUST assessment, formal review report, challenge record, editorial decision, or
        immutable archive.
      </p>
      <DiscussClient initialReview={review} />
    </div>
  );
}
