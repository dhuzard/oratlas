import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, Card, DefinitionList, StatusPill } from "@oratlas/ui";
import { CertificationError, getPublicCertificationResult } from "@/lib/certification";
import { oraPilotPresentation } from "@/lib/ora-certification-presentation";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const result = await load((await params).id);
  return { title: result ? `${result.certifier.name} certification` : "Certification not found" };
}

export default async function CertificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const result = await load((await params).id);
  if (!result) notFound();
  const lifecycleState = result.lifecycle.at(-1)?.kind ?? "issued";
  const presentation = oraPilotPresentation({ ...result, lifecycleState });
  const active = lifecycleState === "issued";
  const criteria = result.criteria as Array<{
    criterionId: string;
    status: "pass" | "concern" | "fail" | "not-applicable" | "insufficient-evidence";
    rationale: string;
    evidenceRefs: Array<{ type: string; id?: string; url?: string; sha256?: string }>;
  }>;
  const definitions = new Map<string, string>(
    result.protocol.definition.criteria.map((criterion: { id: string; title: string }) => [
      criterion.id,
      criterion.title,
    ]),
  );

  return (
    <article>
      <div className="btn-row">
        <Badge tone={active && result.outcome === "certified" ? "success" : "neutral"}>
          {presentation?.label ??
            `${result.certifier.name}: ${result.outcome.replaceAll("-", " ")}`}
        </Badge>
        <Badge>{active ? "active assertion" : `inactive · ${lifecycleState}`}</Badge>
      </div>
      <h1>{result.protocol.title}</h1>
      <p className="lead">
        Attributed assessment of one exact publication version. This is not a universal truth badge
        or a replacement for peer review.
      </p>

      <div className="grid layout-2">
        <div>
          <Card title="Criterion assessment">
            {criteria.map((criterion) => (
              <section key={criterion.criterionId}>
                <h2>
                  {criterion.criterionId.toUpperCase()} —{" "}
                  {definitions.get(criterion.criterionId) ?? "Unknown protocol criterion"}
                </h2>
                <StatusPill status={criterion.status} />
                <p>{criterion.rationale}</p>
                {criterion.evidenceRefs.length ? (
                  <ul>
                    {criterion.evidenceRefs.map((reference, index) => (
                      <li key={`${reference.type}:${reference.id ?? reference.url}:${index}`}>
                        <a href={evidenceHref(result.publicationVersionId, reference)}>
                          {reference.type}: {reference.id ?? reference.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No packet evidence reference supplied.</p>
                )}
              </section>
            ))}
          </Card>
          <Card title="Limitations">
            {result.limitations.length ? (
              <ul>
                {result.limitations.map((item: string) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>None recorded.</p>
            )}
          </Card>
        </div>
        <aside>
          <Card title="Exact assessment identity">
            <DefinitionList
              items={[
                { term: "Certifier", value: result.certifier.name },
                {
                  term: "Protocol",
                  value: `${result.protocol.title} · ${result.protocol.seriesKey} v${result.protocol.version}`,
                },
                {
                  term: "PublicationVersion",
                  value: <span className="mono">{result.publicationVersionId}</span>,
                },
                { term: "Outcome", value: result.outcome.replaceAll("-", " ") },
                { term: "Mode", value: `${result.assessmentMode} assessment` },
                { term: "Issued", value: result.issuedAt },
                { term: "Packet schema", value: result.input.packetSchemaVersion },
                {
                  term: "Packet SHA-256",
                  value: <span className="mono">{result.input.packetSha256}</span>,
                },
                { term: "Content coverage", value: result.input.completeness.content.coverage },
                {
                  term: "Returned content",
                  value: String(result.input.completeness.content.returnedDocuments),
                },
              ]}
            />
          </Card>
          <Card title="Accountability and provenance">
            <DefinitionList
              items={[
                { term: "Conflict of interest", value: result.conflictOfInterest.status },
                { term: "Independence", value: result.independence.statement },
                { term: "AgentRun", value: result.execution?.agentRunId ?? "not recorded" },
                {
                  term: "Provider / model",
                  value: result.execution
                    ? `${result.execution.provider} / ${result.execution.model}`
                    : "not recorded",
                },
                { term: "Prompt", value: result.execution?.promptVersion ?? "not recorded" },
                {
                  term: "Execution packet hash",
                  value: result.execution?.packetHash ?? "not recorded",
                },
              ]}
            />
          </Card>
          <Card title="Lifecycle">
            <ol>
              {result.lifecycle.map(
                (event: { kind: string; createdAt: string; reason: string | null }) => (
                  <li key={`${event.kind}:${event.createdAt}`}>
                    <strong>{event.kind}</strong> · {event.createdAt}
                    {event.reason ? ` — ${event.reason}` : ""}
                  </li>
                ),
              )}
            </ol>
          </Card>
          <Card title="Machine-readable API">
            <a href={`/api/certification-results/${result.id}`}>JSON for this exact result</a>
          </Card>
        </aside>
      </div>
    </article>
  );
}

async function load(id: string) {
  try {
    return await getPublicCertificationResult(id);
  } catch (error) {
    if (error instanceof CertificationError && error.code === "not-found") return null;
    throw error;
  }
}

function evidenceHref(
  publicationVersionId: string,
  reference: { type: string; id?: string; url?: string },
) {
  if (reference.type === "external-immutable-resource") return reference.url!;
  if (reference.type === "publication-content-document")
    return `/api/publication-versions/${encodeURIComponent(publicationVersionId)}/content#${encodeURIComponent(reference.id!)}`;
  if (reference.type === "publication-occurrence")
    return `/api/publication-claim-occurrences/${encodeURIComponent(reference.id!)}`;
  return `/api/publication-versions/${encodeURIComponent(publicationVersionId)}/packet#${encodeURIComponent(reference.id!)}`;
}
