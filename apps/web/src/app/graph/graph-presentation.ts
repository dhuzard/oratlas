import {
  type PublicGraphEdge,
  type PublicGraphNode,
  type PublicGraphQuery,
} from "@oratlas/contracts";

export function graphNodeVersionHref(node: PublicGraphNode): string {
  return `/nodes/${encodeURIComponent(node.id)}/versions/${encodeURIComponent(node.versionId)}`;
}

export function graphHref(
  query: PublicGraphQuery,
  changes: Partial<Record<keyof PublicGraphQuery, string | number | boolean | undefined>> = {},
): string {
  const params = new URLSearchParams();
  const merged = { ...query, ...changes };
  for (const key of [
    "seed",
    "q",
    "depth",
    "limit",
    "cursor",
    "kind",
    "relationType",
    "edgeStatus",
    "hasTrust",
  ] as const) {
    const value = merged[key];
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return `/graph?${params.toString()}`;
}

export function relationPresentation(edge: PublicGraphEdge) {
  return {
    statusLabel: edge.status === "confirmed" ? "Confirmed" : "Proposed",
    statusSymbol: edge.status === "confirmed" ? "●" : "◇",
    relationLabel: edge.relationType.replace(/-/g, " "),
    relationSymbol: edge.relationType === "contradicts" ? "⊣" : "→",
    className: [
      "graph-edge",
      `graph-edge-${edge.status}`,
      edge.relationType === "contradicts" ? "graph-edge-contradicts" : "graph-edge-supportive",
    ].join(" "),
  };
}
