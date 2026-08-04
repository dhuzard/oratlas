import { type Metadata } from "next";
import { DiscussClient } from "./DiscussClient";
import { SpecialistToolBreadcrumb } from "@/components/SpecialistTools";
import { LlmCredentialPanel } from "@/components/LlmCredentialPanel";
import { getLlmCredentialStatus } from "@/lib/llm-credentials";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Grounded Q&A" };

export default async function DiscussPage({
  searchParams,
}: {
  searchParams: Promise<{ review?: string }>;
}) {
  const { review } = await searchParams;
  const status = await getLlmCredentialStatus();
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
        {status.available
          ? ` ${status.provider === "openai" ? "OpenAI" : "Anthropic"} ${status.model ?? ""} is available through a ${status.source === "byok" ? "browser" : "platform"} credential.`
          : " No provider is connected, so responses are deterministic structured evidence summaries rather than generated prose."}
      </p>
      <LlmCredentialPanel />
      <p className="notice notice-info" data-register="open-discussion">
        Grounded Q&amp;A output is open discussion, not a formal challenge. It neither creates nor
        changes a TRUST assessment, formal review report, challenge record, editorial decision, or
        immutable archive.
      </p>
      <DiscussClient initialReview={review} />
    </div>
  );
}
