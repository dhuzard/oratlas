import { notFound } from "next/navigation";
import { Badge, Card, DefinitionList } from "@oratlas/ui";
import { getVerificationRun, VerificationError } from "@/lib/scientific-verification";
export const dynamic = "force-dynamic";

export default async function VerificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let run: Awaited<ReturnType<typeof getVerificationRun>>;
  try {
    run = await getVerificationRun((await params).id);
  } catch (error) {
    if (error instanceof VerificationError && error.code === "not-found") notFound();
    throw error;
  }
  return (
    <article>
      <div className="btn-row">
        <Badge>{run.status}</Badge>
        <Badge>{run.input.profile}</Badge>
      </div>
      <h1>Scientific verification evidence</h1>
      <p className="lead">Attributed, protocol-scoped evidence for one exact immutable subject.</p>
      <Card title="Run identity">
        <DefinitionList
          items={[
            { term: "Subject", value: <span className="mono">{JSON.stringify(run.subject)}</span> },
            {
              term: "Verifier",
              value: run.verifier
                ? `${run.verifier.name} (${run.verifier.slug})`
                : "Not yet claimed",
            },
            {
              term: "Protocol",
              value: `${run.protocol.seriesKey} · ${run.protocol.protocolVersion}`,
            },
            { term: "Input SHA-256", value: <span className="mono">{run.input.sha256}</span> },
            {
              term: "Schema / profile",
              value: `${run.input.schemaVersion} · ${run.input.profile} ${run.input.profileVersion}`,
            },
            { term: "Requested", value: run.requestedAt },
            { term: "Completed", value: run.completedAt },
          ]}
        />
      </Card>
      <Card title="Findings">
        {run.findings.length ? (
          <ul>
            {run.findings.map((finding) => (
              <li key={finding.id}>
                <strong>
                  {finding.status.replaceAll("-", " ")} · {finding.findingType}
                </strong>{" "}
                <Badge>{finding.impact}</Badge>
                <p>{finding.statement}</p>
                <p className="muted">{finding.rationale}</p>
                {finding.reported !== null ? (
                  <pre>
                    {JSON.stringify(
                      {
                        reported: finding.reported,
                        observed: finding.observed,
                        tolerance: finding.tolerance,
                      },
                      null,
                      2,
                    )}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No findings submitted.</p>
        )}
        <p className="muted">
          <strong>Unverifiable</strong> means required evidence was unavailable or insufficient.{" "}
          <strong>Failed</strong> means the procedure itself failed or its protocol defines a failed
          state. A discrepancy is distinct from both.
        </p>
      </Card>
      <Card title="Artifacts and provenance">
        <ul>
          {run.artifacts.map((artifact) => (
            <li key={artifact.id}>
              <a href={artifact.contentHref ?? undefined}>{artifact.kind}</a> · {artifact.mediaType}{" "}
              · <span className="mono">{artifact.sha256}</span>
            </li>
          ))}
        </ul>
        <p>
          AgentRun: <span className="mono">{run.provenance.agentRunId ?? "none"}</span>
          <br />
          ExecutionPassport:{" "}
          <span className="mono">{run.provenance.executionPassportId ?? "none"}</span>
          <br />
          ReplicationBrief:{" "}
          <span className="mono">{run.provenance.replicationBriefId ?? "none"}</span>
        </p>
      </Card>
      <Card title="Lifecycle and limitations">
        <ul>
          {run.lifecycle.map((event, index) => (
            <li key={`${event.kind}-${index}`}>
              {event.createdAt} · {event.kind}
            </li>
          ))}
        </ul>
        <ul>
          {run.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </Card>
    </article>
  );
}
