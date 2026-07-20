import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  canonicalJson,
  nodeRelationTypeSchema,
  publicGraphEdgeSchema,
  publicGraphNodeSchema,
  publicGraphResponseSchema,
  publicGraphTrustSchema,
  type PublicGraphEdge,
  type PublicGraphNode,
  type PublicGraphQuery,
  type PublicGraphResponse,
} from "@oratlas/contracts";
import { getServerEnv } from "@oratlas/config";
import { InProcessSearchProvider, type IndexedNode } from "@oratlas/knowledge";
import { prisma } from "./db";
import { databaseGraphTrustProvider } from "./graph-trust-provider";
import {
  graphTrustLookupKey,
  type GraphTrustLookupKey,
  type GraphTrustProvider,
} from "./graph-trust";
import {
  hasOwnedConfirmedTargetVersion,
  publicConfirmedNodeEdgeWhere,
} from "./node-edge-publication";
import { tryMapPublicNodeVersion } from "./node-publication";
import { readablePublicNodeVersionWhere } from "./public-snapshot-visibility";

const GRAPH_SEARCH_SCAN_LIMIT = 1_000;
const GRAPH_MAX_CANDIDATE_EDGES = 500;
const GRAPH_TOPIC_SEED_LIMIT = 10;

const cursorSchema = z
  .object({
    v: z.literal(2),
    lastEdgeId: z.string().min(1).max(200),
    query: z.string().length(64),
    candidateSetHash: z.string().length(64),
  })
  .strict();

export { emptyGraphTrustProvider, graphTrustLookupKey } from "./graph-trust";
export type { GraphTrustLookupKey, GraphTrustProvider } from "./graph-trust";

export interface GraphQueryOptions {
  trustProvider?: GraphTrustProvider;
  cursorSecret?: string;
}

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
    where: {
      ...(ids ? { id: { in: ids } } : {}),
      versions: { some: readablePublicNodeVersionWhere },
    },
    orderBy: { id: "asc" },
    ...(ids ? {} : { take: GRAPH_SEARCH_SCAN_LIMIT + 1 }),
    include: {
      repository: { select: repositorySelect },
      versions: {
        where: readablePublicNodeVersionWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        include: versionInclude,
      },
    },
  });
}

function mapGraphNode(node: GraphNodeRow, version: GraphVersion): PublicGraphNode | undefined {
  const mapped = tryMapPublicNodeVersion(node, version);
  if (!mapped) return undefined;
  const parsed = publicGraphNodeSchema.safeParse({
    id: node.id,
    localNodeId: node.localNodeId,
    kind: mapped.kind,
    repository: {
      owner: node.repository.owner,
      name: node.repository.name,
      url: node.repository.canonicalUrl,
    },
    versionId: mapped.id,
    snapshotId: mapped.snapshotId,
    commitSha: mapped.commitSha,
    title: mapped.title,
    abstract: mapped.abstract,
    provenance: mapped.provenance,
    identifiers: mapped.identifiers,
    createdAt: mapped.createdAt,
  });
  return parsed.success ? parsed.data : undefined;
}

function matchesNodeFilters(node: PublicGraphNode, query: PublicGraphQuery): boolean {
  return !query.kind || node.kind === query.kind;
}

async function resolveSeeds(query: PublicGraphQuery): Promise<PublicGraphNode[]> {
  if (query.seed) {
    const rows = await loadSeedRows([query.seed]);
    const row = rows[0];
    if (!row) throw new GraphQueryError("Seed node not found.", "not-found");
    const mapped = row.versions[0] && mapGraphNode(row, row.versions[0]);
    // The newest version is authoritative: corrupt current content never falls back to history.
    if (!mapped) throw new GraphQueryError("Seed node not found.", "not-found");
    return matchesNodeFilters(mapped, query) ? [mapped] : [];
  }

  const rows = await loadSeedRows();
  if (rows.length > GRAPH_SEARCH_SCAN_LIMIT) {
    throw new GraphQueryError(
      "Topic query exceeds the 1,000-node scan bound. Narrow the query or use a seed node.",
    );
  }
  const mapped = rows.flatMap((row) => {
    const version = row.versions[0];
    const node = version && mapGraphNode(row, version);
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
      sourceNodeVersion: readablePublicNodeVersionWhere,
      confirmedTargetNodeVersion: readablePublicNodeVersionWhere,
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
      sourceNodeVersion: readablePublicNodeVersionWhere,
      targetNodeVersion: readablePublicNodeVersionWhere,
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

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mapEdgeNodes(edge: EdgeRow) {
  if (!hasOwnedConfirmedTargetVersion(edge) || !edge.confirmedAt) return undefined;
  const source = mapGraphNode(edge.sourceNodeVersion.knowledgeNode, edge.sourceNodeVersion);
  const target = mapGraphNode(edge.targetNode, edge.confirmedTargetNodeVersion);
  if (!source || !target) return undefined;
  const relation = relationSchema.safeParse(edge.relationType);
  if (!relation.success) return undefined;
  const parsed = publicGraphEdgeSchema.safeParse({
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
  });
  return parsed.success ? { edge: parsed.data, source, target } : undefined;
}

function mapProposalNodes(proposal: ProposalRow) {
  if (proposal.targetNodeVersion.knowledgeNodeId !== proposal.targetNodeId) return undefined;
  const source = mapGraphNode(proposal.sourceNodeVersion.knowledgeNode, proposal.sourceNodeVersion);
  const target = mapGraphNode(proposal.targetNode, proposal.targetNodeVersion);
  const relation = relationSchema.safeParse(proposal.relationType);
  const provenance = z.enum(["asserted-by-author", "proposed-by-agent"]).safeParse(proposal.origin);
  if (!source || !target || !relation.success || !provenance.success) return undefined;
  const parsed = publicGraphEdgeSchema.safeParse({
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
  });
  return parsed.success ? { edge: parsed.data, source, target } : undefined;
}

function queryFingerprint(query: PublicGraphQuery): string {
  const { cursor: _cursor, ...bound } = query;
  return createHash("sha256").update(canonicalJson(bound)).digest("hex");
}

function signCursorPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signaturesMatch(payload: string, signature: string, secret: string): boolean {
  // A SHA-256 HMAC has exactly 32 bytes and one canonical unpadded base64url
  // representation (43 characters). Buffer.from is intentionally permissive:
  // it accepts aliases whose unused final bits are non-zero, so validate and
  // round-trip before the constant-time byte comparison.
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== 32 || provided.toString("base64url") !== signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest();
  return timingSafeEqual(expected, provided);
}

function decodeCursor(
  cursor: string | undefined,
  fingerprint: string,
  candidateSetHash: string,
  candidates: readonly PublicGraphEdge[],
  secret: string,
): number {
  if (!cursor) return 0;
  try {
    const separator = cursor.lastIndexOf(".");
    if (separator <= 0) throw new Error("missing signature");
    const payload = cursor.slice(0, separator);
    const signature = cursor.slice(separator + 1);
    if (!signature || !signaturesMatch(payload, signature, secret)) {
      throw new Error("invalid signature");
    }
    const value = cursorSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (value.query !== fingerprint) throw new Error("query mismatch");
    if (value.candidateSetHash !== candidateSetHash) throw new Error("candidate set changed");
    const index = candidates.findIndex((edge) => edge.id === value.lastEdgeId);
    if (index < 0) throw new Error("last edge missing");
    return index + 1;
  } catch {
    throw new GraphQueryError("Graph cursor is invalid, stale, or belongs to another query.");
  }
}

function encodeCursor(
  lastEdgeId: string,
  fingerprint: string,
  candidateSetHash: string,
  secret: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 2, lastEdgeId, query: fingerprint, candidateSetHash }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signCursorPayload(payload, secret)}`;
}

function candidateHash(candidates: readonly PublicGraphEdge[]): string {
  return createHash("sha256").update(canonicalJson(candidates)).digest("hex");
}

function trustKeyForEdge(edge: PublicGraphEdge): GraphTrustLookupKey {
  return {
    sourceVersionId: edge.sourceVersionId,
    targetVersionId: edge.targetVersionId,
    relationType: edge.relationType,
  };
}

export async function queryPublicGraph(
  query: PublicGraphQuery,
  options: GraphQueryOptions = {},
): Promise<PublicGraphResponse> {
  const trustProvider = options.trustProvider ?? databaseGraphTrustProvider;
  const cursorSecret = options.cursorSecret ?? getServerEnv().sessionSecret;
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
    if (rows.length > GRAPH_MAX_CANDIDATE_EDGES) {
      throw new GraphQueryError(
        `Graph frontier exceeds the ${GRAPH_MAX_CANDIDATE_EDGES}-edge traversal bound. Narrow the query.`,
      );
    }
    const mappedRows = rows.flatMap((row) => {
      const mapped =
        query.edgeStatus === "confirmed"
          ? mapEdgeNodes(row as EdgeRow)
          : mapProposalNodes(row as ProposalRow);
      return mapped ? [mapped] : [];
    });
    const trustRows =
      query.edgeStatus === "confirmed"
        ? await trustProvider.lookup(mappedRows.map(({ edge }) => trustKeyForEdge(edge)))
        : new Map<string, never>();
    const next = new Set<string>();
    for (const mapped of mappedRows) {
      const rawTrust = trustRows.get(graphTrustLookupKey(trustKeyForEdge(mapped.edge)));
      const parsedSet =
        rawTrust === undefined ? undefined : publicGraphTrustSchema.array().safeParse(rawTrust);
      const parsedSingleton =
        rawTrust === undefined || parsedSet?.success
          ? undefined
          : publicGraphTrustSchema.safeParse(rawTrust);
      const trust = parsedSet?.success
        ? parsedSet.data
        : parsedSingleton?.success
          ? [parsedSingleton.data]
          : [];
      if (query.hasTrust !== undefined && trust.length > 0 !== query.hasTrust) continue;
      const edgeWithTrust =
        mapped.edge.status === "confirmed" && trust.length > 0
          ? publicGraphEdgeSchema.safeParse({
              ...mapped.edge,
              trust: trust.length === 1 ? trust[0] : undefined,
              trustAssessments: trust,
            })
          : publicGraphEdgeSchema.safeParse(mapped.edge);
      if (
        !edgeWithTrust.success ||
        !matchesNodeFilters(mapped.source, query) ||
        !matchesNodeFilters(mapped.target, query)
      ) {
        continue;
      }
      if (!edgesById.has(edgeWithTrust.data.id) && edgesById.size >= GRAPH_MAX_CANDIDATE_EDGES) {
        throw new GraphQueryError(
          `Graph query exceeds the ${GRAPH_MAX_CANDIDATE_EDGES}-edge cumulative bound. Narrow the query.`,
        );
      }
      edgesById.set(edgeWithTrust.data.id, edgeWithTrust.data);
      nodesByVersion.set(mapped.source.versionId, mapped.source);
      nodesByVersion.set(mapped.target.versionId, mapped.target);
      for (const id of [mapped.source.id, mapped.target.id]) {
        if (!visited.has(id)) next.add(id);
      }
    }
    for (const id of next) visited.add(id);
    frontier = [...next].sort(compareCanonical);
  }

  const candidates = [...edgesById.values()].sort((a, b) => compareCanonical(a.id, b.id));
  const fingerprint = queryFingerprint(query);
  const setHash = candidateHash(candidates);
  const startIndex = decodeCursor(query.cursor, fingerprint, setHash, candidates, cursorSecret);
  const edges = candidates.slice(startIndex, startIndex + query.limit);
  const pageVersionIds = new Set(seeds.map((node) => node.versionId));
  for (const edge of edges) {
    pageVersionIds.add(edge.sourceVersionId);
    pageVersionIds.add(edge.targetVersionId);
  }
  const nodes = [...nodesByVersion.values()]
    .filter((node) => pageVersionIds.has(node.versionId))
    .sort((a, b) => compareCanonical(a.id, b.id) || compareCanonical(a.versionId, b.versionId));
  const nextIndex = startIndex + edges.length;
  return publicGraphResponseSchema.parse({
    schemaVersion: "1.0.0",
    seedNodeIds: seeds.map((node) => node.id),
    depth: query.depth,
    nodes,
    edges,
    page: {
      limit: query.limit,
      nextCursor:
        nextIndex < candidates.length && edges.at(-1)
          ? encodeCursor(edges.at(-1)!.id, fingerprint, setHash, cursorSecret)
          : undefined,
    },
  });
}
