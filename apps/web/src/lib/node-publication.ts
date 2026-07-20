import "server-only";
import { z } from "zod";
import {
  claimNodePayloadSchema,
  codeNodePayloadSchema,
  datasetNodePayloadSchema,
  figureNodePayloadSchema,
  knowledgeNodeKindSchema,
  knowledgeNodeProvenanceSchema,
  manifestContributorSchema,
  publicNodeDetailSchema,
  publicNodeListResponseSchema,
  SUBGRAPH_EVIDENCE_LIMITS,
  type KnowledgeNodeKind,
  type NodeArchiveQuery,
  type PublicNodeDetail,
  type PublicNodeIdentifier,
  type PublicNodeListResponse,
  type PublicRelatedNodeVersion,
  type PublicNodeSummary,
  type PublicNodeVersion,
} from "@oratlas/contracts";
import { nodeFieldProvenanceSchema } from "@oratlas/extractor";
import { orderTrustAssessments } from "@oratlas/trust";
import type { PrismaClient } from "@oratlas/db";
import { prisma } from "./db";
import {
  hasOwnedConfirmedTargetVersion,
  publicConfirmedNodeEdgeWhere,
} from "./node-edge-publication";
import {
  loadedNodeRelationTrustInclude,
  PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT,
  resolveTrustAssessmentRows,
  projectPublicNodeRelationTrustAssessments,
} from "./trust-provenance";

const storedNodeProvenanceSchema = z.union([
  knowledgeNodeProvenanceSchema,
  z
    .object({
      declared: knowledgeNodeProvenanceSchema,
      extractedFields: z.record(z.string(), nodeFieldProvenanceSchema),
      sourcePath: z.string().min(1).max(512),
      sourcePointer: z.string().min(1).max(512),
    })
    .strict(),
]);

const contributorsSchema = z.array(manifestContributorSchema).max(200);

// POC request-work ceilings. Exact historical URLs remain addressable beyond the
// history window, but archive totals and list/history surfaces intentionally cap
// their scanned cardinality until KG-08 supplies database-native graph/search cursors.
export const PUBLIC_NODE_SEARCH_LIMIT = 2_000;
const PUBLIC_NODE_SEARCH_BATCH_SIZE = 200;
const PUBLIC_NODE_VERSION_LIMIT = 200;
const PUBLIC_NODE_EDGE_LIMIT = 200;
const PUBLIC_NODE_TRUST_RELATION_LIMIT = 200;
const PUBLIC_NODE_TRUST_ASSESSMENT_LIMIT = 50;

export type ExactPublicNodeVersionProjection = {
  id: string;
  localNodeId: string;
  kind: KnowledgeNodeKind;
  repository: { owner: string; name: string; url: string };
  version: PublicNodeVersion;
};

export interface PublicNodeSummaryScan {
  items: PublicNodeSummary[];
  scannedCandidateCount: number;
  candidateLimit: typeof PUBLIC_NODE_SEARCH_LIMIT;
  candidateLimitReached: boolean;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Stored ${label} is not valid JSON.`);
  }
}

function payloadSchema(kind: KnowledgeNodeKind) {
  switch (kind) {
    case "claim":
      return claimNodePayloadSchema;
    case "figure":
      return figureNodePayloadSchema;
    case "dataset":
      return datasetNodePayloadSchema;
    case "code":
      return codeNodePayloadSchema;
  }
}

function isExampleDoi(value: string): boolean {
  return /^10\.5555\//i.test(value);
}

function identifiersFor(
  version: { versionDoi: string | null; conceptDoi: string | null },
  kind: KnowledgeNodeKind,
  payload: unknown,
): PublicNodeIdentifier[] {
  const identifiers: PublicNodeIdentifier[] = [];
  const add = (role: PublicNodeIdentifier["role"], value: string | null | undefined) => {
    if (value) identifiers.push({ scheme: "doi", role, value, isExample: isExampleDoi(value) });
  };
  add("version-doi", version.versionDoi);
  add("concept-doi", version.conceptDoi);
  if (kind === "dataset") add("artifact-doi", datasetNodePayloadSchema.parse(payload).doi);
  return identifiers;
}

type StoredVersion = {
  id: string;
  snapshotId: string;
  title: string;
  abstract: string | null;
  text: string | null;
  contributorsJson: string;
  license: string;
  provenanceJson: string;
  payloadJson: string;
  versionDoi: string | null;
  conceptDoi: string | null;
  isExample: boolean;
  createdAt: Date;
  snapshot: { commitSha: string };
};

function mapVersion(kind: KnowledgeNodeKind, version: StoredVersion): PublicNodeVersion {
  const contributors = contributorsSchema.parse(
    parseJson(version.contributorsJson, "contributors"),
  );
  const storedProvenance = storedNodeProvenanceSchema.parse(
    parseJson(version.provenanceJson, "node provenance"),
  );
  const provenance = "declared" in storedProvenance ? storedProvenance.declared : storedProvenance;
  const payload = payloadSchema(kind).parse(parseJson(version.payloadJson, `${kind} payload`));
  return publicNodeDetailSchema.shape.version.parse({
    id: version.id,
    snapshotId: version.snapshotId,
    commitSha: version.snapshot.commitSha,
    kind,
    title: version.title,
    abstract: version.abstract ?? undefined,
    text: version.text ?? undefined,
    contributors,
    license: version.license,
    provenance,
    payload,
    identifiers: identifiersFor(version, kind, payload),
    isExample: version.isExample,
    createdAt: version.createdAt.toISOString(),
  });
}

function tryMapVersion(
  kind: KnowledgeNodeKind,
  version: StoredVersion,
): PublicNodeVersion | undefined {
  try {
    return mapVersion(kind, version);
  } catch {
    return undefined;
  }
}

export function tryMapPublicNodeVersion(
  node: { kind: string },
  version: StoredVersion,
): PublicNodeVersion | undefined {
  const kind = knowledgeNodeKindSchema.safeParse(node.kind);
  return kind.success ? tryMapVersion(kind.data, version) : undefined;
}

function nodeSummary(
  node: {
    id: string;
    localNodeId: string;
    kind: string;
    repository: { owner: string; name: string; canonicalUrl: string };
  },
  version: PublicNodeVersion,
): PublicNodeSummary {
  return {
    id: node.id,
    localNodeId: node.localNodeId,
    kind: version.kind,
    title: version.title,
    abstract: version.abstract,
    repository: {
      owner: node.repository.owner,
      name: node.repository.name,
      url: node.repository.canonicalUrl,
    },
    currentVersionId: version.id,
    updatedAt: version.createdAt,
  };
}

function relatedNodeVersion(
  node: {
    id: string;
    localNodeId: string;
    kind: string;
    repository: { owner: string; name: string; canonicalUrl: string };
  },
  version: PublicNodeVersion,
): PublicRelatedNodeVersion {
  const summary = nodeSummary(node, version);
  const { currentVersionId: versionId, updatedAt: versionCreatedAt, ...stableNode } = summary;
  return { ...stableNode, versionId, versionCreatedAt };
}

function tryRelatedNodeVersion(
  node: {
    id: string;
    localNodeId: string;
    kind: string;
    repository: { owner: string; name: string; canonicalUrl: string };
  },
  version: StoredVersion,
): PublicRelatedNodeVersion | undefined {
  const mapped = tryMapPublicNodeVersion(node, version);
  return mapped ? relatedNodeVersion(node, mapped) : undefined;
}

const versionInclude = { snapshot: { select: { commitSha: true } } } as const;

/**
 * Batch exact-version availability projection for immutable packet readers.
 * The newest stored version must still parse before an older exact version can
 * be served, matching getPublicNode's no-history-fallback publication rule.
 */
export async function getExactPublicNodeVersions(
  requested: readonly { nodeId: string; nodeVersionId: string }[],
  client = prisma,
): Promise<Map<string, ExactPublicNodeVersionProjection>> {
  if (requested.length > SUBGRAPH_EVIDENCE_LIMITS.maxNodes) return new Map();
  const requestedByNode = new Map<string, string>();
  for (const item of requested) {
    const previous = requestedByNode.get(item.nodeId);
    if (previous && previous !== item.nodeVersionId) return new Map();
    requestedByNode.set(item.nodeId, item.nodeVersionId);
  }
  if (requestedByNode.size !== requested.length) return new Map();

  const rows = await client.knowledgeNode.findMany({
    where: { id: { in: [...requestedByNode.keys()] } },
    include: {
      repository: { select: { owner: true, name: true, canonicalUrl: true } },
      versions: {
        include: versionInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
    orderBy: { id: "asc" },
    take: SUBGRAPH_EVIDENCE_LIMITS.maxNodes,
  });
  const validRows = new Map<
    string,
    {
      row: (typeof rows)[number];
      current: PublicNodeVersion;
      requestedVersionId: string;
    }
  >();
  const historical: Array<{ nodeId: string; nodeVersionId: string }> = [];
  for (const row of rows) {
    const requestedVersionId = requestedByNode.get(row.id);
    const storedCurrent = row.versions[0];
    if (!requestedVersionId || !storedCurrent) continue;
    const current = tryMapPublicNodeVersion(row, storedCurrent);
    if (!current) continue;
    validRows.set(row.id, { row, current, requestedVersionId });
    if (current.id !== requestedVersionId) {
      historical.push({ nodeId: row.id, nodeVersionId: requestedVersionId });
    }
  }

  const historicalRows =
    historical.length === 0
      ? []
      : await client.knowledgeNodeVersion.findMany({
          where: {
            OR: historical.map((item) => ({
              id: item.nodeVersionId,
              knowledgeNodeId: item.nodeId,
            })),
          },
          include: versionInclude,
          orderBy: { id: "asc" },
          take: SUBGRAPH_EVIDENCE_LIMITS.maxNodes,
        });
  const historicalByKey = new Map(
    historicalRows.map((version) => [`${version.knowledgeNodeId}\u0000${version.id}`, version]),
  );
  const result = new Map<string, ExactPublicNodeVersionProjection>();
  for (const { row, current, requestedVersionId } of validRows.values()) {
    const stored =
      current.id === requestedVersionId
        ? row.versions[0]!
        : historicalByKey.get(`${row.id}\u0000${requestedVersionId}`);
    const version =
      current.id === requestedVersionId
        ? current
        : stored
          ? tryMapPublicNodeVersion(row, stored)
          : undefined;
    if (!version || version.id !== requestedVersionId) continue;
    result.set(`${row.id}\u0000${version.id}`, {
      id: row.id,
      localNodeId: row.localNodeId,
      kind: version.kind,
      repository: {
        owner: row.repository.owner,
        name: row.repository.name,
        url: row.repository.canonicalUrl,
      },
      version,
    });
  }
  return result;
}

export async function listPublicNodes(query: NodeArchiveQuery): Promise<PublicNodeListResponse> {
  const rows = await listPublicNodeSummaries(query.kind);
  const needle = query.q ? canonicalFold(query.q.trim()) : undefined;
  const matching = rows.filter((row) => {
    if (!needle) return true;
    return [row.title, row.abstract, row.localNodeId, row.repository.owner, row.repository.name]
      .filter((value): value is string => Boolean(value))
      .some((value) => canonicalFold(value).includes(needle));
  });
  const start = (query.page - 1) * query.pageSize;
  return publicNodeListResponseSchema.parse({
    total: matching.length,
    page: query.page,
    pageSize: query.pageSize,
    items: matching.slice(start, start + query.pageSize),
  });
}

export async function listPublicNodeSummaries(
  kind?: KnowledgeNodeKind,
  client: PrismaClient = prisma,
): Promise<PublicNodeSummary[]> {
  return (await scanPublicNodeSummaries(kind, client)).items;
}

/**
 * Deterministically scans a bounded set of stored node identities. The final
 * page includes one unprojected probe row so callers can distinguish a
 * complete scan from a raw-candidate ceiling even when corrupt current heads
 * reduce the number of public summaries.
 */
export async function scanPublicNodeSummaries(
  kind?: KnowledgeNodeKind,
  client: PrismaClient = prisma,
): Promise<PublicNodeSummaryScan> {
  const items: PublicNodeSummary[] = [];
  let scannedCandidateCount = 0;
  let cursor: string | undefined;
  let remaining = PUBLIC_NODE_SEARCH_LIMIT;
  let candidateLimitReached = false;

  while (remaining > 0) {
    const pageSize = Math.min(PUBLIC_NODE_SEARCH_BATCH_SIZE, remaining);
    const isFinalBoundedPage = pageSize === remaining;
    const page = await client.knowledgeNode.findMany({
      where: {
        versions: { some: {} },
        ...(kind ? { kind } : {}),
      },
      include: {
        repository: { select: { owner: true, name: true, canonicalUrl: true } },
        versions: {
          include: versionInclude,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
        },
      },
      orderBy: { id: "asc" },
      take: pageSize + (isFinalBoundedPage ? 1 : 0),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const acceptedPage = page.slice(0, pageSize);
    scannedCandidateCount += acceptedPage.length;
    for (const row of acceptedPage) {
      const storedCurrent = row.versions[0];
      if (!storedCurrent) continue;
      const current = tryMapPublicNodeVersion(row, storedCurrent);
      if (current) items.push(nodeSummary(row, current));
    }
    remaining -= acceptedPage.length;
    if (isFinalBoundedPage) {
      candidateLimitReached = page.length > acceptedPage.length;
      break;
    }
    if (acceptedPage.length < pageSize) break;
    cursor = acceptedPage.at(-1)!.id;
  }

  items.sort(
    (left, right) =>
      compareCanonical(right.updatedAt, left.updatedAt) ||
      compareCanonical(left.title, right.title) ||
      compareCanonical(left.id, right.id),
  );
  return {
    items,
    scannedCandidateCount,
    candidateLimit: PUBLIC_NODE_SEARCH_LIMIT,
    candidateLimitReached,
  };
}

export async function getPublicNode(
  id: string,
  selectedVersionId?: string,
): Promise<PublicNodeDetail | null> {
  const node = await prisma.knowledgeNode.findUnique({
    where: { id },
    include: {
      repository: { select: { owner: true, name: true, canonicalUrl: true } },
      versions: {
        include: versionInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PUBLIC_NODE_VERSION_LIMIT,
      },
    },
  });
  if (!node || node.versions.length === 0) return null;
  const parsedKind = knowledgeNodeKindSchema.safeParse(node.kind);
  if (!parsedKind.success) return null;
  const kind = parsedKind.data;
  const storedCurrent = node.versions[0]!;
  const current = tryMapVersion(kind, storedCurrent);
  // Never fall back to an older valid version when the newest stored version is corrupt.
  if (!current) return null;

  let selectedStored = selectedVersionId
    ? node.versions.find((version) => version.id === selectedVersionId)
    : storedCurrent;
  if (!selectedStored && selectedVersionId) {
    selectedStored =
      (await prisma.knowledgeNodeVersion.findFirst({
        where: { id: selectedVersionId, knowledgeNodeId: node.id },
        include: versionInclude,
      })) ?? undefined;
  }
  if (!selectedStored) return null;
  const selected =
    selectedStored.id === storedCurrent.id ? current : tryMapVersion(kind, selectedStored);
  if (!selected) return null;
  const currentVersionId = current.id;
  const historyVersions = node.versions.some((version) => version.id === selectedStored.id)
    ? node.versions
    : [...node.versions, selectedStored];

  const [outgoingRows, incomingRows, trustRelations] = await Promise.all([
    prisma.nodeEdge.findMany({
      where: { ...publicConfirmedNodeEdgeWhere, sourceNodeVersionId: selectedStored.id },
      include: {
        confirmedTargetNodeVersion: {
          include: {
            ...versionInclude,
            knowledgeNode: {
              include: {
                repository: { select: { owner: true, name: true, canonicalUrl: true } },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: PUBLIC_NODE_EDGE_LIMIT,
    }),
    prisma.nodeEdge.findMany({
      where: {
        ...publicConfirmedNodeEdgeWhere,
        targetNodeId: node.id,
        confirmedTargetNodeVersionId: selectedStored.id,
        relationType: "contradicts",
      },
      include: {
        confirmedTargetNodeVersion: { select: { knowledgeNodeId: true } },
        sourceNodeVersion: {
          include: {
            ...versionInclude,
            knowledgeNode: {
              include: {
                repository: { select: { owner: true, name: true, canonicalUrl: true } },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: PUBLIC_NODE_EDGE_LIMIT,
    }),
    prisma.claimEvidenceRelation.findMany({
      where: {
        claim: {
          knowledgeNodeId: node.id,
          reviewVersion: { snapshotId: selectedStored.snapshotId },
        },
      },
      include: {
        claim: { include: { reviewVersion: { include: { review: true } } } },
        citation: true,
        trustAssessments: {
          include: { verification: true },
          orderBy: [{ assessedAt: "desc" }, { id: "desc" }],
          take: PUBLIC_NODE_TRUST_ASSESSMENT_LIMIT,
        },
      },
      orderBy: { id: "asc" },
      take: PUBLIC_NODE_TRUST_RELATION_LIMIT,
    }),
  ]);

  const publicEdgeIds = [...outgoingRows, ...incomingRows].map((edge) => edge.id);
  const nodeTrustByEdge = new Map<
    string,
    {
      assessmentId: string;
      protocolVersion: string;
      assessorType: string;
      assessorId?: string;
      assessedAt?: string;
      reviewStatus:
        "unverified-import" | "agent-proposed" | "human-reviewed" | "adjudicated" | "superseded";
      verificationState:
        "platform-verified" | "unverified-import" | "stale-verification" | "legacy-unknown";
    }[]
  >();
  if (publicEdgeIds.length > 0) {
    const trustRows = await prisma.nodeRelationTrustAssessment.findMany({
      where: {
        proposal: {
          confirmedEdgeId: { in: [...new Set(publicEdgeIds)] },
          status: "confirmed",
        },
      },
      include: loadedNodeRelationTrustInclude,
      orderBy: [{ assessedAt: "desc" }, { id: "asc" }],
      take: PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT + 1,
    });
    // A repository can import adversarially many assessments. Fail closed for
    // this optional projection if the one global bound is exceeded.
    if (trustRows.length <= PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT) {
      const candidates = new Map<string, typeof trustRows>();
      for (const assessment of trustRows) {
        const edgeId = assessment.proposal.confirmedEdgeId;
        if (!edgeId) continue;
        const list = candidates.get(edgeId) ?? [];
        list.push(assessment);
        candidates.set(edgeId, list);
      }
      for (const [edgeId, values] of candidates) {
        nodeTrustByEdge.set(edgeId, projectPublicNodeRelationTrustAssessments(values));
      }
    }
  }

  const outgoing = outgoingRows.flatMap((edge) => {
    if (!hasOwnedConfirmedTargetVersion(edge)) return [];
    const relatedNode = tryRelatedNodeVersion(
      edge.confirmedTargetNodeVersion.knowledgeNode,
      edge.confirmedTargetNodeVersion as StoredVersion,
    );
    if (!relatedNode) return [];
    return [
      {
        id: edge.id,
        direction: "outgoing" as const,
        relationType: edge.relationType,
        provenance: edge.provenance,
        rationale: edge.rationale ?? undefined,
        assertedAt: edge.assertedAt?.toISOString(),
        trustAssessments: nodeTrustByEdge.get(edge.id) ?? [],
        relatedNode,
      },
    ];
  });
  const incoming = incomingRows.flatMap((edge) => {
    if (!hasOwnedConfirmedTargetVersion(edge)) return [];
    const relatedNode = tryRelatedNodeVersion(
      edge.sourceNodeVersion.knowledgeNode,
      edge.sourceNodeVersion as StoredVersion,
    );
    if (!relatedNode) return [];
    return [
      {
        id: edge.id,
        direction: "incoming" as const,
        relationType: edge.relationType,
        provenance: edge.provenance,
        rationale: edge.rationale ?? undefined,
        assertedAt: edge.assertedAt?.toISOString(),
        trustAssessments: nodeTrustByEdge.get(edge.id) ?? [],
        relatedNode,
      },
    ];
  });

  const trustContext = trustRelations.map((relation) => {
    const claim = relation.claim;
    const assessments = orderTrustAssessments(
      relation.trustAssessments.map((assessment) => {
        const resolved = resolveTrustAssessmentRows(
          { assessment, relation, claim, citation: relation.citation },
          assessment.verification,
        );
        return {
          id: assessment.id,
          assessedAt: assessment.assessedAt?.toISOString() ?? null,
          assessorType: assessment.assessorType,
          assessorId: assessment.assessorId,
          protocolVersion: assessment.protocolVersion,
          value: { assessment, resolved },
        };
      }),
    ).map(({ value }) => value);
    return {
      claimId: claim.id,
      claimLocalId: claim.localClaimId,
      reviewSlug: claim.reviewVersion.review.slug,
      reviewVersionId: claim.reviewVersion.id,
      citationId: relation.citation.id,
      citationLocalId: relation.citation.localCitationId,
      citationTitle: relation.citation.title ?? undefined,
      citationDoi: relation.citation.doi ?? undefined,
      citationIsExample: citationIsExample(
        relation.citation.doi,
        relation.citation.rawCitationJson,
      ),
      relationType: relation.relationType,
      trustAssessments: assessments.map(({ assessment, resolved }) => ({
        assessmentId: assessment.id,
        protocolVersion: assessment.protocolVersion,
        assessorType: assessment.assessorType,
        assessorId: assessment.assessorId ?? undefined,
        assessedAt: assessment.assessedAt?.toISOString(),
        reviewStatus: resolved.effectiveStatus,
        verificationState: resolved.state,
        aggregateScore: assessment.aggregateScore ?? undefined,
        aggregateMethod: assessment.aggregateMethod ?? undefined,
      })),
    };
  });

  const publicHistoryVersions = historyVersions.flatMap((storedVersion) => {
    const version =
      storedVersion.id === current.id
        ? current
        : storedVersion.id === selected.id
          ? selected
          : tryMapVersion(kind, storedVersion);
    if (!version) return [];
    return [
      {
        id: version.id,
        title: version.title,
        commitSha: version.commitSha,
        createdAt: version.createdAt,
        isCurrent: version.id === currentVersionId,
      },
    ];
  });

  return publicNodeDetailSchema.parse({
    schemaVersion: "1.0.0",
    id: node.id,
    localNodeId: node.localNodeId,
    kind,
    repository: {
      owner: node.repository.owner,
      name: node.repository.name,
      url: node.repository.canonicalUrl,
    },
    version: selected,
    versions: publicHistoryVersions,
    edges: [...outgoing, ...incoming].sort(
      (left, right) =>
        compareCanonical(left.direction, right.direction) ||
        compareCanonical(left.relationType, right.relationType) ||
        compareCanonical(left.id, right.id),
    ),
    trustContext,
  });
}

function citationIsExample(doi: string | null, raw: string | null): boolean {
  // Reserved example DOIs must never become live links, even when legacy raw citation
  // metadata is absent or malformed. The DOI itself is the authoritative safety signal.
  if (doi && isExampleDoi(doi)) return true;
  if (!raw) return false;
  try {
    const parsed = z
      .object({ isExample: z.boolean().optional() })
      .passthrough()
      .parse(JSON.parse(raw));
    return parsed.isExample === true;
  } catch {
    return false;
  }
}

function canonicalFold(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function compareCanonical(left: string, right: string): number {
  const foldedLeft = canonicalFold(left);
  const foldedRight = canonicalFold(right);
  return foldedLeft < foldedRight
    ? -1
    : foldedLeft > foldedRight
      ? 1
      : left < right
        ? -1
        : left > right
          ? 1
          : 0;
}
