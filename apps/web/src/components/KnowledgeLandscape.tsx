"use client";

import { useEffect, useRef, useState } from "react";
import type { KnowledgeRecommendationAnchor } from "@oratlas/contracts";
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

type VisualLane = "reviews" | "claims" | "objects";

const LANE_FOR_KIND: Record<LandscapeNodeKind, VisualLane> = {
  review: "reviews",
  claim: "claims",
  evidence: "objects",
  figure: "objects",
  dataset: "objects",
  code: "objects",
};

const LANE_X: Record<VisualLane, number> = {
  reviews: 120,
  claims: 450,
  objects: 790,
};

const VISUAL_LANE_LABEL: Record<VisualLane, string> = {
  reviews: "Preserved reviews",
  claims: "Claims",
  objects: "Evidence & research objects",
};

const LANE_LABEL: Record<LandscapeNodeKind, string> = {
  review: "Preserved reviews",
  claim: "Claims",
  evidence: "Linked evidence",
  figure: "Figures",
  dataset: "Datasets",
  code: "Code",
};

const DETAIL_KINDS: LandscapeNodeKind[] = [
  "review",
  "claim",
  "evidence",
  "figure",
  "dataset",
  "code",
];

export function KnowledgeLandscape({
  landscape,
  focus,
  overviewHref,
  focusHrefByNode,
  knownNodeIds,
  knownToggleHrefByNode,
  clearKnownHref,
  anchorsByLandscapeNodeId,
  labelByGraphNodeVersionId,
  focusedGraphNodeId,
}: {
  landscape: KnowledgeLandscapeData;
  focus: string;
  overviewHref: string;
  focusHrefByNode: Record<string, string>;
  knownNodeIds: string[];
  knownToggleHrefByNode: Record<string, string>;
  clearKnownHref: string;
  anchorsByLandscapeNodeId: Record<string, readonly KnowledgeRecommendationAnchor[]>;
  labelByGraphNodeVersionId: Record<string, string>;
  focusedGraphNodeId?: string;
}) {
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set());
  const visualRef = useRef<HTMLDivElement>(null);
  const focusedNode = focusedGraphNodeId
    ? landscape.nodes.find((node) => node.graphNodeId === focusedGraphNodeId)
    : landscape.focusedNodeId
      ? landscape.nodes.find((node) => node.id === landscape.focusedNodeId)
      : undefined;
  useEffect(() => {
    const onGroundingFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeIds?: unknown }>).detail;
      const nodeIds = Array.isArray(detail?.nodeIds)
        ? detail.nodeIds.filter((id): id is string => typeof id === "string")
        : [];
      setHighlightedNodeIds(new Set(nodeIds));
    };
    window.addEventListener("oratlas:grounding-focus", onGroundingFocus);
    return () => window.removeEventListener("oratlas:grounding-focus", onGroundingFocus);
  }, []);
  useEffect(() => {
    const visual = visualRef.current;
    if (!visual || !focusedNode || visual.scrollWidth <= visual.clientWidth) return;
    const focusX = LANE_X[LANE_FOR_KIND[focusedNode.kind]];
    visual.scrollLeft = (focusX / 920) * visual.scrollWidth - visual.clientWidth / 2;
  }, [focusedNode]);

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

  const orderedNodes = orderNodesForKnownSet(
    landscape.nodes,
    knownNodeIds,
    anchorsByLandscapeNodeId,
  );
  const anchoredNewcomerCount = orderedNodes.filter(
    (node) =>
      node.graphNodeId &&
      !knownNodeIds.includes(node.graphNodeId) &&
      (anchorsByLandscapeNodeId[node.id]?.length ?? 0) > 0,
  ).length;
  const { nodes, height } = positionNodes(orderedNodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <section className="knowledge-landscape" aria-label="Guided knowledge landscape">
      <div className="knowledge-landscape-heading">
        <div>
          <p className="home-eyebrow">Guided knowledge landscape</p>
          <h2 id="knowledge-landscape-title">
            {focusedNode
              ? `One step from “${focusedNode.label}”`
              : `A bounded path through “${focus}”`}
          </h2>
        </div>
        <div className="knowledge-landscape-summary">
          <p className="muted">
            {focusedNode ? (
              <>
                Showing the selected node and its direct connections.{" "}
                <a href={overviewHref}>Return to overview</a>.
              </>
            ) : (
              <>
                Showing {landscape.shownClaimCount} of {landscape.matchedClaimCount} matching claim
                {landscape.matchedClaimCount === 1 ? "" : "s"}. Select a focus link to see one step
                around a node. {landscape.graphNodeCount} stable graph node
                {landscape.graphNodeCount === 1 ? " is" : "s are"} available in this path.
              </>
            )}
          </p>
          <p className="landscape-ranking-note">
            Ordering helps exploration only. It is not a truth, quality, or trust score.
          </p>
          <p className="landscape-known-set">
            Your explicit known set contains {knownNodeIds.length} graph node
            {knownNodeIds.length === 1 ? "" : "s"}. It is held in this URL, not inferred or stored
            in the shared graph.
            {knownNodeIds.length > 0 ? (
              <>
                {" "}
                <a href={clearKnownHref}>Clear known set</a>.
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="landscape-grounding-status" aria-live="polite">
        {highlightedNodeIds.size > 0 ? (
          <>
            <span>
              Highlighting {highlightedNodeIds.size} exact graph item
              {highlightedNodeIds.size === 1 ? "" : "s"} used by the selected statement.
            </span>
            <button type="button" onClick={() => setHighlightedNodeIds(new Set())}>
              Clear highlight
            </button>
          </>
        ) : (
          <span>Select a grounded statement in Atlas Discuss to highlight its validated path.</span>
        )}
      </div>

      {landscape.graphNodeCount > 0 ? (
        <section className="landscape-start" aria-labelledby="landscape-start-title">
          <div>
            <p className="home-eyebrow">Start here</p>
            <h3 id="landscape-start-title">
              {knownNodeIds.length > 0
                ? anchoredNewcomerCount > 0
                  ? "New nodes connected to what you know"
                  : "No confirmed direct anchors in this path"
                : "Nodes worth exploring for this interest"}
            </h3>
            <p>
              {knownNodeIds.length > 0
                ? anchoredNewcomerCount > 0
                  ? "Anchored newcomers appear first; disconnected records remain visible and explicitly marked."
                  : "The selected path is still visible, but none of its newcomers has a confirmed direct edge to your known set."
                : "These records are connected through explicit identities and confirmed graph edges."}
            </p>
          </div>
          <ol>
            {orderedNodes
              .filter((node) => node.graphNodeId)
              .slice(0, 3)
              .map((node) => (
                <li key={node.id}>
                  <a href={focusHrefByNode[node.id] ?? node.href}>{node.label}</a>
                  <small>{node.reasons[0]}</small>
                </li>
              ))}
          </ol>
        </section>
      ) : (
        <p className="landscape-graph-empty">
          No matching claim has a readable graph identity yet. The preserved review, claim, and
          evidence path remains available without inferred links.
        </p>
      )}

      <div className="knowledge-landscape-visual" tabIndex={0} ref={visualRef}>
        <svg
          viewBox={`0 0 920 ${height}`}
          role="img"
          aria-label="Reviews connected to claims, evidence, and graph research objects"
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
          {(["reviews", "claims", "objects"] as const).map((lane) => (
            <text className="landscape-lane-label" x={LANE_X[lane]} y="22" key={lane}>
              {VISUAL_LANE_LABEL[lane]}
            </text>
          ))}
          {landscape.edges.map((edge, index) => (
            <LandscapeEdge
              edge={edge}
              source={nodeById.get(edge.sourceId)}
              target={nodeById.get(edge.targetId)}
              highlighted={
                highlightedNodeIds.has(edge.sourceId) && highlightedNodeIds.has(edge.targetId)
              }
              key={`${edge.sourceId}:${edge.targetId}:${index}`}
            />
          ))}
          {nodes.map((node) => (
            <LandscapeSvgNode
              node={node}
              href={focusHrefByNode[node.id] ?? node.href}
              highlighted={highlightedNodeIds.has(node.id)}
              dimmed={highlightedNodeIds.size > 0 && !highlightedNodeIds.has(node.id)}
              focused={node.id === focusedNode?.id}
              key={node.id}
            />
          ))}
        </svg>
      </div>

      <div className="landscape-legend" aria-label="Knowledge landscape legend">
        <span data-kind="review">Review</span>
        <span data-kind="claim">Claim</span>
        <span data-kind="evidence">Evidence</span>
        <span data-kind="figure">Figure</span>
        <span data-kind="dataset">Dataset</span>
        <span data-kind="code">Code</span>
        <span data-relation="supports">supports</span>
        <span data-relation="contradicts">contradicts</span>
        <span data-relation="confirmed">confirmed graph edge</span>
      </div>

      {landscape.timeline.length > 0 ? (
        <section className="landscape-timeline" aria-labelledby="landscape-timeline-title">
          <div>
            <h3 id="landscape-timeline-title">When these records entered the literature</h3>
            <p>Publication years connect earlier evidence with later preserved reviews.</p>
          </div>
          <ol>
            {landscape.timeline.map((entry) => (
              <li key={entry.year}>
                <strong>{entry.year}</strong>
                <span>{timelineParts(entry.reviewCount, entry.evidenceCount).join(" · ")}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <nav className="knowledge-landscape-list" aria-label="Knowledge landscape details">
        {DETAIL_KINDS.map((kind) => {
          const kindNodes = orderedNodes.filter((node) => node.kind === kind);
          if (kindNodes.length === 0) return null;
          return (
            <section aria-labelledby={`landscape-${kind}-title`} key={kind}>
              <h3 id={`landscape-${kind}-title`}>{LANE_LABEL[kind]}</h3>
              <ul>
                {kindNodes.map((node) => (
                  <LandscapeDetail
                    node={node}
                    highlightedNodeIds={highlightedNodeIds}
                    focused={
                      focusedGraphNodeId
                        ? node.graphNodeId === focusedGraphNodeId
                        : landscape.focusedNodeId === node.id
                    }
                    focusHref={focusHrefByNode[node.id]}
                    known={Boolean(node.graphNodeId && knownNodeIds.includes(node.graphNodeId))}
                    knownToggleHref={
                      node.graphNodeId ? knownToggleHrefByNode[node.graphNodeId] : undefined
                    }
                    anchors={anchorsByLandscapeNodeId[node.id] ?? []}
                    knownNodeIds={knownNodeIds}
                    labelByGraphNodeVersionId={labelByGraphNodeVersionId}
                    key={node.id}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </nav>
    </section>
  );
}

function LandscapeDetail({
  node,
  highlightedNodeIds,
  focused,
  focusHref,
  known,
  knownToggleHref,
  anchors,
  knownNodeIds,
  labelByGraphNodeVersionId,
}: {
  node: KnowledgeLandscapeNode;
  highlightedNodeIds: ReadonlySet<string>;
  focused: boolean;
  focusHref?: string;
  known: boolean;
  knownToggleHref?: string;
  anchors: readonly KnowledgeRecommendationAnchor[];
  knownNodeIds: readonly string[];
  labelByGraphNodeVersionId: Readonly<Record<string, string>>;
}) {
  const anchorCount = new Set(anchors.map((anchor) => anchor.knownNodeId)).size;
  const isDisconnectedNewcomer = Boolean(
    node.graphNodeId &&
    !knownNodeIds.includes(node.graphNodeId) &&
    knownNodeIds.length > 0 &&
    anchorCount === 0,
  );
  const className = [
    highlightedNodeIds.has(node.id)
      ? "landscape-detail-highlighted"
      : highlightedNodeIds.size > 0
        ? "landscape-detail-dimmed"
        : undefined,
    anchorCount > 0 ? "landscape-detail-anchored" : undefined,
    isDisconnectedNewcomer ? "landscape-detail-disconnected" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li className={className || undefined}>
      <a className="landscape-primary-link" href={node.href} title={node.label}>
        {node.label}
      </a>
      <small>{node.detail}</small>
      {anchorCount > 0 ? (
        <details className="landscape-anchors">
          <summary>
            Anchored to {anchorCount} known graph node{anchorCount === 1 ? "" : "s"}
          </summary>
          <ul>
            {anchors.map((anchor) => (
              <li key={`${anchor.edgeId}:${anchor.directionFromRecommendation}`}>
                {anchor.directionFromRecommendation === "outgoing" ? "Outgoing" : "Incoming"}{" "}
                <code>{anchor.relationType}</code> edge to{" "}
                <strong>
                  {labelByGraphNodeVersionId[anchor.knownNodeVersionId] ??
                    "a node in your known set"}
                </strong>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {isDisconnectedNewcomer ? (
        <small className="landscape-disconnected-note">
          No confirmed direct anchor to your known set.
        </small>
      ) : null}
      <details className="landscape-reasons">
        <summary>Why this?</summary>
        <ul>
          {node.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </details>
      <div className="landscape-detail-actions">
        {node.graphRecordHref && node.graphRecordHref !== node.href ? (
          <a className="landscape-record-link" href={node.graphRecordHref}>
            Inspect exact graph version
          </a>
        ) : null}
        {node.graphHref ? (
          <a className="landscape-graph-link" href={node.graphHref}>
            Explore graph neighborhood
          </a>
        ) : null}
        {knownToggleHref ? (
          <a className="landscape-known-link" href={knownToggleHref}>
            {known ? "Remove from known set" : "Mark as known"}
          </a>
        ) : null}
        {focused ? (
          <span className="landscape-focused-label" aria-current="true">
            Current focus
          </span>
        ) : focusHref ? (
          <a className="landscape-focus-link" href={focusHref}>
            Focus on connections
          </a>
        ) : null}
      </div>
    </li>
  );
}

function timelineParts(reviewCount: number, evidenceCount: number): string[] {
  const parts: string[] = [];
  if (evidenceCount > 0) {
    parts.push(`${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"}`);
  }
  if (reviewCount > 0) {
    parts.push(`${reviewCount} review${reviewCount === 1 ? "" : "s"}`);
  }
  return parts;
}

function LandscapeEdge({
  edge,
  source,
  target,
  highlighted,
}: {
  edge: KnowledgeLandscapeEdge;
  source?: PositionedNode;
  target?: PositionedNode;
  highlighted: boolean;
}) {
  if (!source || !target) return null;
  return (
    <g
      className={`landscape-edge landscape-edge-${edgeTone(edge.relationType)}${highlighted ? " landscape-edge-highlighted" : ""}`}
      data-status={edge.status}
    >
      <line
        x1={source.x}
        y1={source.y}
        x2={target.x}
        y2={target.y}
        markerEnd="url(#landscape-arrow)"
      />
      <title>{edgeAccessibleLabel(edge)}</title>
    </g>
  );
}

function LandscapeSvgNode({
  node,
  href,
  highlighted,
  dimmed,
  focused,
}: {
  node: PositionedNode;
  href: string;
  highlighted: boolean;
  dimmed: boolean;
  focused: boolean;
}) {
  const width = node.kind === "claim" ? 250 : 190;
  const lines = wrapLabel(node.label, node.kind === "claim" ? 34 : 24);
  return (
    <a href={href} aria-label={`${LANE_LABEL[node.kind]}: ${node.label}`}>
      <g
        className={`landscape-node${focused ? " landscape-node-focused" : ""}${highlighted ? " landscape-node-highlighted" : ""}${dimmed ? " landscape-node-dimmed" : ""}`}
        data-kind={node.kind}
        transform={`translate(${node.x}, ${node.y})`}
      >
        <title>{node.label}</title>
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

function orderNodesForKnownSet(
  nodes: readonly KnowledgeLandscapeNode[],
  knownNodeIds: readonly string[],
  anchorsByLandscapeNodeId: Readonly<Record<string, readonly KnowledgeRecommendationAnchor[]>>,
): KnowledgeLandscapeNode[] {
  if (knownNodeIds.length === 0) return [...nodes];
  const known = new Set(knownNodeIds);
  const priority = (node: KnowledgeLandscapeNode): number => {
    if (!node.graphNodeId) return 3;
    if ((anchorsByLandscapeNodeId[node.id]?.length ?? 0) > 0 && !known.has(node.graphNodeId)) {
      return 0;
    }
    if (known.has(node.graphNodeId)) return 1;
    return 2;
  };
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((left, right) => priority(left.node) - priority(right.node) || left.index - right.index)
    .map(({ node }) => node);
}

function positionNodes(nodes: KnowledgeLandscapeNode[]): {
  nodes: PositionedNode[];
  height: number;
} {
  const maxLaneCount = Math.max(
    1,
    ...(["reviews", "claims", "objects"] as const).map(
      (lane) => nodes.filter((node) => LANE_FOR_KIND[node.kind] === lane).length,
    ),
  );
  const height = Math.max(240, maxLaneCount * 78 + 70);
  const positioned = (["reviews", "claims", "objects"] as const).flatMap((lane) => {
    const laneNodes = nodes.filter((node) => LANE_FOR_KIND[node.kind] === lane);
    return laneNodes.map((node, index) => ({
      ...node,
      x: LANE_X[lane],
      y: 48 + ((index + 1) * (height - 72)) / (laneNodes.length + 1),
    }));
  });
  return { nodes: positioned, height };
}

function wrapLabel(value: string, width: number): string[] {
  let remaining = value.replace(/\s+/g, " ").trim();
  if (!remaining) return [];
  const lines: string[] = [];
  while (remaining && lines.length < 2) {
    if (remaining.length <= width) {
      lines.push(remaining);
      remaining = "";
      break;
    }
    const preferredBreak = remaining.lastIndexOf(" ", width);
    const breakAt = preferredBreak >= Math.floor(width * 0.55) ? preferredBreak : width;
    lines.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]!.replace(/[.,;:]$/, "")}…`;
  }
  return lines;
}

function edgeTone(relationType: string): "support" | "contradict" | "neutral" {
  if (relationType === "supports" || relationType === "partially-supports") return "support";
  if (relationType === "contradicts") return "contradict";
  return "neutral";
}

function edgeAccessibleLabel(edge: KnowledgeLandscapeEdge): string {
  return [
    edge.label,
    edge.status === "confirmed" ? "confirmed graph edge" : undefined,
    edge.assessmentCount
      ? `${edge.assessmentCount} independent assessment${edge.assessmentCount === 1 ? "" : "s"}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
