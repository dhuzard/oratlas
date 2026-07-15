import Link from "next/link";
import { type Metadata } from "next";
import { Badge, Card, Notice, StatusPill } from "@oratlas/ui";
import { loadPublicReplicationMarketplace } from "@/lib/replication-marketplace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Replication marketplace" };

export default async function ReplicationMarketplacePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const requestedStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = ["open", "claimed", "completed", "withdrawn"].includes(requestedStatus ?? "")
    ? (requestedStatus as "open" | "claimed" | "completed" | "withdrawn")
    : undefined;
  const { marketplace, triage } = await loadPublicReplicationMarketplace(status);

  return (
    <article>
      <h1>Replication marketplace</h1>
      <p className="prose">
        Human editors publish bounded replication briefs tied to archived claims. Researchers may
        claim a brief with a public protocol and later link a completion record. Atlas does not run
        repository code, initiate payments, promise outcomes, or interpret completion as scientific
        confirmation.
      </p>
      <Notice tone="warning" title="Published triage is provenance—not scientific truth">
        A frozen triage snapshot records a deterministic reading of declared scope, independent
        evidence families, circular citations, and contradiction classifications at publication. It
        is not a truth score, live corpus ranking, quality rating, funding decision, or ranking of
        researchers. Only a human editor can publish a brief.
      </Notice>

      <div className="btn-row" aria-label="Filter replication briefs">
        <Link href="/replications">All</Link>
        {(["open", "claimed", "completed", "withdrawn"] as const).map((value) => (
          <Link key={value} href={`/replications?status=${value}`}>
            {value}
          </Link>
        ))}
      </div>

      <h2>Published briefs ({marketplace.total})</h2>
      {marketplace.briefs.length === 0 ? (
        <Card>
          <p className="muted">No published briefs match this filter.</p>
        </Card>
      ) : (
        marketplace.briefs.map((brief) => (
          <Card as="article" key={brief.slug}>
            <div className="btn-row">
              <StatusPill status={brief.status} />
              <Badge tone="neutral">{brief.effortBand} effort</Badge>
            </div>
            <h3>
              <Link href={`/replications/${brief.slug}`}>{brief.title}</Link>
            </h3>
            <p>{brief.summary}</p>
            <p className="muted">
              {brief.claims.length} linked claim{brief.claims.length === 1 ? "" : "s"} · published
              by {brief.publishedByLogin ?? "unknown editor"}
              {brief.publishedAt ? ` on ${brief.publishedAt.slice(0, 10)}` : ""}
            </p>
          </Card>
        ))
      )}

      <h2>Published editorial triage provenance</h2>
      <p className="muted prose">
        These signals were frozen when a human editor published a linked brief. They are bounded
        historical provenance, not a live or complete ranking of the current corpus. Current-corpus
        triage runs only in the editor workflow; anonymous page requests never trigger synthesis.
      </p>
      {triage.length === 0 ? (
        <Card>
          <p className="muted">No published brief currently exposes a triage snapshot.</p>
        </Card>
      ) : (
        triage.map((candidate) => (
          <Card as="article" key={candidate.claimId}>
            <div className="btn-row">
              <Badge
                tone={candidate.triageBand === "contradiction-attention" ? "warning" : "neutral"}
              >
                {candidate.triageBand.replaceAll("-", " ")}
              </Badge>
              <span className="muted">
                captured {candidate.capturedAt.slice(0, 10)} for {candidate.sourceBriefSlug}
              </span>
            </div>
            <p>
              <Link href={candidate.passportPath}>{candidate.text}</Link>
            </p>
            <ul>
              {candidate.signals.map((signal) => (
                <li key={signal.code}>
                  <span className="mono">{signal.code}</span> — {signal.explanation}
                </li>
              ))}
            </ul>
            {candidate.signals.length === 0 ? (
              <p className="muted">No higher-attention rule fired in the captured snapshot.</p>
            ) : null}
          </Card>
        ))
      )}
    </article>
  );
}
