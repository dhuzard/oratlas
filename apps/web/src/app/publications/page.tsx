import Link from "next/link";
import { Badge, Card } from "@oratlas/ui";
import { prisma } from "@/lib/db";
import { SourceNavigation } from "@/components/SourceNavigation";

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
        <h1>Sources</h1>
        <p className="lead">
          Publications remain at their original homes. ORAtlas records exact versions and connects
          them to claims, verification evidence, discussion and attributed certification.
        </p>
      </header>

      <SourceNavigation current="/publications" />
      <p className="muted prose">
        Showing the {versions.length} most recently observed registered publication versions (up to
        50). A publication may have several exact versions. Archived reviews and research objects
        have separate collections and filters.
      </p>

      <section id="add-source" className="source-handoff" aria-labelledby="add-source-title">
        <h2 id="add-source-title">Add a supported public source</h2>
        <p>
          Choose the path for your source. ORAtlas preserves an exact version; submission and
          structural checks do not establish scientific correctness.
        </p>
        <div className="grid grid-2">
          <Card title="Public GitHub repository">
            <p>
              Deposit a completed computational review, declared research objects, or both. Sign in,
              select an exact release, tag or commit, inspect the capture and submit it for an
              editorial decision.
            </p>
            <Link href="/submit">Inspect and deposit a repository</Link>
          </Card>
          <Card title="Published MyST site">
            <p>
              A supported machine-readable manifest can be registered by an editor through the
              existing registration API. Prepare the source with the adapter guide; this page does
              not import a site URL.
            </p>
            <Link href="/connect">Prepare a MyST publication</Link>
          </Card>
        </div>
        <p className="muted">
          Arbitrary PDF uploads, private sources, JATS and Quarto imports are not supported here.
        </p>
        <details>
          <summary>Three public source examples · read-only pilot</summary>
          <p>
            See what CRT, DiggyPaper and Murmuration exports expose, including exact inspected
            versions, missing material and source-native assessments. These observations do not
            establish accepted archive records or scientific relationships.
          </p>
          <Link href="/publications/pilot">Inspect the public source pilot</Link>
        </details>
      </section>

      <h2>Registered publication versions</h2>

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
