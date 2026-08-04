import {
  KNOWLEDGE_LANDSCAPE_ALGORITHM_VERSION,
  KNOWLEDGE_LANDSCAPE_SCHEMA_VERSION,
  knowledgeLandscapeQuerySchema,
  knowledgeLandscapeResponseSchema,
  type ExplorationInterest,
  type KnowledgeLandscapeData,
  type KnowledgeLandscapeEdge,
  type KnowledgeLandscapeNode,
  type KnowledgeLandscapeQuery,
  type KnowledgeLandscapeResponse,
  type PublicGraphEdge,
  type PublicGraphNode,
  type PublicGraphResponse,
} from "@oratlas/contracts";
import {
  InProcessSearchProvider,
  type IndexedClaim,
  type KnowledgeIndexData,
} from "@oratlas/knowledge";
import { buildKnowledgeLandscape, focusLandscape } from "./knowledge-landscape.js";

const MAX_GRAPH_SEEDS = 3;
const MAX_GRAPH_CANDIDATE_SEEDS = 6;
const MAX_GRAPH_NODES = 12;
const MAX_GRAPH_EDGES_PER_SEED = 25;

export type LandscapeGraphProvider = (
  seedNodeId: string,
) => Promise<PublicGraphResponse | undefined>;

export interface KnowledgeLandscapeServiceOptions {
  graphProvider?: LandscapeGraphProvider;
}

export async function createKnowledgeLandscapeResponse(
  index: KnowledgeIndexData,
  input: KnowledgeLandscapeQuery,
  options: KnowledgeLandscapeServiceOptions = {},
): Promise<KnowledgeLandscapeResponse> {
  const query = knowledgeLandscapeQuerySchema.parse(input);
  const provider = new InProcessSearchProvider(index);
  const candidates = provider.searchClaims({
    q: query.q,
    reviewSlug: query.reviewSlug,
    claimType: query.claimType,
    relationType: query.relationType,
    trustCriterion: query.trustCriterion,
    page: 1,
    pageSize: 40,
  });
  const graphProvider = options.graphProvider ?? databaseGraphProvider;
  const preloadedGraphs = await preloadCandidateGraphs(
    candidates.items,
    query.interests,
    graphProvider,
  );
  const overview = buildKnowledgeLandscape(index, candidates.items, query.interests, {
    query: query.q,
    graphInterestMatches: graphInterestMatches(preloadedGraphs),
  });
  const cachedGraphProvider: LandscapeGraphProvider = async (seedNodeId) =>
    preloadedGraphs.has(seedNodeId) ? preloadedGraphs.get(seedNodeId) : graphProvider(seedNodeId);
  const graphLandscape = await addGraphNeighborhoods(
    overview,
    query.interests,
    cachedGraphProvider,
  );
  const landscape = focusLandscape(graphLandscape, query.focusNodeId);

  return knowledgeLandscapeResponseSchema.parse({
    schemaVersion: KNOWLEDGE_LANDSCAPE_SCHEMA_VERSION,
    algorithm: {
      id: "explicit-interest-graph-landscape",
      version: KNOWLEDGE_LANDSCAPE_ALGORITHM_VERSION,
      purpose: "navigation",
      limitations: [
        "not-a-truth-score",
        "not-a-quality-score",
        "confirmed-graph-edges-only",
        "bounded-to-six-claims-ten-evidence-and-twelve-graph-nodes",
      ],
    },
    query,
    landscape,
  });
}

async function preloadCandidateGraphs(
  candidateClaims: IndexedClaim[],
  interests: ExplorationInterest[],
  graphProvider: LandscapeGraphProvider,
): Promise<Map<string, PublicGraphResponse | undefined>> {
  if (interests.length === 0) return new Map();
  const seedIds = [
    ...new Set(
      candidateClaims.flatMap((claim) => (claim.knowledgeNodeId ? [claim.knowledgeNodeId] : [])),
    ),
  ].slice(0, MAX_GRAPH_CANDIDATE_SEEDS);
  const responses = await Promise.all(seedIds.map(graphProvider));
  return new Map(seedIds.map((seedId, index) => [seedId, responses[index]]));
}

function graphInterestMatches(
  responses: ReadonlyMap<string, PublicGraphResponse | undefined>,
): ReadonlyMap<string, ReadonlySet<ExplorationInterest>> {
  const output = new Map<string, ReadonlySet<ExplorationInterest>>();
  for (const [seedId, response] of responses) {
    if (!response) continue;
    const matches = new Set<ExplorationInterest>();
    const confirmedEdges = response.edges.filter((edge) => edge.status === "confirmed");
    const searchable = response.nodes
      .map((node) => `${node.title} ${node.abstract ?? ""}`)
      .join(" ");
    const relationTypes = new Set(confirmedEdges.map((edge) => edge.relationType));
    if (
      response.nodes.some((node) => node.kind === "dataset" || node.kind === "code") ||
      relationTypes.has("uses-dataset") ||
      relationTypes.has("uses-code")
    ) {
      matches.add("data-code");
    }
    if (relationTypes.has("contradicts")) matches.add("disagreements");
    if (relationTypes.has("replicates") || /replicat|reproduc|robust|convergen/i.test(searchable)) {
      matches.add("reproducibility");
    }
    if (
      relationTypes.has("uses-dataset") ||
      relationTypes.has("uses-code") ||
      /method|model|protocol|algorithm|pipeline|population|cohort|design/i.test(searchable)
    ) {
      matches.add("methods-models");
    }
    if (confirmedEdges.some((edge) => graphEdgeAssessmentCount(edge) > 0)) {
      matches.add("assessed-evidence");
    }
    output.set(seedId, matches);
  }
  return output;
}

async function databaseGraphProvider(seedNodeId: string): Promise<PublicGraphResponse | undefined> {
  const { GraphQueryError, queryPublicGraph } = await import("./graph-query.js");
  try {
    return await queryPublicGraph({
      seed: seedNodeId,
      depth: 1,
      limit: MAX_GRAPH_EDGES_PER_SEED,
      edgeStatus: "confirmed",
    });
  } catch (error) {
    // A legacy claim may point to a node without a currently readable public version.
    // That claim remains in Explore, but it must not produce a fabricated graph projection.
    if (error instanceof GraphQueryError && error.code === "not-found") return undefined;
    throw error;
  }
}

async function addGraphNeighborhoods(
  landscape: KnowledgeLandscapeData,
  interests: ExplorationInterest[],
  graphProvider: LandscapeGraphProvider,
): Promise<KnowledgeLandscapeData> {
  const requestedSeedIds = [
    ...new Set(
      landscape.nodes.flatMap((node) =>
        node.kind === "claim" && node.graphNodeId ? [node.graphNodeId] : [],
      ),
    ),
  ].slice(0, MAX_GRAPH_SEEDS);
  if (requestedSeedIds.length === 0) return landscape;

  const responses = (
    await Promise.all(
      requestedSeedIds.map(async (requestedSeedId) => ({
        requestedSeedId,
        response: await graphProvider(requestedSeedId),
      })),
    )
  ).filter(
    (result): result is { requestedSeedId: string; response: PublicGraphResponse } =>
      result.response !== undefined &&
      result.response.nodes.some((node) => node.id === result.requestedSeedId),
  );
  if (responses.length === 0) {
    return { ...landscape, nodes: landscape.nodes.map(withoutGraphProjection) };
  }

  const nodeById = new Map<string, PublicGraphNode>();
  const edgeById = new Map<string, PublicGraphEdge>();
  const availableSeedIds = new Set<string>();
  for (const { requestedSeedId, response } of responses) {
    availableSeedIds.add(requestedSeedId);
    response.nodes.forEach((node) => nodeById.set(node.id, node));
    response.edges
      .filter((edge) => edge.status === "confirmed")
      .forEach((edge) => edgeById.set(edge.id, edge));
  }

  const graphLandscapeId = new Map<string, string>();
  const baseNodes = landscape.nodes.map((node) => {
    if (!node.graphNodeId) return node;
    if (!availableSeedIds.has(node.graphNodeId)) return withoutGraphProjection(node);
    const graphNode = nodeById.get(node.graphNodeId);
    if (!graphNode) return withoutGraphProjection(node);
    graphLandscapeId.set(graphNode.id, node.id);
    const connectionCount = incidentEdges(graphNode.id, edgeById.values()).length;
    return {
      ...node,
      graphNodeVersionId: graphNode.versionId,
      graphRecordHref: exactNodeHref(graphNode),
      reasons: appendUnique(
        node.reasons,
        `${connectionCount} confirmed graph connection${connectionCount === 1 ? "" : "s"}`,
      ),
    };
  });

  const candidateNodes = [...nodeById.values()]
    .filter((node) => !availableSeedIds.has(node.id))
    .map((node) => {
      const edges = incidentEdges(node.id, edgeById.values());
      const reasons = explainGraphNode(node, edges, interests, availableSeedIds);
      return { node, edges, reasons, interestReasonCount: reasons.filter(isInterestReason).length };
    })
    .sort(
      (left, right) =>
        right.interestReasonCount - left.interestReasonCount ||
        assessedEdgeCount(right.edges) - assessedEdgeCount(left.edges) ||
        right.edges.length - left.edges.length ||
        left.node.title.localeCompare(right.node.title) ||
        left.node.id.localeCompare(right.node.id),
    );

  const remainingCapacity = Math.max(0, MAX_GRAPH_NODES - availableSeedIds.size);
  const selectedGraphNodes = candidateNodes.slice(0, remainingCapacity);
  const nativeNodes: KnowledgeLandscapeNode[] = selectedGraphNodes.map(({ node, reasons }) => {
    const id = `graph:${node.id}`;
    graphLandscapeId.set(node.id, id);
    return {
      id,
      kind: node.kind,
      label: node.title,
      detail: `${nodeKindLabel(node.kind)} · exact preserved graph version`,
      href: exactNodeHref(node),
      reasons,
      graphNodeId: node.id,
      graphNodeVersionId: node.versionId,
      graphHref: `/graph?seed=${encodeURIComponent(node.id)}`,
      graphRecordHref: exactNodeHref(node),
    };
  });

  const includedGraphIds = new Set(graphLandscapeId.keys());
  const nativeEdges: KnowledgeLandscapeEdge[] = [...edgeById.values()]
    .filter(
      (edge) =>
        edge.status === "confirmed" &&
        includedGraphIds.has(edge.sourceNodeId) &&
        includedGraphIds.has(edge.targetNodeId),
    )
    .map((edge) => ({
      sourceId: graphLandscapeId.get(edge.sourceNodeId)!,
      targetId: graphLandscapeId.get(edge.targetNodeId)!,
      label: edge.relationType.replace(/-/g, " "),
      relationType: edge.relationType,
      status: "confirmed" as const,
      assessmentCount: graphEdgeAssessmentCount(edge),
    }));

  return {
    ...landscape,
    nodes: [...baseNodes, ...nativeNodes],
    edges: [...landscape.edges, ...nativeEdges],
    graphSeedCount: availableSeedIds.size,
    graphNodeCount: includedGraphIds.size,
  };
}

function withoutGraphProjection(node: KnowledgeLandscapeNode): KnowledgeLandscapeNode {
  const recordNode = { ...node };
  delete recordNode.graphNodeId;
  delete recordNode.graphNodeVersionId;
  delete recordNode.graphHref;
  delete recordNode.graphRecordHref;
  return recordNode;
}

function incidentEdges(nodeId: string, edges: Iterable<PublicGraphEdge>): PublicGraphEdge[] {
  return [...edges].filter((edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId);
}

function explainGraphNode(
  node: PublicGraphNode,
  edges: PublicGraphEdge[],
  interests: ExplorationInterest[],
  seedIds: Set<string>,
): string[] {
  const reasons: string[] = [];
  const relations = new Set(edges.map((edge) => edge.relationType));
  const connectsToSeed = edges.some(
    (edge) => seedIds.has(edge.sourceNodeId) || seedIds.has(edge.targetNodeId),
  );
  if (connectsToSeed) reasons.push("Directly connected to a claim selected for your interests");
  if (interests.includes("data-code") && (node.kind === "dataset" || node.kind === "code")) {
    reasons.push(`Matches your data & code interest as a ${node.kind} node`);
  }
  if (interests.includes("disagreements") && relations.has("contradicts")) {
    reasons.push("Connected by a confirmed contradicts relation");
  }
  if (interests.includes("reproducibility") && relations.has("replicates")) {
    reasons.push("Connected by a confirmed replicates relation");
  }
  if (
    interests.includes("methods-models") &&
    (/method|model|protocol|algorithm|pipeline/i.test(`${node.title} ${node.abstract ?? ""}`) ||
      relations.has("uses-code") ||
      relations.has("uses-dataset"))
  ) {
    reasons.push("Matches your methods & models interest through its content or relation");
  }
  const assessmentCount = edges.reduce((total, edge) => total + graphEdgeAssessmentCount(edge), 0);
  if (interests.includes("assessed-evidence") && assessmentCount > 0) {
    reasons.push(
      `${assessmentCount} independent graph assessment${assessmentCount === 1 ? "" : "s"}`,
    );
  }
  return reasons.length > 0 ? reasons : ["Connected to a claim selected for this knowledge path"];
}

function graphEdgeAssessmentCount(edge: PublicGraphEdge): number {
  if (edge.status !== "confirmed") return 0;
  return edge.trustAssessments?.length ?? (edge.trust ? 1 : 0);
}

function assessedEdgeCount(edges: PublicGraphEdge[]): number {
  return edges.reduce((total, edge) => total + graphEdgeAssessmentCount(edge), 0);
}

function isInterestReason(reason: string): boolean {
  return /your |confirmed contradicts|confirmed replicates|independent graph assessment/.test(
    reason,
  );
}

function nodeKindLabel(kind: PublicGraphNode["kind"]): string {
  return `${kind[0]!.toUpperCase()}${kind.slice(1)} graph node`;
}

function exactNodeHref(node: PublicGraphNode): string {
  return `/nodes/${encodeURIComponent(node.id)}/versions/${encodeURIComponent(node.versionId)}`;
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}
