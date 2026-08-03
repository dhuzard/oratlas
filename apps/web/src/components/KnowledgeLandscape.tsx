import type {
  KnowledgeLandscapeData,
  KnowledgeLandscapeEdge,
  KnowledgeLandscapeNode,
  LandscapeNodeKind,
} from "@/lib/knowledge-landscape";

interface PositionedNode extends KnowledgeLandscapeNode {
  x: number;
  y: number;
}

const LANE_X: Record<LandscapeNodeKind, number> = {
  review: 120,
  claim: 450,
  evidence: 790,
};

const LANE_LABEL: Record<LandscapeNodeKind, string> = {
  review: "Preserved reviews",
  claim: "Claims",
  evidence: "Linked evidence",
};

export function KnowledgeLandscape({
  landscape,
  focus,
}: {
  landscape: KnowledgeLandscapeData;
  focus: string;
}) {
  if (landscape.nodes.length === 0) {
    return (
      <section className="knowledge-landscape-empty" aria-label="Guided knowledge landscape">
        <p className="home-eyebrow">Guided knowledge landscape</p>
        <h2 id="knowledge-landscape-title">No connected claims match this focus yet</h2>
        <p>
          Remove an interest or broaden the search. ORAtlas will not fill an empty view with
          unrelated records.
        </p>
      </section>
    );
  }

  const { nodes, height } = positionNodes(landscape.nodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <section className="knowledge-landscape" aria-label="Guided knowledge landscape">
      <div className="knowledge-landscape-heading">
        <div>
          <p className="home-eyebrow">Guided knowledge landscape</p>
          <h2 id="knowledge-landscape-title">A bounded path through “{focus}”</h2>
        </div>
        <p className="muted">
          Showing {landscape.shownClaimCount} of {landscape.matchedClaimCount} matching claim
          {landscape.matchedClaimCount === 1 ? "" : "s"}. Select any node to inspect its preserved
          record.
        </p>
      </div>

      <div className="knowledge-landscape-visual" tabIndex={0}>
        <svg
          viewBox={`0 0 920 ${height}`}
          role="img"
          aria-label="Reviews connected to claims and their linked evidence"
        >
          <defs>
            <marker
              id="landscape-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          {(["review", "claim", "evidence"] as const).map((kind) => (
            <text className="landscape-lane-label" x={LANE_X[kind]} y="22" key={kind}>
              {LANE_LABEL[kind]}
            </text>
          ))}
          {landscape.edges.map((edge, index) => (
            <LandscapeEdge
              edge={edge}
              source={nodeById.get(edge.sourceId)}
              target={nodeById.get(edge.targetId)}
              key={`${edge.sourceId}:${edge.targetId}:${index}`}
            />
          ))}
          {nodes.map((node) => (
            <LandscapeSvgNode node={node} key={node.id} />
          ))}
        </svg>
      </div>

      <div className="landscape-legend" aria-label="Knowledge landscape legend">
        <span data-kind="review">Review</span>
        <span data-kind="claim">Claim</span>
        <span data-kind="evidence">Evidence</span>
        <span data-relation="supports">supports</span>
        <span data-relation="contradicts">contradicts</span>
      </div>

      <nav className="knowledge-landscape-list" aria-label="Knowledge landscape details">
        {(["review", "claim", "evidence"] as const).map((kind) => {
          const kindNodes = landscape.nodes.filter((node) => node.kind === kind);
          if (kindNodes.length === 0) return null;
          return (
            <section aria-labelledby={`landscape-${kind}-title`} key={kind}>
              <h3 id={`landscape-${kind}-title`}>{LANE_LABEL[kind]}</h3>
              <ul>
                {kindNodes.map((node) => (
                  <li key={node.id}>
                    <a href={node.href}>{node.label}</a>
                    <small>{node.detail}</small>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </nav>
    </section>
  );
}

function LandscapeEdge({
  edge,
  source,
  target,
}: {
  edge: KnowledgeLandscapeEdge;
  source?: PositionedNode;
  target?: PositionedNode;
}) {
  if (!source || !target) return null;
  return (
    <g className={`landscape-edge landscape-edge-${edgeTone(edge.relationType)}`}>
      <line
        x1={source.x}
        y1={source.y}
        x2={target.x}
        y2={target.y}
        markerEnd="url(#landscape-arrow)"
      />
      <title>{edge.label}</title>
    </g>
  );
}

function LandscapeSvgNode({ node }: { node: PositionedNode }) {
  const width = node.kind === "claim" ? 250 : 190;
  const lines = wrapLabel(node.label, node.kind === "claim" ? 34 : 24);
  return (
    <a href={node.href} aria-label={`${LANE_LABEL[node.kind]}: ${node.label}`}>
      <g
        className="landscape-node"
        data-kind={node.kind}
        transform={`translate(${node.x}, ${node.y})`}
      >
        <rect x={-width / 2} y="-28" width={width} height="56" rx="7" />
        <text textAnchor="middle">
          {lines.map((line, index) => (
            <tspan x="0" dy={index === 0 ? (lines.length === 1 ? 4 : -4) : 15} key={line}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    </a>
  );
}

function positionNodes(nodes: KnowledgeLandscapeNode[]): {
  nodes: PositionedNode[];
  height: number;
} {
  const maxLaneCount = Math.max(
    1,
    ...(["review", "claim", "evidence"] as const).map(
      (kind) => nodes.filter((node) => node.kind === kind).length,
    ),
  );
  const height = Math.max(320, maxLaneCount * 78 + 70);
  const positioned = (["review", "claim", "evidence"] as const).flatMap((kind) => {
    const laneNodes = nodes.filter((node) => node.kind === kind);
    return laneNodes.map((node, index) => ({
      ...node,
      x: LANE_X[kind],
      y: 48 + ((index + 1) * (height - 72)) / (laneNodes.length + 1),
    }));
  });
  return { nodes: positioned, height };
}

function wrapLabel(value: string, width: number): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
    if (lines.length === 2) break;
  }
  if (current && lines.length < 2) lines.push(current);
  if (words.join(" ").length > lines.join(" ").length && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]!.replace(/[.,;:]$/, "")}…`;
  }
  return lines;
}

function edgeTone(relationType: string): "support" | "contradict" | "neutral" {
  if (relationType === "supports" || relationType === "partially-supports") return "support";
  if (relationType === "contradicts") return "contradict";
  return "neutral";
}
