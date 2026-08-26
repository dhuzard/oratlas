import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, DefinitionList } from "@oratlas/ui";
import { getCurrentUser, isEditor } from "@/lib/auth";
import { listPublicationVersionCertifications } from "@/lib/certification";
import { prisma, parseJsonColumn } from "@/lib/db";
import { getOraCertificationReadiness } from "@/lib/ora-certification";
import { oraPilotPresentation } from "@/lib/ora-certification-presentation";
import { getPublicationVersionContent } from "@/lib/publication-content";
import { listPublicationVersionContributors } from "@/lib/publication-contributors";
import { listPublicationProductionProvenance } from "@/lib/publication-provenance";
import { OraInitiateButton } from "./OraInitiateButton";
import {
  listPublicationVersionVerifications,
  listVerificationProtocols,
} from "@/lib/scientific-verification";
import { VerificationInitiateForm } from "./VerificationInitiateForm";

export const dynamic = "force-dynamic";

export default async function PublicationVersionPage({
  params,
}: {
  params: Promise<{ publicationId: string; versionId: string }>;
}) {
  const { publicationId, versionId } = await params;
  const version = await prisma.publicationVersion.findFirst({
    where: { id: versionId, publicationId },
    include: {
      publication: true,
      captures: { orderBy: [{ capturedAt: "asc" }, { id: "asc" }] },
      claimOccurrences: {
        include: { graphVersion: true },
        orderBy: [{ sourceLocalClaimId: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!version) notFound();

  const user = await getCurrentUser();
  const [certificationResponse, verifications, contributors, production, content] =
    await Promise.all([
      listPublicationVersionCertifications(version.id),
      listPublicationVersionVerifications(version.id),
      listPublicationVersionContributors(version.id),
      listPublicationProductionProvenance(version.id),
      getPublicationVersionContent(version.id),
    ]);
  const certifications = certificationResponse.certifications;
  const readiness = isEditor(user) ? await getOraCertificationReadiness(version.id) : null;
  const verificationProtocols = isEditor(user)
    ? (await listVerificationProtocols()).protocols.filter(
        (protocol) =>
          protocol.status === "active" &&
          (protocol.supportedSubjectTypes as string[]).includes("publication-version"),
      )
    : [];
  const warnings = parseJsonColumn<string[]>(version.verificationWarningsJson, []);
  const completeness = content.completeness;
  const adapter = parseJsonColumn<{ protocolVersion?: string }>(version.adapterBindingJson, {});
  const demo =
    version.id === "ora-demo-publication-version" ||
    warnings.some((warning) => /demo|synthetic/i.test(warning));
  const externalUrl = version.canonicalUrl ?? version.observedPublicationBaseUrl;

  return (
    <article className="publication-record">
      <header className="publication-masthead">
        <div className="btn-row">
          <Badge>{version.publication.publicationType.replaceAll("-", " ")}</Badge>
          <Badge>Exact version</Badge>
          {demo ? <Badge tone="warning">Demo / synthetic</Badge> : null}
        </div>
        <h1>{version.title ?? "Publication version"}</h1>
        {contributors.contributors.length ? (
          <p className="publication-authors">
            {contributors.contributors.map((contributor) => contributor.displayName).join(", ")}
          </p>
        ) : (
          <p className="muted">No scholarly contributors were declared for this exact version.</p>
        )}
        <div className="publication-source-line">
          {externalUrl ? (
            <a className="btn" href={externalUrl} rel="external">
              Read external publication ↗
            </a>
          ) : null}
          <span>
            {version.versionLabel ?? "Version label not declared"} · captured{" "}
            {version.observedAt.toISOString().slice(0, 10)}
          </span>
        </div>
        {demo ? (
          <p className="notice notice-warning">
            This is a synthetic fixture for demonstrating the evidence and certification platform.
            It is not a real article or scientific assessment.
          </p>
        ) : null}
      </header>

      <section
        className="record-section verification-summary-section"
        aria-labelledby="verification-summary-title"
      >
        <div className="record-section-heading">
          <div>
            <p className="home-eyebrow">Independent evidence</p>
            <h2 id="verification-summary-title">Scientific verification</h2>
          </div>
          <Link href="/verification">How verification works</Link>
        </div>
        {verifications.runs.length === 0 ? (
          <Card>
            <p>No independent verification evidence exists for this exact version.</p>
            <p className="muted">
              Absence of a finding is not a failed check and says nothing about scientific quality.
            </p>
          </Card>
        ) : (
          <>
            <div className="verification-metrics">
              {(["statistics", "figures", "analyses"] as const).map((category) => (
                <VerificationMetric
                  key={category}
                  label={category}
                  counts={verifications.summary[category]}
                />
              ))}
            </div>
            <Card title="Verification evidence">
              <ul className="evidence-run-list">
                {verifications.runs.map((run) => (
                  <li key={run.id}>
                    <div>
                      <Link href={`/verifications/${run.id}`}>
                        <strong>{run.protocol.seriesKey.replaceAll("-", " ")}</strong>
                      </Link>
                      <p className="muted">
                        v{run.protocol.version} · {run.status} ·{" "}
                        {run.verifier?.name ?? "not yet claimed"}
                      </p>
                    </div>
                    <span>{run.findings.length} finding(s)</span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
        <p className="muted prose">
          Findings are independent, protocol-scoped evidence. Structured figure consistency, visual
          similarity, regeneration and independent reproduction are reported as distinct procedures.
        </p>
        {isEditor(user) ? (
          <Card title="Request external verification">
            <VerificationInitiateForm
              publicationVersionId={version.id}
              protocols={verificationProtocols.map((protocol) => ({
                id: protocol.id,
                label: `${protocol.title} · ${protocol.protocolVersion}`,
              }))}
            />
          </Card>
        ) : null}
      </section>

      <section className="record-section" aria-labelledby="certification-title">
        <div className="record-section-heading">
          <div>
            <p className="home-eyebrow">Evidence synthesis</p>
            <h2 id="certification-title">Certification</h2>
          </div>
          <Link href="/certifications">All certifications</Link>
        </div>
        {certifications.length === 0 ? (
          <Card>
            <p className="muted">No certification results exist for this exact version.</p>
          </Card>
        ) : (
          <div className="grid grid-2">
            {certifications.map((certification) => {
              const presentation = oraPilotPresentation(certification);
              return (
                <Card key={certification.id} title={certification.certifier.name}>
                  <p>
                    <Link href={`/certifications/${certification.id}`}>
                      <strong>
                        {presentation?.label ?? certification.outcome.replaceAll("-", " ")}
                      </strong>
                    </Link>
                  </p>
                  <p>
                    {certification.protocol.title} · v{certification.protocol.version}
                  </p>
                  <p className="muted">
                    {certification.assessmentMode} assessment · issued{" "}
                    {certification.issuedAt.slice(0, 10)} · {certification.lifecycleState}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
        <p className="muted prose">
          Each result is a separate attributed assertion under a versioned protocol. Independent
          certifiers may reach different conclusions; ORAtlas does not collapse them into a score.
        </p>
        {readiness ? (
          <Card title="Editorial ORA initiation">
            <p>
              Exact PublicationVersion <span className="mono">{version.id}</span>
            </p>
            {readiness.protocol ? (
              <p>
                Protocol: {readiness.protocol.title} · v{readiness.protocol.version} ·{" "}
                {readiness.assessmentMode.toUpperCase()} assessment
              </p>
            ) : (
              <p>Protocol: ORA Scientific Merit Pilot 0.1.0 is not active.</p>
            )}
            <OraInitiateButton publicationVersionId={version.id} available={readiness.available} />
          </Card>
        ) : null}
      </section>

      <section className="record-section" aria-labelledby="publication-content-title">
        <div className="record-section-heading">
          <div>
            <p className="home-eyebrow">Frozen source representation</p>
            <h2 id="publication-content-title">Publication</h2>
          </div>
          <a href={`/api/publication-versions/${version.id}/content`}>Content JSON</a>
        </div>
        {content.content.length ? (
          content.content.map((document) => (
            <Card
              key={document.id}
              title={document.title ?? document.role?.replaceAll("-", " ") ?? "Publication content"}
            >
              <div className="publication-text">
                {document.text.split(/\n\s*\n/).map((paragraph, index) => (
                  <p key={`${document.id}:${index}`}>{paragraph}</p>
                ))}
              </div>
              <p className="muted">
                {document.representation.replaceAll("-", " ")} · SHA-256{" "}
                <span className="mono">{document.sha256}</span>
              </p>
            </Card>
          ))
        ) : (
          <Card>
            <p className="muted">No normalized content is available for this adapter.</p>
          </Card>
        )}
      </section>

      <section className="record-section" aria-labelledby="scientific-record-title">
        <div className="record-section-heading">
          <div>
            <p className="home-eyebrow">Version-bound context</p>
            <h2 id="scientific-record-title">Scientific record</h2>
          </div>
          <Link href="/explore">Explore the scientific graph</Link>
        </div>
        <div className="grid grid-2">
          <Card title={`Claims (${version.claimOccurrences.length})`}>
            {version.claimOccurrences.length ? (
              <ul>
                {version.claimOccurrences.map((claim) => (
                  <li key={claim.id}>
                    {claim.graphVersion && claim.knowledgeNodeId ? (
                      <Link
                        href={`/graph/occurrences/${claim.knowledgeNodeId}/versions/${claim.graphVersion.id}`}
                      >
                        {claim.text ?? claim.sourceLocalClaimId}
                      </Link>
                    ) : claim.publishedUrl ? (
                      <a href={claim.publishedUrl} rel="external">
                        {claim.text ?? claim.sourceLocalClaimId}
                      </a>
                    ) : (
                      (claim.text ?? claim.sourceLocalClaimId)
                    )}
                    <br />
                    <span className="muted">
                      {claim.claimType?.replaceAll("-", " ") ?? "claim"} ·{" "}
                      {claim.knowledgeNodeId ? "canonically bound" : "source occurrence"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No source-declared claims are attached to this exact version.</p>
            )}
          </Card>
          <Card title="Assessment and discussion">
            <ul>
              <li>
                <Link href="/discuss">Discussion and disagreements</Link>
              </li>
              <li>
                <Link href="/explore">Claims, evidence relations and TRUST assessments</Link>
              </li>
              <li>
                <a href={`/api/publication-versions/${version.id}/verifications`}>
                  Verification evidence API
                </a>
              </li>
            </ul>
            <p className="muted">
              Verification findings, certification conclusions and TRUST assessments retain their
              own identities and protocols.
            </p>
          </Card>
        </div>
      </section>

      <section className="record-section provenance-section" aria-labelledby="provenance-title">
        <div className="record-section-heading">
          <div>
            <p className="home-eyebrow">Identity and accountability</p>
            <h2 id="provenance-title">Provenance</h2>
          </div>
        </div>
        <div className="grid grid-2">
          <Card title="Scholarly contributors">
            {contributors.contributors.length ? (
              <ol>
                {contributors.contributors.map((contributor) => (
                  <li key={contributor.id}>
                    <strong>{contributor.displayName}</strong>
                    <br />
                    <span className="muted">{contributor.roles.join(", ")}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">
                Contributor snapshot {contributors.declarationStatus.replaceAll("-", " ")}.
              </p>
            )}
          </Card>
          <Card title="Production provenance">
            {production.assertions.length ? (
              <ul>
                {production.assertions.map((assertion) => (
                  <li key={assertion.id}>
                    <strong>{assertion.mode.replaceAll("-", " ")}</strong> ·{" "}
                    {assertion.strength.replaceAll("-", " ")}
                    {assertion.actors.length ? (
                      <ul>
                        {assertion.actors.map((actor, index) => (
                          <li key={`${assertion.id}:${actor.identifier ?? actor.name}:${index}`}>
                            {actor.name ?? actor.identifier} · {actor.kind.replaceAll("-", " ")}
                            {actor.version ? ` ${actor.version}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {assertion.activities.length ? (
                      <p className="muted">{assertion.activities.join(", ")}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No production provenance was declared.</p>
            )}
          </Card>
          <Card title="Source and capture">
            <DefinitionList
              items={[
                { term: "Format adapter", value: version.adapterType },
                { term: "Adapter protocol", value: adapter.protocolVersion ?? "not declared" },
                { term: "Structural provenance", value: version.structuralProvenance },
                { term: "Content coverage", value: completeness.coverage },
                {
                  term: "Captured documents",
                  value: `${completeness.returnedDocuments} of ${completeness.totalDocumentsKnown ?? "unknown"}`,
                },
                { term: "Capture artifacts", value: String(version.captures.length) },
              ]}
            />
          </Card>
          <Card title="Exact scientific identity">
            <DefinitionList
              items={[
                {
                  term: "Publication",
                  value: <span className="mono">{version.publicationId}</span>,
                },
                { term: "PublicationVersion", value: <span className="mono">{version.id}</span> },
                {
                  term: "Sources SHA-256",
                  value: <span className="mono">{version.sourcesSha256}</span>,
                },
                {
                  term: "Content SHA-256",
                  value: <span className="mono">{version.contentCorpusSha256}</span>,
                },
              ]}
            />
          </Card>
        </div>
        {warnings.length ? (
          <Card title="Capture warnings">
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card title="Machine-readable records">
          <div className="machine-links">
            <a href={`/api/publication-versions/${version.id}`}>PublicationVersion JSON</a>
            <a href={`/api/publication-versions/${version.id}/packet`}>Frozen packet 1.3.0</a>
            <a href={`/api/publication-versions/${version.id}/contributors`}>Contributors</a>
            <a href={`/api/publication-versions/${version.id}/production-provenance`}>
              Production provenance
            </a>
            <a href={`/api/publication-versions/${version.id}/certifications`}>Certifications</a>
            <a href={`/api/publication-versions/${version.id}/verifications`}>Verifications</a>
          </div>
        </Card>
      </section>
    </article>
  );
}

function VerificationMetric({
  label,
  counts,
}: {
  label: "statistics" | "figures" | "analyses";
  counts: Record<string, number> | undefined;
}) {
  const total = Object.values(counts ?? {}).reduce((sum, count) => sum + count, 0);
  return (
    <Card className="verification-metric">
      <p className="demo-label">{label}</p>
      <strong className="verification-total">{total}</strong>
      <p>{counts ? formatCounts(counts) : "No findings"}</p>
    </Card>
  );
}

function formatCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([status, count]) => `${count} ${status.replaceAll("-", " ")}`)
    .join(" · ");
}
