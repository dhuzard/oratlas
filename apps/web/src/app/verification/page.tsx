import Link from "next/link";
import { Badge, Card } from "@oratlas/ui";
import { prisma, parseJsonColumn } from "@/lib/db";

export const dynamic = "force-dynamic";

const planned = [
  "Methods audit",
  "Claim–evidence audit",
  "Statistical design audit",
  "Reproducibility audit",
];

export default async function VerificationPage() {
  const [protocols, recentRuns] = await Promise.all([
    prisma.verificationProtocol.findMany({
      where: { status: "active" },
      include: { authority: true },
      orderBy: [{ verificationType: "asc" }, { protocolVersion: "desc" }],
    }),
    prisma.verificationRun.findMany({
      where: { status: "completed" },
      include: {
        protocol: true,
        claimedVerifier: true,
        publicationVersion: { include: { publication: true } },
        _count: { select: { findings: true, artifacts: true } },
      },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      take: 12,
    }),
  ]);

  return (
    <>
      <header className="page-hero verification-hero">
        <p className="home-eyebrow">Independent, protocol-scoped evidence</p>
        <h1>Scientific verification</h1>
        <p className="lead">
          ORAtlas freezes an exact scientific input and coordinates the run. Independent verifier
          services perform the calculation, then return immutable findings, checked artifacts and
          execution provenance to the ledger.
        </p>
      </header>

      <section className="verification-boundary" aria-labelledby="boundary-title">
        <div>
          <p className="home-eyebrow">Architecture boundary</p>
          <h2 id="boundary-title">
            ORAtlas records the evidence. External services do the science.
          </h2>
        </div>
        <div className="boundary-grid">
          <Card title="ORAtlas">
            <ul className="check-list">
              <li>Identifies one exact subject</li>
              <li>Freezes and hashes canonical input</li>
              <li>Coordinates requests over HTTP</li>
              <li>Retains attributed findings and artifacts</li>
            </ul>
          </Card>
          <Card title="External verifier">
            <ul className="check-list">
              <li>Recomputes reported statistics</li>
              <li>Compares structured figure values</li>
              <li>Compares independent analysis results</li>
              <li>Reports procedure, software and limitations</li>
            </ul>
          </Card>
        </div>
        <p className="notice">
          ORAtlas deliberately does not execute statistics, notebooks, arbitrary publication code,
          figure comparisons or LLM scientific audits.
        </p>
      </section>

      <section className="content-section" aria-labelledby="protocols-title">
        <div className="home-section-heading">
          <div>
            <p className="home-eyebrow">Protocol status</p>
            <h2 id="protocols-title">Available now</h2>
          </div>
          <Link href="/api/verification-protocols">Protocol API</Link>
        </div>
        <div className="grid grid-2">
          {protocols.map((protocol) => (
            <Card key={protocol.id} title={protocol.title}>
              <div className="btn-row">
                <Badge tone="success">Active</Badge>
                <Badge>{protocol.executionMode.replaceAll("-", " ")}</Badge>
              </div>
              <p>{protocol.description}</p>
              <p className="muted">
                {protocol.seriesKey}/{protocol.protocolVersion}
                <br />
                Authority: {protocol.authority.name}
                <br />
                Subjects:{" "}
                {parseJsonColumn<string[]>(protocol.supportedSubjectTypesJson, []).join(", ")}
              </p>
            </Card>
          ))}
        </div>
        <Card title="In development" className="planned-protocols">
          <ul className="protocol-status-list">
            {planned.map((name) => (
              <li key={name}>
                <span aria-hidden="true">○</span> {name}
              </li>
            ))}
          </ul>
          <p className="muted">
            These audit families are reserved concepts, not production-enabled LLM auditors.
          </p>
        </Card>
      </section>

      <section className="bias-reduced" aria-labelledby="blinded-title">
        <p className="home-eyebrow">Bias-reduced assessment</p>
        <h2 id="blinded-title">A blinded scientific input is a concrete, inspectable artifact.</h2>
        <p>
          The blinded-scientific profile withholds contributor, affiliation and production-actor
          presentation metadata during first-pass assessment while retaining scientific content,
          exact captures, relations and necessary provenance. It reduces selected identity cues; it
          does not claim to make an assessment unbiased.
        </p>
        <dl className="inline-definitions">
          <div>
            <dt>Input profile</dt>
            <dd className="mono">verification-publication-input/1.0.0</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>PublicationVersion packet 1.3.0</dd>
          </div>
          <div>
            <dt>Integrity</dt>
            <dd>Exact SHA-256 stored per run</dd>
          </div>
        </dl>
      </section>

      <section className="content-section" aria-labelledby="recent-verification-title">
        <div className="home-section-heading">
          <div>
            <p className="home-eyebrow">Immutable ledger</p>
            <h2 id="recent-verification-title">Recent completed runs</h2>
          </div>
        </div>
        {recentRuns.length ? (
          <ul className="ledger-list">
            {recentRuns.map((run) => (
              <li key={run.id}>
                <div>
                  <Link href={`/verifications/${run.id}`}>
                    <strong>{run.protocol.title}</strong>
                  </Link>
                  <p className="muted">
                    {run.claimedVerifier?.name ?? "Attributed verifier"} · {run._count.findings}{" "}
                    finding(s) · {run._count.artifacts} artifact(s)
                  </p>
                </div>
                {run.publicationVersion ? (
                  <Link
                    href={`/publications/${run.publicationVersion.publicationId}/versions/${run.publicationVersion.id}`}
                  >
                    Publication version
                  </Link>
                ) : (
                  <Badge>Exact scientific subject</Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No completed verification runs are attached in this environment yet.
          </p>
        )}
      </section>
    </>
  );
}
