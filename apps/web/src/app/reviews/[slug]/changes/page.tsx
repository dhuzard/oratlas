import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@oratlas/ui";
import type {
  SynthesisCitationListDelta,
  SynthesisDeltaContradictionReference,
  SynthesisDeltaEdgeReference,
  SynthesisDeltaNodeReference,
} from "@oratlas/knowledge";
import { getPublicSynthesisGenerationDiff } from "@/lib/synthesis-generation-diff";

export const dynamic = "force-dynamic";

function NodeLink({ node }: { node: SynthesisDeltaNodeReference }) {
  return (
    <Link href={"/nodes/" + node.nodeId + "/versions/" + node.nodeVersionId}>
      {node.nodeId} <span className="mono">@ {node.nodeVersionId}</span>
    </Link>
  );
}

function NodeList({ label, nodes }: { label: string; nodes: SynthesisDeltaNodeReference[] }) {
  const headingId = "nodes-" + label.toLowerCase();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>
        {label} <Badge>{nodes.length}</Badge>
      </h3>
      {nodes.length ? (
        <ul>
          {nodes.map((node) => (
            <li key={node.nodeId + ":" + node.nodeVersionId}>
              <NodeLink node={node} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None.</p>
      )}
    </section>
  );
}

function EdgeLabel({ edge }: { edge: SynthesisDeltaEdgeReference }) {
  return (
    <>
      <span className="mono">{edge.edgeId}</span>: {edge.source.nodeId} @{" "}
      <span className="mono">{edge.source.nodeVersionId}</span> → {edge.relationType} →{" "}
      {edge.target.nodeId} @ <span className="mono">{edge.target.nodeVersionId}</span>
    </>
  );
}

function EdgeList({ label, edges }: { label: string; edges: SynthesisDeltaEdgeReference[] }) {
  const headingId = "edges-" + label.toLowerCase();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>
        {label} <Badge>{edges.length}</Badge>
      </h3>
      {edges.length ? (
        <ul>
          {edges.map((edge) => (
            <li key={edge.edgeId}>
              <EdgeLabel edge={edge} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None.</p>
      )}
    </section>
  );
}

function ContradictionList({
  label,
  pairs,
}: {
  label: string;
  pairs: SynthesisDeltaContradictionReference[];
}) {
  const headingId = "contradictions-" + label.toLowerCase();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>
        {label} <Badge>{pairs.length}</Badge>
      </h3>
      {pairs.length ? (
        <ul>
          {pairs.map((pair) => (
            <li
              key={
                pair.left.nodeId +
                ":" +
                pair.left.nodeVersionId +
                ":" +
                pair.right.nodeId +
                ":" +
                pair.right.nodeVersionId
              }
            >
              {pair.left.nodeId} @ <span className="mono">{pair.left.nodeVersionId}</span> ↔{" "}
              {pair.right.nodeId} @ <span className="mono">{pair.right.nodeVersionId}</span>{" "}
              <span className="muted">({pair.edgeIds.join(", ")})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None.</p>
      )}
    </section>
  );
}

function CitationDelta({ value }: { value: SynthesisCitationListDelta }) {
  const list = (label: string, citations: SynthesisCitationListDelta["previous"]) => (
    <div>
      <h4>{label}</h4>
      {citations.length ? (
        <ul>
          {citations.map((citation) => (
            <li key={citation.referenceId}>
              {citation.nodeId} @ <span className="mono">{citation.nodeVersionId}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None.</p>
      )}
    </div>
  );
  return (
    <div className="grid-2">
      {list("Previous references", value.previous)}
      {list("Current references", value.current)}
    </div>
  );
}

export default async function SynthesisChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const result = await getPublicSynthesisGenerationDiff(slug, {
    fromVersionId: query.from,
    toVersionId: query.to,
  });
  if (!result) notFound();
  const { delta } = result;

  return (
    <div>
      <p>
        <Link href={"/reviews/" + result.slug}>← Back to {result.title}</Link>
      </p>
      <h1>What changed between accepted synthesis generations</h1>
      <p className="lead">
        Accepted version {result.from.ordinal} → accepted version {result.to.ordinal}
      </p>
      <Notice tone="warning" title="Structured evidence is primary">
        Evidence membership, exact immutable versions, confirmed relations, TRUST reassessments and
        contradictions are shown before the secondary review-text comparison.
      </Notice>

      <section aria-labelledby="structured-evidence-delta">
        <h2 id="structured-evidence-delta">Structured evidence delta</h2>
        {delta.isNoop ? <p>No canonical generation changes were detected.</p> : null}
        <Card title="Exact node references">
          <NodeList label="Added" nodes={delta.nodes.added} />
          <NodeList label="Removed" nodes={delta.nodes.removed} />
          <section aria-labelledby="nodes-reassessed">
            <h3 id="nodes-reassessed">
              Re-assessed at a new immutable version <Badge>{delta.nodes.reassessed.length}</Badge>
            </h3>
            {delta.nodes.reassessed.length ? (
              <ul>
                {delta.nodes.reassessed.map((node) => (
                  <li key={node.nodeId}>
                    {node.nodeId}: <span className="mono">{node.previous.nodeVersionId}</span> →{" "}
                    <span className="mono">{node.current.nodeVersionId}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None.</p>
            )}
          </section>
        </Card>

        <Card title="Editor-confirmed relations and TRUST">
          <EdgeList label="Added" edges={delta.confirmedEdges.added} />
          <EdgeList label="Removed" edges={delta.confirmedEdges.removed} />
          <section aria-labelledby="edges-changed">
            <h3 id="edges-changed">
              Changed <Badge>{delta.confirmedEdges.changed.length}</Badge>
            </h3>
            {delta.confirmedEdges.changed.length ? (
              <ul>
                {delta.confirmedEdges.changed.map((edge) => (
                  <li key={edge.edgeId}>
                    <span className="mono">{edge.edgeId}</span>:{" "}
                    {edge.changedFields.map((field) => (
                      <Badge key={field} tone={field === "trust" ? "warning" : "neutral"}>
                        {field === "trust" ? "TRUST re-assessed" : field}
                      </Badge>
                    ))}
                    <div className="muted">
                      Previous: {edge.previous.source.nodeId} @{" "}
                      <span className="mono">{edge.previous.source.nodeVersionId}</span> →{" "}
                      {edge.previous.relationType} → {edge.previous.target.nodeId} @{" "}
                      <span className="mono">{edge.previous.target.nodeVersionId}</span>
                    </div>
                    <div className="muted">
                      Current: {edge.current.source.nodeId} @{" "}
                      <span className="mono">{edge.current.source.nodeVersionId}</span> →{" "}
                      {edge.current.relationType} → {edge.current.target.nodeId} @{" "}
                      <span className="mono">{edge.current.target.nodeVersionId}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None.</p>
            )}
          </section>
        </Card>

        <Card title="Contradiction pairs">
          <ContradictionList label="Opened" pairs={delta.contradictions.opened} />
          <ContradictionList label="Resolved" pairs={delta.contradictions.resolved} />
        </Card>
      </section>

      <section aria-labelledby="secondary-document-delta">
        <h2 id="secondary-document-delta">Secondary review document delta</h2>
        {delta.secondaryDocument.title ? (
          <Card title="Title changed">
            <p>
              <del>{delta.secondaryDocument.title.previous}</del>
            </p>
            <p>
              <ins>{delta.secondaryDocument.title.current}</ins>
            </p>
          </Card>
        ) : null}
        {delta.secondaryDocument.summary ? (
          <Card title="Summary changed">
            <p>
              <del>{delta.secondaryDocument.summary.previous}</del>
            </p>
            <p>
              <ins>{delta.secondaryDocument.summary.current}</ins>
            </p>
          </Card>
        ) : null}
        {delta.secondaryDocument.topLevelCitations ? (
          <Card title="Title and summary citation attribution changed">
            <CitationDelta value={delta.secondaryDocument.topLevelCitations} />
          </Card>
        ) : null}
        {delta.sectionText.map((section) => (
          <Card title={section.title} key={section.sectionId}>
            {section.paragraphChanges.map((paragraph) => (
              <div key={paragraph.paragraphIndex}>
                <h3>Paragraph {paragraph.paragraphIndex + 1}</h3>
                {paragraph.previousText ? (
                  <p>
                    <del>{paragraph.previousText}</del>
                  </p>
                ) : null}
                {paragraph.currentText ? (
                  <p>
                    <ins>{paragraph.currentText}</ins>
                  </p>
                ) : null}
              </div>
            ))}
          </Card>
        ))}
        {delta.secondaryDocument.paragraphCitations.map((citations) => (
          <Card
            title={
              "Citation attribution: " +
              citations.sectionId +
              ", paragraph " +
              (citations.paragraphIndex + 1)
            }
            key={citations.sectionId + ":" + citations.paragraphIndex}
          >
            <CitationDelta value={citations} />
          </Card>
        ))}
        {!delta.secondaryDocument.title &&
        !delta.secondaryDocument.summary &&
        !delta.secondaryDocument.topLevelCitations &&
        !delta.secondaryDocument.paragraphCitations.length &&
        !delta.sectionText.length ? (
          <p className="muted">No review document changes.</p>
        ) : null}
      </section>

      <Card title="Deterministic comparison provenance">
        <dl>
          <dt>Previous accepted version</dt>
          <dd>
            {result.from.ordinal} · accepted {result.from.acceptedAt.slice(0, 10)} ·{" "}
            <span className="mono">{result.from.id}</span>
          </dd>
          <dt>Current accepted version</dt>
          <dd>
            {result.to.ordinal} · accepted {result.to.acceptedAt.slice(0, 10)} ·{" "}
            <span className="mono">{result.to.id}</span>
          </dd>
          <dt>Previous packet SHA-256</dt>
          <dd className="mono">{result.from.packetHash}</dd>
          <dt>Current packet SHA-256</dt>
          <dd className="mono">{result.to.packetHash}</dd>
          <dt>Previous document SHA-256</dt>
          <dd className="mono">{result.from.documentHash}</dd>
          <dt>Current document SHA-256</dt>
          <dd className="mono">{result.to.documentHash}</dd>
          <dt>Canonical delta SHA-256</dt>
          <dd className="mono">{delta.checksum}</dd>
        </dl>
      </Card>
    </div>
  );
}
