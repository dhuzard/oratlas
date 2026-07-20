import Link from "next/link";
import { Badge, Card, EmptyState, Notice } from "@oratlas/ui";
import {
  KNOWLEDGE_NODE_KINDS,
  NODE_RELATION_TYPES,
  type PublicGraphNode,
  type PublicGraphQuery,
  type PublicGraphResponse,
} from "@oratlas/contracts";
import { graphHref, graphNodeVersionHref, relationPresentation } from "./graph-presentation";
import { TrustVerificationBadge } from "@/components/TrustVerificationBadge";

export function GraphLanding() {
  return (
    <div className="grid grid-2">
      <Card title="Explore from a node">
        <form action="/graph" method="get">
          <div className="field">
            <label htmlFor="graph-seed">Stable node ID</label>
            <input id="graph-seed" name="seed" required maxLength={200} />
            <small>Node pages provide this automatically through “Explore its graph”.</small>
          </div>
          <GraphDefaults />
          <button className="btn" type="submit">
            Explore neighborhood
          </button>
        </form>
      </Card>
      <Card title="Find a topic">
        <form action="/graph" method="get">
          <div className="field">
            <label htmlFor="graph-topic">Topic words</label>
            <input id="graph-topic" name="q" type="search" required maxLength={500} />
            <small>
              Matches public node titles and abstracts, then explores their neighborhood.
            </small>
          </div>
          <GraphDefaults />
          <button className="btn" type="submit">
            Explore topic
          </button>
        </form>
      </Card>
    </div>
  );
}

function GraphDefaults() {
  return (
    <>
      <input type="hidden" name="depth" value="1" />
      <input type="hidden" name="limit" value="10" />
      <input type="hidden" name="edgeStatus" value="confirmed" />
    </>
  );
}

export function GraphError({ message }: { message: string }) {
  return (
    <Notice tone="error" title="The graph could not be loaded">
      <p>{message}</p>
      <p>
        <Link href="/graph">Start a new graph query</Link>.
      </p>
    </Notice>
  );
}

export function GraphExplorer({
  result,
  query,
}: {
  result: PublicGraphResponse;
  query: PublicGraphQuery;
}) {
  const nodes = new Map(result.nodes.map((node) => [node.versionId, node]));
  return (
    <>
      <GraphFilters query={query} />
      <div className="graph-legend" aria-label="Graph relation legend">
        <span>
          <span aria-hidden="true">● ━</span> Confirmed relation
        </span>
        <span>
          <span aria-hidden="true">◇ ┄</span> Proposed relation
        </span>
        <span>
          <span aria-hidden="true">→</span> Supports or other directed relation
        </span>
        <span>
          <span aria-hidden="true">⊣</span> Contradicts
        </span>
      </div>
      <p className="muted" aria-live="polite">
        Showing {result.edges.length} relation{result.edges.length === 1 ? "" : "s"} between{" "}
        {result.nodes.length} exact node version{result.nodes.length === 1 ? "" : "s"}. Relations
        are assertions, not proof of scientific correctness.
      </p>

      {result.edges.length === 0 ? (
        <EmptyState>
          No public relations match this query. Change a filter or explore another node.
        </EmptyState>
      ) : (
        <ol className="graph-edge-list" aria-label="Authoritative graph relations">
          {result.edges.map((edge) => {
            const source = nodes.get(edge.sourceVersionId);
            const target = nodes.get(edge.targetVersionId);
            if (!source || !target) return null;
            const presentation = relationPresentation(edge);
            const trustAssessments =
              edge.status === "confirmed"
                ? (edge.trustAssessments ?? (edge.trust ? [edge.trust] : []))
                : [];
            return (
              <li className={presentation.className} key={edge.id}>
                <div className="graph-edge-heading">
                  <span className="graph-status-symbol" aria-hidden="true">
                    {presentation.statusSymbol}
                  </span>
                  <strong>{presentation.statusLabel}</strong>
                  <Badge tone={edge.relationType === "contradicts" ? "warning" : "neutral"}>
                    <span aria-hidden="true">{presentation.relationSymbol} </span>
                    {presentation.relationLabel}
                  </Badge>
                </div>
                <div className="graph-edge-endpoints">
                  <GraphNodeLink node={source} label="Source" query={query} />
                  <span className="graph-direction" aria-hidden="true">
                    {presentation.relationSymbol}
                  </span>
                  <GraphNodeLink node={target} label="Target" query={query} />
                </div>
                {edge.rationale ? <p className="node-preserved-text">{edge.rationale}</p> : null}
                <p className="muted graph-edge-meta">
                  {edge.status === "confirmed"
                    ? `Confirmed by an editor · ${edge.confirmedAt.slice(0, 10)}`
                    : `${edge.provenance.replace(/-/g, " ")} · proposed ${edge.proposedAt.slice(0, 10)}`}
                  {trustAssessments.length > 0
                    ? ` · relation TRUST: ${trustAssessments.length} assessment${trustAssessments.length === 1 ? "" : "s"} (${trustAssessments.map((assessment) => `${assessment.assessorId ?? assessment.assessorType ?? "not supplied (legacy)"}, ${assessment.protocolVersion}`).join("; ")})`
                    : ""}
                </p>
                {trustAssessments.map((assessment) => (
                  <div className="btn-row" key={assessment.assessmentId}>
                    <span className="muted">Relation TRUST:</span>
                    <TrustVerificationBadge state={assessment.verificationState} />
                    <span className="mono muted">protocol {assessment.protocolVersion}</span>
                  </div>
                ))}
              </li>
            );
          })}
        </ol>
      )}

      <nav className="btn-row graph-pagination" aria-label="Graph result pages">
        {query.cursor ? (
          <Link className="btn btn-secondary" href={graphHref(query, { cursor: undefined })}>
            First page
          </Link>
        ) : null}
        {result.page.nextCursor ? (
          <Link
            className="btn btn-secondary"
            rel="next"
            href={graphHref(query, { cursor: result.page.nextCursor })}
          >
            Next page
          </Link>
        ) : null}
      </nav>

      <Card title={`Nodes in this page (${result.nodes.length})`}>
        <ul className="graph-node-list">
          {result.nodes.map((node) => (
            <li key={node.versionId}>
              <GraphNodeLink node={node} query={query} />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function GraphNodeLink({
  node,
  label,
  query,
}: {
  node: PublicGraphNode;
  label?: string;
  query: PublicGraphQuery;
}) {
  return (
    <div className="graph-node">
      {label ? <span className="muted graph-node-label">{label}</span> : null}
      <Link href={graphNodeVersionHref(node)}>{node.title}</Link>
      <span className="badge">{node.kind}</span>
      <span className="mono muted">version {node.versionId}</span>
      <Link
        className="graph-reseed"
        href={graphHref(query, { seed: node.id, q: undefined, cursor: undefined })}
      >
        Explore from this node
      </Link>
      {node.identifiers.map((identifier) => (
        <span className="muted" key={`${identifier.role}:${identifier.value}`}>
          {identifier.role.replace(/-/g, " ")}: {identifier.value}
          {identifier.isExample ? " · example — not linked" : ""}
        </span>
      ))}
    </div>
  );
}

function GraphFilters({ query }: { query: PublicGraphQuery }) {
  return (
    <Card title="Graph filters">
      <form className="filters graph-filters" action="/graph" method="get">
        {query.seed ? <input type="hidden" name="seed" value={query.seed} /> : null}
        {query.q ? <input type="hidden" name="q" value={query.q} /> : null}
        <div className="field">
          <label htmlFor="graph-kind">Node kind</label>
          <select id="graph-kind" name="kind" defaultValue={query.kind ?? ""}>
            <option value="">Any kind</option>
            {KNOWLEDGE_NODE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="graph-relation">Relation</label>
          <select id="graph-relation" name="relationType" defaultValue={query.relationType ?? ""}>
            <option value="">Any relation</option>
            {NODE_RELATION_TYPES.map((relation) => (
              <option key={relation} value={relation}>
                {relation.replace(/-/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="graph-status">Publication status</label>
          <select id="graph-status" name="edgeStatus" defaultValue={query.edgeStatus}>
            <option value="confirmed">Confirmed</option>
            <option value="proposed">Proposed</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="graph-depth">Depth</label>
          <select id="graph-depth" name="depth" defaultValue={String(query.depth)}>
            {[0, 1, 2, 3].map((depth) => (
              <option key={depth} value={depth}>
                {depth}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="graph-limit">Relations per page</label>
          <input
            id="graph-limit"
            name="limit"
            type="number"
            min="1"
            max="50"
            defaultValue={query.limit}
          />
        </div>
        <div className="field">
          <label htmlFor="graph-trust">Relation TRUST</label>
          <select
            id="graph-trust"
            name="hasTrust"
            defaultValue={query.hasTrust === undefined ? "" : String(query.hasTrust)}
            disabled={query.edgeStatus === "proposed"}
          >
            <option value="">Any</option>
            <option value="true">Has TRUST</option>
            <option value="false">No TRUST</option>
          </select>
        </div>
        <button className="btn" type="submit">
          Apply filters
        </button>
      </form>
    </Card>
  );
}
