import {
  KNOWLEDGE_LANDSCAPE_ALGORITHM_VERSION,
  KNOWLEDGE_LANDSCAPE_SCHEMA_VERSION,
  canonicalGraphResponseSchema,
  knowledgeLandscapeQuerySchema,
  knowledgeLandscapeResponseSchema,
  type CanonicalGraphEdge,
  type CanonicalGraphNodeVersion,
  type CanonicalGraphResponse,
  type ExplorationInterest,
  type KnowledgeLandscapeData,
  type KnowledgeLandscapeEdge,
  type KnowledgeLandscapeNode,
  type KnowledgeLandscapeQuery,
  type KnowledgeLandscapeResponse,
} from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";
import { canonicalNodeDisplayLabel } from "./canonical-node-label";
import { prisma } from "./db";
import { readableCanonicalNodeVersionWhere } from "./public-snapshot-visibility";

const MAX_GRAPH_SEEDS = 3;
const MAX_GRAPH_NODES = 12;
const MAX_GRAPH_EDGES = 100;
const MAX_HUMAN_CLAIMS = 6;

export interface GraphNativeRecommendation {
  nodeId: string;
  nodeVersionId: string;
  reasons: string[];
}

export interface GraphNativeLandscapeSelection {
  nodes: CanonicalGraphNodeVersion[];
  edges: CanonicalGraphEdge[];
  recommendations: GraphNativeRecommendation[];
  matchedClaimCount: number;
  seedNodeIds: string[];
}

export function canonicalLandscapeNodeId(nodeId: string, nodeVersionId: string): string {
  return `graph:${nodeId}:${nodeVersionId}`;
}

export function canonicalOccurrenceHref(nodeId: string, nodeVersionId: string): string {
  return `/graph/occurrences/${encodeURIComponent(nodeId)}/versions/${encodeURIComponent(nodeVersionId)}`;
}

export type CanonicalLandscapeGraphProvider = (
  seedNodeId: string,
  seedNodeVersionId?: string,
) => Promise<CanonicalGraphResponse | undefined>;

export interface CanonicalGraphEntryReference {
  nodeId: string;
  nodeVersionId: string;
}

export type CanonicalGraphEntryProvider = (
  query: KnowledgeLandscapeQuery,
) => Promise<CanonicalGraphEntryReference[]>;

export interface KnowledgeLandscapeServiceOptions {
  graphProvider?: CanonicalLandscapeGraphProvider;
  entryProvider?: CanonicalGraphEntryProvider;
}

/** Reader-neutral selection over canonical graph records. */
export async function selectGraphNativeLandscape(
  input: KnowledgeLandscapeQuery,
  options: KnowledgeLandscapeServiceOptions = {},
): Promise<GraphNativeLandscapeSelection> {
  const query = knowledgeLandscapeQuerySchema.parse(input);
  const entryProvider = options.entryProvider ?? databaseCanonicalEntryProvider;
  const candidates = query.focusNodeId ? [] : await entryProvider(query);
  const graphProvider = options.graphProvider ?? databaseCanonicalGraphProvider;
  const requestedSeeds = (
    query.focusNodeId ? [{ nodeId: query.focusNodeId, nodeVersionId: undefined }] : candidates
  ).filter(
    (value, index, values) =>
      values.findIndex(
        (candidate) =>
          candidate.nodeId === value.nodeId && candidate.nodeVersionId === value.nodeVersionId,
      ) === index,
  );
  const loaded = await Promise.all(
    requestedSeeds.map(async ({ nodeId, nodeVersionId }) => ({
      seedNodeId: nodeId,
      response: await graphProvider(nodeId, nodeVersionId),
    })),
  );
  const eligible = loaded.filter(
    (entry): entry is typeof entry & { response: CanonicalGraphResponse } => {
      if (!entry.response) return false;
      if (entry.seedNodeId === query.focusNodeId) return true;
      return responseMatchesFilters(entry.response, query);
    },
  );
  const selected = eligible.slice(0, MAX_GRAPH_SEEDS);
  const nodeByVersion = new Map<string, CanonicalGraphNodeVersion>();
  const edgeById = new Map<string, CanonicalGraphEdge>();
  const reasonsByVersion = new Map<string, string[]>();

  for (const { response } of selected) {
    const seed = response.nodes.find((node) => node.nodeVersionId === response.seed.nodeVersionId);
    if (!seed) continue;
    addNode(nodeByVersion, seed);
    addReasons(
      reasonsByVersion,
      seed.nodeVersionId,
      entryReasons(
        response,
        query.interests,
        Boolean(query.q) && !query.focusNodeId,
        Boolean(query.focusNodeId),
      ),
    );
    for (const edge of response.edges) {
      const source = response.nodes.find((node) => node.nodeVersionId === edge.sourceNodeVersionId);
      const target = response.nodes.find((node) => node.nodeVersionId === edge.targetNodeVersionId);
      if (!source || !target) continue;
      if (!nodeByVersion.has(source.nodeVersionId) && nodeByVersion.size >= MAX_GRAPH_NODES)
        continue;
      addNode(nodeByVersion, source);
      if (!nodeByVersion.has(target.nodeVersionId) && nodeByVersion.size >= MAX_GRAPH_NODES)
        continue;
      addNode(nodeByVersion, target);
      edgeById.set(edge.id, edge);
      addReasons(
        reasonsByVersion,
        source.nodeVersionId,
        endpointReasons(source, edge, query.interests),
      );
      addReasons(
        reasonsByVersion,
        target.nodeVersionId,
        endpointReasons(target, edge, query.interests),
      );
    }
  }

  const nodes = [...nodeByVersion.values()].slice(0, MAX_GRAPH_NODES);
  const versionIds = new Set(nodes.map((node) => node.nodeVersionId));
  const edges = [...edgeById.values()]
    .filter(
      (edge) =>
        versionIds.has(edge.sourceNodeVersionId) && versionIds.has(edge.targetNodeVersionId),
    )
    .slice(0, MAX_GRAPH_EDGES);
  const recommendations = nodes.map((node) => ({
    nodeId: node.nodeId,
    nodeVersionId: node.nodeVersionId,
    reasons: reasonsByVersion.get(node.nodeVersionId) ?? ["Connected by a canonical graph edge"],
  }));
  return {
    nodes,
    edges,
    recommendations,
    matchedClaimCount: query.focusNodeId
      ? nodes.some((node) => node.kind === "claim")
        ? 1
        : 0
      : eligible.length,
    seedNodeIds: selected.map(({ seedNodeId }) => seedNodeId),
  };
}

export async function createKnowledgeLandscapeResponse(
  input: KnowledgeLandscapeQuery,
  options: KnowledgeLandscapeServiceOptions = {},
): Promise<KnowledgeLandscapeResponse> {
  const query = knowledgeLandscapeQuerySchema.parse(input);
  const selection = await selectGraphNativeLandscape(query, options);
  const landscape = renderLandscape(selection, query.focusNodeId);
  return knowledgeLandscapeResponseSchema.parse({
    schemaVersion: KNOWLEDGE_LANDSCAPE_SCHEMA_VERSION,
    algorithm: {
      id: "explicit-interest-graph-landscape",
      version: KNOWLEDGE_LANDSCAPE_ALGORITHM_VERSION,
      purpose: "navigation",
      limitations: [
        "not-a-truth-score",
        "not-a-quality-score",
        "canonical-source-assertion-and-confirmed-edges",
        "bounded-to-three-entry-neighborhoods-and-twelve-exact-versions",
      ],
    },
    query,
    landscape,
  });
}

function renderLandscape(
  selection: GraphNativeLandscapeSelection,
  focusedStableNodeId?: string,
): KnowledgeLandscapeData {
  const reasonByVersion = new Map(
    selection.recommendations.map((recommendation) => [
      recommendation.nodeVersionId,
      recommendation.reasons,
    ]),
  );
  const visibleCanonicalNodes = selectHumanVisibleNodes(
    selection.nodes,
    selection.edges,
    focusedStableNodeId,
  );
  const nodes = visibleCanonicalNodes.map((node) =>
    renderNode(node, reasonByVersion.get(node.nodeVersionId)),
  );
  const idByVersion = new Map(
    visibleCanonicalNodes.map((node, index) => [node.nodeVersionId, nodes[index]!.id]),
  );
  const edges: KnowledgeLandscapeEdge[] = selection.edges.flatMap((edge) => {
    const sourceId = idByVersion.get(edge.sourceNodeVersionId);
    const targetId = idByVersion.get(edge.targetNodeVersionId);
    if (!sourceId || !targetId) return [];
    return [
      {
        graphEdgeId: edge.id,
        sourceId,
        targetId,
        label: edge.relationType.replaceAll("-", " "),
        relationType: edge.relationType,
        ...(edge.status === "confirmed" ? { status: "confirmed" as const } : {}),
        assessmentCount: edge.trustAssessments.length,
      },
    ];
  });
  const focusedNode = focusedStableNodeId
    ? nodes.find((node) => node.graphNodeId === focusedStableNodeId)
    : undefined;
  return {
    nodes,
    edges,
    matchedClaimCount: selection.matchedClaimCount,
    shownClaimCount: nodes.filter((node) => node.kind === "claim").length,
    graphSeedCount: selection.seedNodeIds.length,
    graphNodeCount: new Set(nodes.map((node) => node.graphNodeId)).size,
    timeline: [],
    ...(focusedNode ? { focusedNodeId: focusedNode.id } : {}),
  };
}

function renderNode(node: CanonicalGraphNodeVersion, reasons?: string[]): KnowledgeLandscapeNode {
  const kind = node.kind === "work" ? "evidence" : node.kind;
  const label = canonicalNodeDisplayLabel(node);
  const href = canonicalOccurrenceHref(node.nodeId, node.nodeVersionId);
  return {
    id: canonicalLandscapeNodeId(node.nodeId, node.nodeVersionId),
    kind,
    label,
    detail: `${node.kind === "work" ? "Evidence" : titleCase(node.kind)} · exact canonical version`,
    href,
    reasons: reasons?.length ? reasons : ["Connected by a canonical graph edge"],
    graphNodeId: node.nodeId,
    graphNodeVersionId: node.nodeVersionId,
    graphHref: `/graph?seed=${encodeURIComponent(node.nodeId)}`,
    graphRecordHref: href,
  };
}

function selectHumanVisibleNodes(
  nodes: readonly CanonicalGraphNodeVersion[],
  edges: readonly CanonicalGraphEdge[],
  focusedStableNodeId?: string,
): CanonicalGraphNodeVersion[] {
  const claims = nodes.filter((node) => node.kind === "claim");
  if (claims.length <= MAX_HUMAN_CLAIMS) return [...nodes];

  const focusedClaim = focusedStableNodeId
    ? claims.find((node) => node.nodeId === focusedStableNodeId)
    : undefined;
  const visibleClaims = [
    ...(focusedClaim ? [focusedClaim] : []),
    ...claims.filter((node) => node.nodeVersionId !== focusedClaim?.nodeVersionId),
  ].slice(0, MAX_HUMAN_CLAIMS);
  const visibleClaimVersions = new Set(visibleClaims.map((node) => node.nodeVersionId));
  const focusedVersion = focusedStableNodeId
    ? nodes.find((node) => node.nodeId === focusedStableNodeId)?.nodeVersionId
    : undefined;
  const connectedNonClaimVersions = new Set<string>();
  for (const edge of edges) {
    const sourceIsEntry =
      visibleClaimVersions.has(edge.sourceNodeVersionId) ||
      edge.sourceNodeVersionId === focusedVersion;
    const targetIsEntry =
      visibleClaimVersions.has(edge.targetNodeVersionId) ||
      edge.targetNodeVersionId === focusedVersion;
    if (sourceIsEntry) connectedNonClaimVersions.add(edge.targetNodeVersionId);
    if (targetIsEntry) connectedNonClaimVersions.add(edge.sourceNodeVersionId);
  }
  return nodes.filter((node) => {
    if (node.kind === "claim") return visibleClaimVersions.has(node.nodeVersionId);
    return (
      node.nodeVersionId === focusedVersion || connectedNonClaimVersions.has(node.nodeVersionId)
    );
  });
}

function entryReasons(
  response: CanonicalGraphResponse,
  interests: ExplorationInterest[],
  hasQuery: boolean,
  isExplicitFocus: boolean,
): string[] {
  const reasons = [
    ...(isExplicitFocus ? ["Selected as the explicit canonical graph focus"] : []),
    ...(hasQuery ? ["Matches the declared search entry point"] : []),
    ...graphInterestReasons(response, interests),
  ];
  if (reasons.length === 0) reasons.push("Selected from the declared canonical graph entry point");
  return reasons.length ? reasons : ["Selected from the canonical graph entry points"];
}

function graphInterestReasons(
  response: CanonicalGraphResponse,
  interests: ExplorationInterest[],
): string[] {
  const reasons: string[] = [];
  const relations = new Set(response.edges.map((edge) => edge.relationType));
  const searchable = response.nodes
    .map((node) => `${node.title ?? ""} ${node.abstract ?? ""} ${node.text ?? ""}`)
    .join(" ");
  if (
    interests.includes("data-code") &&
    (response.nodes.some((node) => node.kind === "dataset" || node.kind === "code") ||
      relations.has("uses-dataset") ||
      relations.has("uses-code"))
  )
    reasons.push("Its canonical graph neighborhood matches your data & code interest");
  if (interests.includes("disagreements") && relations.has("contradicts"))
    reasons.push("Its canonical graph neighborhood contains a contradicts relation");
  if (
    interests.includes("reproducibility") &&
    (relations.has("replicates") || /replicat|reproduc|robust|convergen/i.test(searchable))
  )
    reasons.push("Its canonical graph neighborhood matches your reproducibility interest");
  if (
    interests.includes("methods-models") &&
    (relations.has("uses-code") ||
      relations.has("uses-dataset") ||
      /method|model|protocol|algorithm|pipeline|population|cohort|design/i.test(searchable))
  )
    reasons.push("Its canonical graph neighborhood matches your methods & models interest");
  if (
    interests.includes("assessed-evidence") &&
    response.edges.some((edge) => edge.trustAssessments.length > 0)
  )
    reasons.push("Its canonical graph neighborhood contains assessed evidence");
  return reasons;
}

function responseMatchesFilters(
  response: CanonicalGraphResponse,
  query: KnowledgeLandscapeQuery,
): boolean {
  if (query.interests.length > 0 && graphInterestReasons(response, query.interests).length === 0)
    return false;
  if (
    query.relationType &&
    !response.edges.some((edge) => edge.relationType === query.relationType)
  )
    return false;
  if (
    query.trustCriterion &&
    !response.edges.some((edge) =>
      edge.trustAssessments.some((assessment) =>
        assessment.assessedCriteria?.includes(
          query.trustCriterion as NonNullable<typeof assessment.assessedCriteria>[number],
        ),
      ),
    )
  )
    return false;
  return true;
}

function endpointReasons(
  node: CanonicalGraphNodeVersion,
  edge: CanonicalGraphEdge,
  interests: ExplorationInterest[],
): string[] {
  const reasons = [
    `Connected by a ${edge.status === "confirmed" ? "confirmed" : "source-asserted"} ${edge.relationType.replaceAll("-", " ")} relation`,
  ];
  if (interests.includes("data-code") && (node.kind === "dataset" || node.kind === "code"))
    reasons.push(`Matches your data & code interest as a ${node.kind} node`);
  if (interests.includes("assessed-evidence") && edge.trustAssessments.length > 0)
    reasons.push("The connecting relation has a public assessment");
  return reasons;
}

function addNode(
  nodes: Map<string, CanonicalGraphNodeVersion>,
  node: CanonicalGraphNodeVersion,
): void {
  if (!nodes.has(node.nodeVersionId) && nodes.size < MAX_GRAPH_NODES)
    nodes.set(node.nodeVersionId, node);
}

function addReasons(target: Map<string, string[]>, versionId: string, values: string[]): void {
  target.set(versionId, [...new Set([...(target.get(versionId) ?? []), ...values])]);
}

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

async function databaseCanonicalGraphProvider(
  seedNodeId: string,
  seedNodeVersionId?: string,
): Promise<CanonicalGraphResponse | undefined> {
  const { CanonicalGraphQueryError, queryCanonicalGraph } =
    await import("./canonical-graph-query.js");
  try {
    return canonicalGraphResponseSchema.parse(
      await queryCanonicalGraph({
        seed: seedNodeId,
        ...(seedNodeVersionId ? { version: seedNodeVersionId } : {}),
        direction: "both",
        status: "authoritative",
        limit: MAX_GRAPH_EDGES,
      }),
    );
  } catch (error) {
    if (error instanceof CanonicalGraphQueryError && error.code === "not-found") return undefined;
    throw error;
  }
}

async function databaseCanonicalEntryProvider(
  query: KnowledgeLandscapeQuery,
): Promise<CanonicalGraphEntryReference[]> {
  const text = query.q?.trim();
  // `reviewSlug` is an input identifier bridge only: resolve it once to the review's canonical
  // node identity, then perform selection exclusively through canonical NodeEdge/NodeVersion rows.
  if (query.reviewSlug) {
    const review = await prisma.review.findUnique({
      where: { slug: query.reviewSlug },
      select: { knowledgeNodeId: true },
    });
    if (!review?.knowledgeNodeId) return [];
    const edges = await prisma.nodeEdge.findMany({
      where: {
        status: "source-assertion",
        provenance: "imported-from-review",
        relationType: "asserts",
        sourceNodeVersion: {
          knowledgeNodeId: review.knowledgeNodeId,
          ...readableCanonicalNodeVersionWhere,
        },
        confirmedTargetNodeVersion: readableCanonicalNodeVersionWhere,
      },
      select: {
        targetNodeId: true,
        confirmedTargetNodeVersion: {
          select: {
            id: true,
            knowledgeNodeId: true,
            title: true,
            abstract: true,
            text: true,
            payloadJson: true,
          },
        },
      },
      orderBy: { id: "asc" },
      take: 40,
    });
    return edges.flatMap(({ targetNodeId, confirmedTargetNodeVersion: version }) => {
      if (
        !version ||
        version.knowledgeNodeId !== targetNodeId ||
        !matchesCanonicalText(version, text) ||
        !payloadMatchesClaimType(version.payloadJson, query.claimType)
      )
        return [];
      return [{ nodeId: targetNodeId, nodeVersionId: version.id }];
    });
  }
  const where: Prisma.KnowledgeNodeVersionWhereInput = {
    ...readableCanonicalNodeVersionWhere,
    knowledgeNode: { kind: "claim" },
    ...(text
      ? {
          OR: [
            { title: { contains: text } },
            { abstract: { contains: text } },
            { text: { contains: text } },
          ],
        }
      : {}),
  };
  const rows = await prisma.knowledgeNodeVersion.findMany({
    where,
    select: { id: true, knowledgeNodeId: true, payloadJson: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 40,
  });
  return rows
    .filter((row) => payloadMatchesClaimType(row.payloadJson, query.claimType))
    .map((row) => ({ nodeId: row.knowledgeNodeId, nodeVersionId: row.id }));
}

function matchesCanonicalText(
  version: { title: string | null; abstract: string | null; text: string | null },
  text?: string,
): boolean {
  if (!text) return true;
  return `${version.title ?? ""} ${version.abstract ?? ""} ${version.text ?? ""}`
    .toLocaleLowerCase("en")
    .includes(text.toLocaleLowerCase("en"));
}

function payloadMatchesClaimType(payloadJson: string, claimType?: string): boolean {
  if (!claimType) return true;
  try {
    const payload = JSON.parse(payloadJson) as { claimType?: unknown };
    return payload.claimType === claimType;
  } catch {
    return false;
  }
}
