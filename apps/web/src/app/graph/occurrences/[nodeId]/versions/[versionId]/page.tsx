import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, Card, DefinitionList } from "@oratlas/ui";
import type { CanonicalGraphNodeVersion } from "@oratlas/contracts";
import { SpecialistToolBreadcrumb } from "@/components/SpecialistTools";
import { CanonicalGraphQueryError, queryCanonicalGraph } from "@/lib/canonical-graph-query";
import { canonicalOccurrenceHref } from "@/lib/knowledge-landscape-service";
import { listPublicationVersionCertifications } from "@/lib/certification";
import { oraPilotPresentation } from "@/lib/ora-certification-presentation";

export const dynamic = "force-dynamic";

interface OccurrencePageProps {
  params: Promise<{ nodeId: string; versionId: string }>;
}

export async function generateMetadata({ params }: OccurrencePageProps): Promise<Metadata> {
  const { nodeId, versionId } = await params;
  const occurrence = await loadOccurrence(nodeId, versionId);
  return occurrence
    ? { title: `${occurrence.node.title ?? occurrence.node.localNodeId} — exact graph occurrence` }
    : { title: "Graph occurrence not found" };
}

export default async function CanonicalOccurrencePage({ params }: OccurrencePageProps) {
  const { nodeId, versionId } = await params;
  const occurrence = await loadOccurrence(nodeId, versionId);
  if (!occurrence) notFound();
  const { node, graph } = occurrence;
  const certifications =
    node.source.type === "publication-claim-occurrence"
      ? (await listPublicationVersionCertifications(node.source.publicationVersionId))
          .certifications
      : [];
  const nodeByVersion = new Map(
    graph.nodes.map((candidate) => [candidate.nodeVersionId, candidate]),
  );

  return (
    <article>
      <SpecialistToolBreadcrumb
        current={node.title ?? node.localNodeId}
        parent={{ href: "/explore", label: "Explore" }}
      />
      <div className="btn-row">
        <Badge>Exact canonical occurrence</Badge>
        <Badge>{node.kind}</Badge>
        <Badge>{node.source.type.replaceAll("-", " ")}</Badge>
      </div>
      <h1>{node.title ?? node.text ?? node.localNodeId}</h1>
      {node.abstract ? <p className="lead muted">{node.abstract}</p> : null}
      {node.source.type === "publication-claim-occurrence" ? (
        <p>
          <a className="btn" href={node.source.publishedTargetUrl} rel="external">
            Open original publication
          </a>
        </p>
      ) : null}

      <div className="grid layout-2">
        <div>
          <Card title="Canonical content">
            {node.text && node.text !== node.title ? <p>{node.text}</p> : null}
            <details>
              <summary>Structured payload</summary>
              <pre className="mono">{JSON.stringify(node.payload, null, 2)}</pre>
            </details>
          </Card>

          <Card title={`Authoritative relations (${graph.edges.length})`}>
            {graph.edges.length === 0 ? (
              <p className="muted">No authoritative relations are attached to this occurrence.</p>
            ) : (
              <ul className="node-relation-list">
                {graph.edges.map((edge) => {
                  const outgoing = edge.sourceNodeVersionId === node.nodeVersionId;
                  const related = nodeByVersion.get(
                    outgoing ? edge.targetNodeVersionId : edge.sourceNodeVersionId,
                  );
                  return (
                    <li key={edge.id}>
                      <div className="btn-row">
                        <Badge>{outgoing ? "outgoing" : "incoming"}</Badge>
                        <Badge>{edge.relationType.replaceAll("-", " ")}</Badge>
                        <Badge>{edge.status.replaceAll("-", " ")}</Badge>
                      </div>
                      {related ? (
                        <a href={canonicalOccurrenceHref(related.nodeId, related.nodeVersionId)}>
                          {related.title ?? related.text ?? related.localNodeId}
                        </a>
                      ) : null}
                      {edge.rationale ? <p>{edge.rationale}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <aside>
          <Card title="Exact identity">
            <DefinitionList
              items={[
                { term: "Node ID", value: <span className="mono">{node.nodeId}</span> },
                {
                  term: "Node version ID",
                  value: <span className="mono">{node.nodeVersionId}</span>,
                },
                { term: "Source", value: sourceLabel(node.source) },
                { term: "Captured", value: node.createdAt.slice(0, 10) },
                ...(node.repository
                  ? [
                      {
                        term: "Repository",
                        value: (
                          <a href={node.repository.canonicalUrl}>
                            {node.repository.owner}/{node.repository.name}
                          </a>
                        ),
                      },
                      {
                        term: "Commit",
                        value: <span className="mono">{node.repository.commitSha}</span>,
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
          <Card title="Machine-readable API">
            <a
              href={`/api/graph?seed=${encodeURIComponent(node.nodeId)}&version=${encodeURIComponent(node.nodeVersionId)}&limit=100`}
            >
              JSON for this exact occurrence
            </a>
          </Card>
          {node.source.type === "publication-claim-occurrence" ? (
            <Card title="Certifications">
              {certifications.length === 0 ? (
                <p className="muted">
                  No attributed certification results for this exact publication version.
                </p>
              ) : (
                <ul>
                  {certifications.map((certification) => (
                    <li key={certification.id}>
                      <a href={`/certifications/${certification.id}`}>
                        {oraPilotPresentation(certification)?.label ?? certification.certifier.name}
                      </a>
                      <br />
                      {certification.protocol.title} v{certification.protocol.version}:{" "}
                      {String(certification.outcome).replaceAll("-", " ")}
                      <br />
                      <span className="muted">
                        {certification.assessmentMode} assessment ·{" "}
                        {certification.issuedAt.slice(0, 10)} · lifecycle:{" "}
                        {String(certification.lifecycleState).replaceAll("-", " ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

async function loadOccurrence(nodeId: string, versionId: string) {
  try {
    const graph = await queryCanonicalGraph({
      seed: nodeId,
      version: versionId,
      direction: "both",
      status: "authoritative",
      limit: 100,
    });
    const node = graph.nodes.find((candidate) => candidate.nodeVersionId === versionId);
    return node ? { graph, node } : null;
  } catch (error) {
    if (error instanceof CanonicalGraphQueryError && error.code === "not-found") return null;
    throw error;
  }
}

function sourceLabel(source: CanonicalGraphNodeVersion["source"]): string {
  switch (source.type) {
    case "repository-snapshot":
      return `repository snapshot ${source.snapshotId}`;
    case "review-version":
      return `review version ${source.reviewVersionId}`;
    case "claim-occurrence":
      return `claim occurrence ${source.claimId}`;
    case "citation-occurrence":
      return `citation occurrence ${source.citationId}`;
    case "publication-claim-occurrence":
      return `publication ${source.publicationId}, version ${source.publicationVersionId}, claim ${source.sourceLocalClaimId}`;
  }
}
