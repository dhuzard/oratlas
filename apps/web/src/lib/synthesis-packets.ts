import "server-only";
import type { PrismaClient } from "@oratlas/db";
import {
  subgraphEvidenceTrustSchema,
  synthesisSelectorSchema,
  TRUST_CRITERIA,
  type SubgraphEvidenceSource,
  type SynthesisSelector,
} from "@oratlas/contracts";
import {
  buildPreparedSubgraphEvidencePacket,
  canonicalizeEvidenceTopic,
  fingerprintSubgraphEvidenceSelection,
  type PreparedSubgraphEvidencePacket,
} from "@oratlas/knowledge";
import { orderTrustAssessments } from "@oratlas/trust";
import { prisma } from "./db";
import { publicConfirmedNodeEdgeWhere } from "./node-edge-publication";
import { tryMapPublicNodeVersion } from "./node-publication";
import { readablePublicNodeVersionWhere } from "./public-snapshot-visibility";
import {
  loadedNodeRelationTrustInclude,
  PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT,
  PUBLIC_NODE_RELATION_TRUST_PER_KEY_LIMIT,
  resolveLoadedNodeRelationTrustAssessment,
} from "./trust-provenance";
import {
  SYNTHESIS_TOPIC_SCAN_LIMIT,
  SynthesisEditorialError,
} from "./synthesis-editorial-contract";

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type CurrentNodeRow = Awaited<ReturnType<typeof loadCurrentNodeRows>>[number];

async function loadCurrentNodeRows(client: PrismaClient, ids?: string[]) {
  return client.knowledgeNode.findMany({
    where: ids ? { id: { in: ids } } : undefined,
    orderBy: { id: "asc" },
    ...(ids ? {} : { take: SYNTHESIS_TOPIC_SCAN_LIMIT + 1 }),
    include: {
      repository: { select: { owner: true, name: true, canonicalUrl: true } },
      versions: {
        where: readablePublicNodeVersionWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        include: { snapshot: { select: { commitSha: true } } },
      },
    },
  });
}

function mapEvidenceNode(row: CurrentNodeRow) {
  const version = row.versions[0];
  if (!version || !row.repository) return undefined;
  const mapped = tryMapPublicNodeVersion(row, version);
  if (!mapped) return undefined;
  return {
    id: row.id,
    localNodeId: row.localNodeId,
    repository: {
      owner: row.repository.owner,
      name: row.repository.name,
      url: row.repository.canonicalUrl,
    },
    versionId: mapped.id,
    snapshotId: mapped.snapshotId,
    commitSha: mapped.commitSha,
    title: mapped.title,
    abstract: mapped.abstract,
    text: mapped.text,
    contributors: mapped.contributors,
    license: mapped.license,
    provenance: mapped.provenance,
    identifiers: mapped.identifiers,
    isExample: mapped.isExample,
    createdAt: mapped.createdAt,
    kind: mapped.kind,
    payload: mapped.payload,
  } as SubgraphEvidenceSource["nodes"][number];
}

function topicMatches(row: ReturnType<typeof mapEvidenceNode>, query: string): boolean {
  if (!row) return false;
  const haystack = canonicalizeEvidenceTopic(`${row.title} ${row.abstract ?? ""}`);
  return query.split(" ").every((token) => haystack.includes(token));
}

async function loadAuthoritativeTrustByEdge(
  client: PrismaClient,
  selectedEdges: SubgraphEvidenceSource["edges"],
) {
  const result = new Map<
    string,
    NonNullable<SubgraphEvidenceSource["edges"][number]["trustAssessments"]>
  >();
  if (selectedEdges.length === 0) return result;
  const rows = await client.nodeRelationTrustAssessment.findMany({
    where: {
      proposal: {
        confirmedEdgeId: { in: selectedEdges.map((edge) => edge.id) },
        status: "confirmed",
      },
    },
    include: loadedNodeRelationTrustInclude,
    orderBy: [{ assessedAt: "desc" }, { id: "asc" }],
    take: PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT + 1,
  });
  if (rows.length > PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT) {
    throw new SynthesisEditorialError("TRUST selection exceeds the authoritative global bound.");
  }
  const byEdge = new Map<string, typeof rows>();
  for (const row of rows) {
    const edgeId = row.proposal.confirmedEdgeId;
    if (!edgeId) continue;
    const values = byEdge.get(edgeId) ?? [];
    values.push(row);
    byEdge.set(edgeId, values);
  }
  for (const edge of selectedEdges) {
    const candidates = byEdge.get(edge.id) ?? [];
    if (candidates.length > PUBLIC_NODE_RELATION_TRUST_PER_KEY_LIMIT) {
      throw new SynthesisEditorialError(
        "TRUST selection exceeds the authoritative per-relation bound.",
      );
    }
    const assessments = orderTrustAssessments(
      candidates.flatMap((row) => {
        try {
          const resolved = resolveLoadedNodeRelationTrustAssessment(row);
          if (!resolved.authoritative) return [];
          const criteria = TRUST_CRITERIA.flatMap((criterion) => {
            const encoded = resolved.subject.assessment.criteriaJson[criterion];
            if (!encoded) return [];
            const parsed = JSON.parse(encoded) as unknown;
            if (typeof parsed !== "object" || parsed === null) return [];
            const record = parsed as Record<string, unknown>;
            const inferredStatus =
              record.rating === "not-assessed"
                ? "not-assessed"
                : record.rating === "not-applicable"
                  ? "not-applicable"
                  : "assessed";
            return [{ criterion, ...record, status: record.status ?? inferredStatus }];
          });
          const limitationsValue = JSON.parse(
            resolved.subject.assessment.limitationsJson,
          ) as unknown;
          const value = subgraphEvidenceTrustSchema.safeParse({
            subject: {
              sourceNodeId: edge.sourceNodeId,
              sourceVersionId: edge.sourceVersionId,
              targetNodeId: edge.targetNodeId,
              targetVersionId: edge.targetVersionId,
              relationType: edge.relationType,
            },
            assessmentId: row.id,
            protocolVersion: row.protocolVersion,
            assessorType: row.assessorType,
            assessorId: row.assessorId ?? undefined,
            assessedAt: row.assessedAt?.toISOString(),
            conflictOfInterest: { status: row.conflictOfInterestStatus },
            reviewStatus: resolved.effectiveStatus,
            verificationState: resolved.state,
            criteria,
            limitations: Array.isArray(limitationsValue) ? limitationsValue : undefined,
            aggregateScore: row.aggregateScore ?? undefined,
            aggregateMethod: row.aggregateMethod ?? undefined,
          });
          if (!value.success) return [];
          return [
            {
              id: row.id,
              assessedAt: row.assessedAt?.toISOString() ?? null,
              assessorType: row.assessorType,
              assessorId: row.assessorId,
              protocolVersion: row.protocolVersion,
              value: value.data,
            },
          ];
        } catch {
          return [];
        }
      }),
    ).map(({ value }) => value);
    result.set(edge.id, assessments);
  }
  return result;
}

/**
 * Production KG-11 loader. It uses only newest valid node versions, exact
 * editor-confirmed edges, explicit relation/depth bounds and complete
 * contradiction coverage within the selected bounded domain.
 */
export async function loadPreparedSynthesisPacket(
  selectorInput: SynthesisSelector,
  client: PrismaClient = prisma,
): Promise<PreparedSubgraphEvidencePacket> {
  const selector = synthesisSelectorSchema.parse(selectorInput);
  const seriesSelection = selector.selection;
  const initialRows =
    seriesSelection.kind === "seed"
      ? await loadCurrentNodeRows(client, [seriesSelection.nodeId])
      : await loadCurrentNodeRows(client);
  if (initialRows.length > SYNTHESIS_TOPIC_SCAN_LIMIT) {
    throw new SynthesisEditorialError("Topic selection exceeds the bounded current-node scan.");
  }
  const mappedInitial = initialRows.flatMap((row) => {
    const mapped = mapEvidenceNode(row);
    return mapped ? [mapped] : [];
  });
  let seeds =
    seriesSelection.kind === "seed"
      ? mappedInitial.filter((node) => node.id === seriesSelection.nodeId)
      : mappedInitial
          .filter((node) =>
            topicMatches(node, canonicalizeEvidenceTopic(seriesSelection.canonicalQuery)),
          )
          .slice(0, selector.topicSeedLimit);
  if (seeds.length === 0)
    throw new SynthesisEditorialError("No valid current seed node found.", "not-found");
  seeds = [...seeds].sort((left, right) => compareCodeUnits(left.id, right.id));

  const nodes = new Map(seeds.map((node) => [node.id, node]));
  const edges = new Map<string, SubgraphEvidenceSource["edges"][number]>();
  let frontier = seeds.map((node) => node.id);
  for (let depth = 0; depth < selector.depth && frontier.length > 0; depth += 1) {
    const rows = await client.nodeEdge.findMany({
      where: {
        ...publicConfirmedNodeEdgeWhere,
        relationType: { in: selector.relationTypes },
        OR: [
          { sourceNodeVersion: { knowledgeNodeId: { in: frontier } } },
          { targetNodeId: { in: frontier } },
        ],
      },
      orderBy: { id: "asc" },
      take: selector.maxEdges + 1,
      include: {
        sourceNodeVersion: {
          include: {
            snapshot: { select: { commitSha: true } },
            knowledgeNode: {
              include: { repository: { select: { owner: true, name: true, canonicalUrl: true } } },
            },
          },
        },
        targetNode: {
          include: { repository: { select: { owner: true, name: true, canonicalUrl: true } } },
        },
        confirmedTargetNodeVersion: { include: { snapshot: { select: { commitSha: true } } } },
      },
    });
    if (rows.length > selector.maxEdges) {
      throw new SynthesisEditorialError("Edge selection exceeds the configured bound.");
    }
    const endpointIds = [
      ...new Set(rows.flatMap((row) => [row.sourceNodeVersion.knowledgeNodeId, row.targetNodeId])),
    ];
    const currentRows = await loadCurrentNodeRows(client, endpointIds);
    const current = new Map(
      currentRows.flatMap((row) => {
        const mapped = mapEvidenceNode(row);
        return mapped ? [[mapped.id, mapped] as const] : [];
      }),
    );
    const next = new Set<string>();
    for (const row of rows) {
      const source = current.get(row.sourceNodeVersion.knowledgeNodeId);
      const target = current.get(row.targetNodeId);
      if (
        !source ||
        !target ||
        source.versionId !== row.sourceNodeVersionId ||
        target.versionId !== row.confirmedTargetNodeVersionId ||
        !row.confirmedAt
      )
        continue;
      if (!nodes.has(source.id)) next.add(source.id);
      if (!nodes.has(target.id)) next.add(target.id);
      nodes.set(source.id, source);
      nodes.set(target.id, target);
      edges.set(row.id, {
        id: row.id,
        sourceNodeId: source.id,
        sourceVersionId: source.versionId,
        targetNodeId: target.id,
        targetVersionId: target.versionId,
        relationType: row.relationType as SubgraphEvidenceSource["edges"][number]["relationType"],
        status: "confirmed",
        provenance: "confirmed-by-editor",
        rationale: row.rationale ?? undefined,
        assertedAt: row.assertedAt?.toISOString(),
        confirmedAt: row.confirmedAt.toISOString(),
      });
    }
    if (nodes.size > selector.maxNodes || edges.size > selector.maxEdges) {
      throw new SynthesisEditorialError("Selected subgraph exceeds configured bounds.");
    }
    frontier = [...next].sort(compareCodeUnits);
  }

  const selectedNodes = [...nodes.values()].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
  const selectedEdges = [...edges.values()]
    .filter((edge) => nodes.has(edge.sourceNodeId) && nodes.has(edge.targetNodeId))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const trustByEdge = await loadAuthoritativeTrustByEdge(client, selectedEdges);
  const selection =
    seriesSelection.kind === "seed"
      ? { kind: "seed" as const, nodeId: seeds[0]!.id, versionId: seeds[0]!.versionId }
      : {
          kind: "topic" as const,
          canonicalQuery: canonicalizeEvidenceTopic(seriesSelection.canonicalQuery),
          seedNodeIds: seeds.map((node) => node.id),
        };
  const source: SubgraphEvidenceSource = {
    schemaVersion: "bounded-subgraph/1.0.0",
    selection,
    source: {
      kind: "bounded-supplied-subgraph",
      selectorFingerprint: fingerprintSubgraphEvidenceSelection(selection),
    },
    declaredCounts: {
      nodeCount: selectedNodes.length,
      edgeCount: selectedEdges.length,
      contradictionEdgeIds: selectedEdges
        .filter((edge) => edge.relationType === "contradicts")
        .map((edge) => edge.id),
    },
    nodes: selectedNodes,
    edges: selectedEdges.map((edge) => ({
      ...edge,
      trustAssessments: trustByEdge.get(edge.id) ?? [],
    })),
  };
  return buildPreparedSubgraphEvidencePacket(source);
}
