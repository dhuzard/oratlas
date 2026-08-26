import Link from "next/link";
import { Badge, Card } from "@oratlas/ui";
import { prisma } from "@/lib/db";
import { oraPilotPresentation } from "@/lib/ora-certification-presentation";

export const dynamic = "force-dynamic";

export default async function CertificationsPage() {
  const results = await prisma.certificationResult.findMany({
    include: {
      certifier: true,
      protocol: true,
      publicationVersion: { include: { publication: true } },
      lifecycleEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    take: 50,
  });

  return (
    <>
      <header className="page-hero">
        <p className="home-eyebrow">Attributed evidence synthesis</p>
        <h1>Certifications</h1>
        <p className="lead">
          A certification is a versioned conclusion by one identifiable certifier under one
          protocol. It may use verification evidence, and another certifier may disagree.
        </p>
      </header>
      <Card title="Interpretation">
        <p>
          Certification is not the product’s universal verdict. It sits downstream of scientific
          verification, independent audits and claim–evidence information. ORA Scientific Merit
          Pilot 0.1.0 remains an immutable pilot protocol.
        </p>
      </Card>
      {results.length ? (
        <ul className="ledger-list">
          {results.map((result) => {
            const lifecycleState = result.lifecycleEvents.at(-1)?.kind ?? "issued";
            const presentation = oraPilotPresentation({
              certifier: result.certifier,
              protocol: {
                seriesKey: result.protocol.seriesKey,
                version: result.protocol.protocolVersion,
              },
              outcome: result.outcome,
              lifecycleState,
            });
            return (
              <li key={result.id}>
                <div>
                  <div className="btn-row">
                    <Badge>{lifecycleState}</Badge>
                    <Badge>{result.assessmentMode} assessment</Badge>
                  </div>
                  <h2>
                    <Link href={`/certifications/${result.id}`}>
                      {presentation?.label ??
                        `${result.certifier.name}: ${result.outcome.replaceAll("-", " ")}`}
                    </Link>
                  </h2>
                  <p className="muted">
                    {result.protocol.title} · v{result.protocol.protocolVersion} · issued{" "}
                    {result.issuedAt.toISOString().slice(0, 10)}
                  </p>
                </div>
                <Link
                  href={`/publications/${result.publicationVersion.publicationId}/versions/${result.publicationVersionId}`}
                >
                  Exact publication version
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">
          No public certification results are attached in this environment yet.
        </p>
      )}
    </>
  );
}
