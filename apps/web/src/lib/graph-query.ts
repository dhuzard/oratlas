import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  publicGraphResponseSchema,
  nodeRelationTypeSchema,
  type PublicGraphEdge,
  type PublicGraphNode,
  type PublicGraphQuery,
  type PublicGraphResponse,
} from "@oratlas/contracts";
import { InProcessSearchProvider, type IndexedNode } from "@oratlas/knowledge";
import { prisma } from "./db";
import {
  hasOwnedConfirmedTargetVersion,
  publicConfirmedNodeEdgeWhere,
} from "./node-edge-publication";
import { tryMapPublicNodeVersion } from "./node-publication";

const GRAPH_SEARCH_SCAN_LIMIT = 1_000;
const GRAPH_MAX_CANDIDATE_EDGES = 500;
const GRAPH_TOPIC_SEED_LIMIT = 10;

const cursorSchema = z
  .object({ v: z.literal(1), offset: z.number().int().nonnegative(), query: z.string().length(64) })
  .strict();

export class GraphQueryError extends Error {
  constructor(
    message: string,
    readonly code: "bad-request" | "not-found" = "bad-request",
  ) {
    super(message);
  }
}

const repositorySelect = { owner: true, name: true, canonicalUrl: true } as const;
const versionInclude = { snapshot: { select: { commitSha: true } } } as const;

type GraphVersion = Awaited<ReturnType<typeof loadSeedRows>>[number]["versions"][number];
type GraphNodeRow = Omit<Awaited<ReturnType<typeof loadSeedRows>>[number], "versions">;

async function loadSeedRows(ids?: string[]) {
  return prisma.knowledgeNode.findMany({
    where: ids ? { id: { in: ids } } : undefined,
    orderBy: { id: "asc" },
    ...(ids ? {} : { take: GRAPH_SEARCH_SCAN_LIMIT }),
    include: {
      repository: { select: repositorySelect },
      versions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        include: versionInclude,
      },
    },
  });
}

function mapGraphNode(
  node: GraphNodeRow,
  version: GraphVersion,
  hasTrust: boolean,
): PublicGraphNode | undefined {
  const mapped = tryMapPublicNodeVersion(node, version);
  if (!mapped) return undefined;
  return {
    id: node.id,
    localNodeId: node.localNodeId,
    kind: mapped.kind,
    repository: {
      owner: node.repository.owner,
      name: node.repository.name,
      url: node.repository.canonicalUrl,
    },
    versionId: mapped.id,
    title: mapped.title,
    abstract: mapped.abstract,
    provenance: mapped.provenance,
    identifiers: mapped.identifiers,
    createdAt: mapped.createdAt,
    hasTrust,
  };
}

async function trustNodeIds(nodeIds: string[]): Promise<Set<string>> {
  if (nodeIds.length === 0) return new Set();
  const rows = await prisma.knowledgeNode.findMany({
    where: {
      id: { in: nodeIds },
      linkedClaims: {
        some: { evidenceRelations: { some: { trustAssessments: { some: {} } } } },
      },
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

function matchesNodeFilters(node: PublicGraphNode, query: PublicGraphQuery): boolean {
  if (query.kind && node.kind !== query.kind) return false;
  return query.hasTrust === undefined || node.hasTrust === query.hasTrust;
}

async function resolveSeeds(query: PublicGraphQuery): Promise<PublicGraphNode[]> {
  if (query.seed) {
    const rows = await loadSeedRows([query.seed]);
    const row = rows[0];
    if (!row) throw new GraphQueryError("Seed node not found.", "not-found");
    const trust = await trustNodeIds([row.id]);
    const mapped = row.versions[0] && mapGraphNode(row, row.versions[0], trust.has(row.id));
    // The newest version is authoritative: corrupt current content never falls back to history.
    if (!mapped) throw new GraphQueryError("Seed node not found.", "not-found");
    return matchesNodeFilters(mapped, query) ? [mapped] : [];
  }

  const rows = await loadSeedRows();
  const trust = await trustNodeIds(rows.map((row) => row.id));
  const mapped = rows.flatMap((row) => {
    const version = row.versions[0];
    const node = version && mapGraphNode(row, version, trust.has(row.id));
    return node && matchesNodeFilters(node, query) ? [node] : [];
  });
  const indexed: IndexedNode[] = mapped.map((node) => ({
    nodeId: node.id,
    localNodeId: node.localNodeId,
    kind: node.kind,
    title: node.title,
    abstract: node.abstract,
    repositoryOwner: node.repository.owner,
    repositoryName: node.repository.name,
  }));
  const provider = new InProcessSearchProvider({
    reviews: [],
    claims: [],
    citations: [],
    identifierConflicts: [],
    nodes: indexed,
  });
  const result = provider.searchNodes({
    q: query.q!,
    kind: query.kind,
    page: 1,
    pageSize: GRAPH_TOPIC_SEED_LIMIT,
  });
  const byId = new Map(mapped.map((node) => [node.id, node]));
  return result.items.flatMap((item) => {
    const node = byId.get(item.nodeId);
    return node ? [node] : [];
  });
}

type EdgeRow = Awaited<ReturnType<typeof loadEdges>>[number];
type ProposalRow = Awaited<ReturnType<typeof loadProposals>>[number];

async function loadEdges(frontier: string[], query: PublicGraphQuery) {
  return prisma.nodeEdge.findMany({
    where: {
      ...publicConfirmedNodeEdgeWhere,
      ...(query.relationType ? { relationType: query.relationType } : {}),
      OR: [
        { sourceNodeVersion: { knowledgeNodeId: { in: frontier } } },
        { targetNodeId: { in: frontier } },
      ],
    },
    orderBy: { id: "asc" },
    take: GRAPH_MAX_CANDIDATE_EDGES + 1,
    include: {
      sourceNodeVersion: {
        include: {
          snapshot: { select: { commitSha: true } },
          knowledgeNode: { include: { repository: { select: repositorySelect } } },
        },
      },
      targetNode: { include: { repository: { select: repositorySelect } } },
      confirmedTargetNodeVersion: { include: versionInclude },
    },
  });
}

async function loadProposals(frontier: string[], query: PublicGraphQuery) {
  return prisma.nodeEdgeProposal.findMany({
    where: {
      status: "proposed",
      ...(query.relationType ? { relationType: query.relationType } : {}),
      OR: [
        { sourceNodeVersion: { knowledgeNodeId: { in: frontier } } },
        { targetNodeId: { in: frontier } },
      ],
    },
    orderBy: { id: "asc" },
    take: GRAPH_MAX_CANDIDATE_EDGES + 1,
    select: {
      id: true,
      targetNodeId: true,
      relationType: true,
      origin: true,
      rationale: true,
      createdAt: true,
      sourceNodeVersion: {
        include: {
          snapshot: { select: { commitSha: true } },
          knowledgeNode: { include: { repository: { select: repositorySelect } } },
        },
      },
      targetNode: { include: { repository: { select: repositorySelect } } },
      targetNodeVersion: { include: versionInclude },
    },
  });
}

const relationSchema = nodeRelationTypeSchema;

function mapEdgeNodes(edge: EdgeRow, trust: Set<string>) {
  if (!hasOwnedConfirmedTargetVersion(edge) || !edge.confirmedAt) return undefined;
  const source = mapGraphNode(
    edge.sourceNodeVersion.knowledgeNode,
    edge.sourceNodeVersion,
    trust.has(edge.sourceNodeVersion.knowledgeNodeId),
  );
  const target = mapGraphNode(
    edge.targetNode,
    edge.confirmedTargetNodeVersion,
    trust.has(edge.targetNodeId),
  );
  if (!source || !target) return undefined;
  const relation = relationSchema.safeParse(edge.relationType);
  if (!relation.success) return undefined;
  const mapped: PublicGraphEdge = {
    id: edge.id,
    sourceNodeId: source.id,
    sourceVersionId: source.versionId,
    targetNodeId: target.id,
    targetVersionId: target.versionId,
    relationType: relation.data,
    status: "confirmed",
    provenance: "confirmed-by-editor",
    rationale: edge.rationale ?? undefined,
    assertedAt: edge.assertedAt?.toISOString(),
    confirmedAt: edge.confirmedAt.toISOString(),
  };
  return { edge: mapped, source, target };
}

function mapProposalNodes(proposal: ProposalRow, trust: Set<string>) {
  if (proposal.targetNodeVersion.knowledgeNodeId !== proposal.targetNodeId) return undefined;
  const source = mapGraphNode(
    proposal.sourceNodeVersion.knowledgeNode,
    proposal.sourceNodeVersion,
    trust.has(proposal.sourceNodeVersion.knowledgeNodeId),
  );
  const target = mapGraphNode(
    proposal.targetNode,
    proposal.targetNodeVersion,
    trust.has(proposal.targetNodeId),
  );
  const relation = relationSchema.safeParse(proposal.relationType);
  const provenance = z.enum(["asserted-by-author", "proposed-by-agent"]).safeParse(proposal.origin);
  if (!source || !target || !relation.success || !provenance.success) return undefined;
  const mapped: PublicGraphEdge = {
    id: proposal.id,
    sourceNodeId: source.id,
    sourceVersionId: source.versionId,
    targetNodeId: target.id,
    targetVersionId: target.versionId,
    relationType: relation.data,
    status: "proposed",
    provenance: provenance.data,
    rationale: proposal.rationale ?? undefined,
    assertedAt:
      provenance.data === "asserted-by-author" ? proposal.createdAt.toISOString() : undefined,
    proposedAt: proposal.createdAt.toISOString(),
  };
  return { edge: mapped, source, target };
}

function queryFingerprint(query: PublicGraphQuery): string {
  const { cursor: _cursor, ...bound } = query;
  return createHash("sha256").update(JSON.stringify(bound)).digest("hex");
}

function decodeCursor(cursor: string | undefined, fingerprint: string): number {
  if (!cursor) return 0;
  try {
    const value = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (value.query !== fingerprint) throw new Error("query mismatch");
    return value.offset;
  } catch {
    throw new GraphQueryError("Graph cursor is invalid for this query.");
  }
}

function encodeCursor(offset: number, fingerprint: string): string {
  return Buffer.from(JSON.stringify({ v: 1, offset, query: fingerprint }), "utf8").toString(
    "base64url",
  );
}

export async function queryPublicGraph(query: PublicGraphQuery): Promise<PublicGraphResponse> {
  const seeds = await resolveSeeds(query);
  const nodesByVersion = new Map(seeds.map((node) => [node.versionId, node]));
  const edgesById = new Map<string, PublicGraphEdge>();
  let frontier = [...new Set(seeds.map((node) => node.id))];
  const visited = new Set(frontier);

  for (let level = 0; level < query.depth && frontier.length > 0; level += 1) {
    const rows =
      query.edgeStatus === "confirmed"
        ? await loadEdges(frontier, query)
        : await loadProposals(frontier, query);
    const endpointIds = rows.flatMap((edge) => [
      edge.sourceNodeVersion.knowledgeNodeId,
      edge.targetNodeId,
    ]);
    const trust = await trustNodeIds(endpointIds);
    const next = new Set<string>();
    for (const row of rows) {
      if (edgesById.size >= GRAPH_MAX_CANDIDATE_EDGES) break;
      const mapped =
        query.edgeStatus === "confirmed"
          ? mapEdgeNodes(row as EdgeRow, trust)
          : mapProposalNodes(row as ProposalRow, trust);
      if (
        !mapped ||
        !matchesNodeFilters(mapped.source, query) ||
        !matchesNodeFilters(mapped.target, query)
      ) {
        continue;
      }
      edgesById.set(mapped.edge.id, mapped.edge);
      nodesByVersion.set(mapped.source.versionId, mapped.source);
      nodesByVersion.set(mapped.target.versionId, mapped.target);
      for (const id of [mapped.source.id, mapped.target.id]) {
        if (!visited.has(id)) next.add(id);
      }
    }
    for (const id of next) visited.add(id);
    frontier = [...next].sort();
  }

  const candidates = [...edgesById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const fingerprint = queryFingerprint(query);
  const offset = decodeCursor(query.cursor, fingerprint);
  if (offset > candidates.length) throw new GraphQueryError("Graph cursor is out of range.");
  const edges = candidates.slice(offset, offset + query.limit);
  const pageVersionIds = new Set(seeds.map((node) => node.versionId));
  for (const edge of edges) {
    pageVersionIds.add(edge.sourceVersionId);
    pageVersionIds.add(edge.targetVersionId);
  }
  const nodes = [...nodesByVersion.values()]
    .filter((node) => pageVersionIds.has(node.versionId))
    .sort((a, b) => a.id.localeCompare(b.id) || a.versionId.localeCompare(b.versionId));
  const nextOffset = offset + edges.length;
  return publicGraphResponseSchema.parse({
    schemaVersion: "1.0.0",
    seedNodeIds: seeds.map((node) => node.id),
    depth: query.depth,
    nodes,
    edges,
    page: {
      limit: query.limit,
      nextCursor:
        nextOffset < candidates.length ? encodeCursor(nextOffset, fingerprint) : undefined,
    },
  });
}
