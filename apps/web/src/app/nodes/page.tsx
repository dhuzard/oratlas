import { type Metadata } from "next";
import { Card, Badge } from "@oratlas/ui";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Knowledge nodes" };

export default async function NodesPage() {
  const identities = await prisma.knowledgeNode.findMany({
    where: { versions: { some: {} } },
    orderBy: [{ updatedAt: "desc" }, { localNodeId: "asc" }],
    include: {
      repository: { select: { owner: true, name: true, canonicalUrl: true } },
      versions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 100,
  });

  return (
    <div>
      <h1>Knowledge nodes</h1>
      <p className="muted">
        Editorially accepted claim, figure, dataset, and code publications. Detailed node pages,
        graph context, and version history arrive in KG-05.
      </p>
      {identities.length === 0 ? (
        <Card>
          <p className="muted">No knowledge nodes have been published yet.</p>
        </Card>
      ) : (
        identities.map((identity) => {
          const version = identity.versions[0]!;
          return (
            <Card as="article" key={identity.id}>
              <div className="btn-row">
                <Badge>{identity.kind}</Badge>
                <strong>{version.title}</strong>
              </div>
              {version.abstract ? (
                <p>{version.abstract}</p>
              ) : version.text ? (
                <p>{version.text}</p>
              ) : null}
              <p className="muted">
                <span className="mono">{identity.localNodeId}</span> · repository{" "}
                <a href={identity.repository.canonicalUrl}>
                  {identity.repository.owner}/{identity.repository.name}
                </a>
              </p>
            </Card>
          );
        })
      )}
    </div>
  );
}
