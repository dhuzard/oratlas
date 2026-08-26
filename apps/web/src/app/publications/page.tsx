import Link from "next/link";
import { Badge, Card } from "@oratlas/ui";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PublicationsPage() {
  const versions = await prisma.publicationVersion.findMany({
    include: {
      publication: true,
      contributors: { orderBy: { position: "asc" }, take: 5 },
      _count: {
        select: {
          claimOccurrences: true,
          verificationRuns: true,
          certificationResults: true,
        },
      },
    },
    orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    take: 50,
  });

  return (
    <>
      <header className="page-hero">
        <p className="home-eyebrow">Exact scientific records</p>
        <h1>Publications</h1>
        <p className="lead">
          Publications remain at their original homes. ORAtlas records exact versions and connects
          them to claims, verification evidence, discussion and attributed certification.
        </p>
      </header>

      {versions.length === 0 ? (
        <Card>
          <p className="muted">No external publication versions have been registered yet.</p>
        </Card>
      ) : (
        <ol className="publication-list">
          {versions.map((version) => {
            const demo =
              version.id === "ora-demo-publication-version" ||
              version.title?.toLowerCase().includes("synthetic");
            return (
              <li key={version.id}>
                <Card as="article" className="publication-card">
                  <div className="publication-card-heading">
                    <div>
                      <div className="btn-row">
                        <Badge>{version.publication.publicationType.replaceAll("-", " ")}</Badge>
                        <Badge>{version.adapterType}</Badge>
                        {demo ? <Badge tone="warning">Demo / synthetic</Badge> : null}
                      </div>
                      <h2>
                        <Link
                          href={`/publications/${version.publicationId}/versions/${version.id}`}
                        >
                          {version.title ?? "Untitled publication version"}
                        </Link>
                      </h2>
                      {version.contributors.length ? (
                        <p className="muted">
                          {version.contributors.map((item) => item.displayName).join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <p className="publication-version-label">
                      {version.versionLabel ?? "Exact version"}
                      <br />
                      <span className="muted">{version.observedAt.toISOString().slice(0, 10)}</span>
                    </p>
                  </div>
                  <div className="publication-card-counts">
                    <span>{version._count.verificationRuns} verification run(s)</span>
                    <span>{version._count.certificationResults} certification(s)</span>
                    <span>{version._count.claimOccurrences} declared claim(s)</span>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      <p className="muted prose">
        Looking for the earlier AI-generated review collection? The{" "}
        <Link href="/archive">legacy review archive</Link> remains available.
      </p>
    </>
  );
}
