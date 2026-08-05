"use client";

import { useEffect, useState } from "react";
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
}: {
  landscape: KnowledgeLandscapeData;
  focus: string;
  overviewHref: string;
  focusHrefByNode: Record<string, string>;
}) {
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set());
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
  const focusedNode = landscape.focusedNodeId
    ? landscape.nodes.find((node) => node.id === landscape.focusedNodeId)
    : undefined;

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
            <h3 id="landscape-start-title">Nodes worth exploring for this interest</h3>
            <p>
              These records are connected through explicit identities and confirmed graph edges.
            </p>
          </div>
          <ol>
            {landscape.nodes
              .filter((node) => node.graphNodeId)
              .slice(0, 3)
              .map((node) => (
                <li key={node.id}>
                  <a href={node.href}>{node.label}</a>
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

      <div className="knowledge-landscape-visual" tabIndex={0}>
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
              highlighted={highlightedNodeIds.has(node.id)}
              dimmed={highlightedNodeIds.size > 0 && !highlightedNodeIds.has(node.id)}
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
          const kindNodes = landscape.nodes.filter((node) => node.kind === kind);
          if (kindNodes.length === 0) return null;
          return (
            <section aria-labelledby={`landscape-${kind}-title`} key={kind}>
              <h3 id={`landscape-${kind}-title`}>{LANE_LABEL[kind]}</h3>
              <ul>
                {kindNodes.map((node) => (
                  <li
                    className={
                      highlightedNodeIds.has(node.id)
                        ? "landscape-detail-highlighted"
                        : highlightedNodeIds.size > 0
                          ? "landscape-detail-dimmed"
                          : undefined
                    }
                    key={node.id}
                  >
                    <a href={node.href}>{node.label}</a>
                    <small>{node.detail}</small>
                    <details className="landscape-reasons">
                      <summary>Why this?</summary>
                      <ul>
                        {node.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </details>
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
                    {landscape.focusedNodeId === node.id ? (
                      <span className="landscape-focused-label" aria-current="true">
                        Current focus
                      </span>
                    ) : (
                      <a className="landscape-focus-link" href={focusHrefByNode[node.id]}>
                        Focus on connections
                      </a>
                    )}
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
  highlighted,
  dimmed,
}: {
  node: PositionedNode;
  highlighted: boolean;
  dimmed: boolean;
}) {
  const width = node.kind === "claim" ? 250 : 190;
  const lines = wrapLabel(node.label, node.kind === "claim" ? 34 : 24);
  return (
    <a href={node.href} aria-label={`${LANE_LABEL[node.kind]}: ${node.label}`}>
      <g
        className={`landscape-node${highlighted ? " landscape-node-highlighted" : ""}${dimmed ? " landscape-node-dimmed" : ""}`}
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
    ...(["reviews", "claims", "objects"] as const).map(
      (lane) => nodes.filter((node) => LANE_FOR_KIND[node.kind] === lane).length,
    ),
  );
  const height = Math.max(320, maxLaneCount * 78 + 70);
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
