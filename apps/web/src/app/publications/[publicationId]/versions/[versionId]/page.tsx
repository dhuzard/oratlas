import { notFound } from "next/navigation";
import { Badge, Card, DefinitionList } from "@oratlas/ui";
import { getCurrentUser, isEditor } from "@/lib/auth";
import { listPublicationVersionCertifications } from "@/lib/certification";
import { prisma, parseJsonColumn } from "@/lib/db";
import { getOraCertificationReadiness } from "@/lib/ora-certification";
import { oraPilotPresentation } from "@/lib/ora-certification-presentation";
import { OraInitiateButton } from "./OraInitiateButton";

export const dynamic = "force-dynamic";

export default async function PublicationVersionPage({ params }: { params: Promise<{ publicationId: string; versionId: string }> }) {
  const { publicationId, versionId } = await params;
  const version = await prisma.publicationVersion.findFirst({
    where: { id: versionId, publicationId },
    include: { publication: true },
  });
  if (!version) notFound();
  const user = await getCurrentUser();
  const certifications = (await listPublicationVersionCertifications(version.id)).certifications;
  const readiness = isEditor(user) ? await getOraCertificationReadiness(version.id) : null;
  const warnings = parseJsonColumn<string[]>(version.verificationWarningsJson, []);
  const completeness = parseJsonColumn<{ coverage: string; returnedDocuments: number; totalDocumentsKnown: number | null; truncated: boolean }>(version.contentCompletenessJson, { coverage: "unsupported", returnedDocuments: 0, totalDocumentsKnown: null, truncated: false });
  const demo = version.id === "ora-demo-publication-version" || warnings.some((warning) => /demo|synthetic/i.test(warning));

  return (
    <article>
      <div className="btn-row">
        <Badge>{version.publication.publicationType.replaceAll("-", " ")}</Badge>
        {demo ? <Badge tone="warning">Demo / synthetic</Badge> : null}
      </div>
      <h1>{version.title ?? "Publication version"}</h1>
      {demo ? <p className="lead">A synthetic fixture for demonstrating the certification platform. It is not a real article or scientific assessment.</p> : null}
      <div className="grid layout-2">
        <div>
          <Card title="Attributed certifications">
            {certifications.length === 0 ? <p className="muted">No certification results exist for this exact version.</p> : (
              <ul>
                {certifications.map((certification) => {
                  const presentation = oraPilotPresentation(certification);
                  return <li key={certification.id}>
                    <a href={`/certifications/${certification.id}`}><strong>{presentation?.label ?? `${certification.certifier.name}: ${certification.outcome.replaceAll("-", " ")}`}</strong></a>
                    <br />{certification.protocol.title} · v{certification.protocol.version}
                    <br /><span className="muted">{certification.assessmentMode} assessment · issued {certification.issuedAt.slice(0, 10)} · lifecycle {certification.lifecycleState}</span>
                  </li>;
                })}
              </ul>
            )}
            <p className="muted">Results from different certifiers remain separate attributed assertions; disagreement is not collapsed into a consensus score.</p>
          </Card>
          {readiness ? <Card title="Editorial ORA initiation">
            <p>Exact PublicationVersion <span className="mono">{version.id}</span></p>
            <p>Protocol: ORA Scientific Merit Pilot · v0.1.0 · AI assessment</p>
            <p>Frozen content state: {completeness.coverage}; {completeness.returnedDocuments} document(s); corpus SHA <span className="mono">{version.contentCorpusSha256}</span>.</p>
            <OraInitiateButton publicationVersionId={version.id} available={readiness.available} />
          </Card> : null}
        </div>
        <aside>
          <Card title="Exact publication version">
            <DefinitionList items={[
              { term: "Publication", value: <span className="mono">{version.publicationId}</span> },
              { term: "PublicationVersion", value: <span className="mono">{version.id}</span> },
              { term: "Version", value: version.versionLabel },
              { term: "Source SHA-256", value: <span className="mono">{version.sourcesSha256}</span> },
              { term: "Adapter", value: version.adapterType },
              { term: "Structural provenance", value: version.structuralProvenance },
              { term: "Content coverage", value: completeness.coverage },
              { term: "Observed", value: version.observedAt.toISOString() },
            ]} />
          </Card>
          <Card title="Machine-readable records">
            <ul>
              <li><a href={`/api/publication-versions/${version.id}`}>PublicationVersion JSON</a></li>
              <li><a href={`/api/publication-versions/${version.id}/packet`}>Frozen packet 1.2.0</a></li>
              <li><a href={`/api/publication-versions/${version.id}/certifications`}>All certification results</a></li>
            </ul>
          </Card>
        </aside>
      </div>
    </article>
  );
}
