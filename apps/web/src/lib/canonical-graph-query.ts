import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  canonicalGraphEdgeSchema,
  canonicalGraphNodeVersionSchema,
  canonicalGraphResponseSchema,
  canonicalJson,
  nodeAliasSchema,
  publicGraphTrustSchema,
  TRUST_CRITERIA,
  type CanonicalGraphEdge,
  type CanonicalGraphNodeVersion,
  type CanonicalGraphQuery,
  type CanonicalGraphResponse,
} from "@oratlas/contracts";
import { getServerEnv } from "@oratlas/config";
import { type Prisma } from "@oratlas/db";
import { prisma } from "./db";
import { databaseGraphTrustProvider } from "./graph-trust-provider";
import { graphTrustLookupKey } from "./graph-trust";
import { publicConfirmedNodeEdgeWhere } from "./node-edge-publication";
import { readableCanonicalNodeVersionWhere } from "./public-snapshot-visibility";
import { resolveTrustAssessmentRows } from "./trust-provenance";

export class CanonicalGraphQueryError extends Error {
  constructor(
    message: string,
    readonly code: "bad-request" | "not-found" = "bad-request",
  ) {
    super(message);
  }
}

export interface CanonicalGraphQueryOptions {
  cursorSecret?: string;
}

const cursorSchema = z
  .object({
    v: z.literal(1),
    query: z.string().length(64),
    seedNodeVersionId: z.string().min(1).max(200),
    upperEdgeId: z.string().min(1).max(200),
    lastEdgeId: z.string().min(1).max(200),
  })
  .strict();

const repositorySelect = {
  id: true,
  owner: true,
  name: true,
  canonicalUrl: true,
} as const;

const nodeVersionInclude = {
  snapshot: { select: { id: true, commitSha: true } },
  knowledgeNode: {
    include: {
      repository: { select: repositorySelect },
      aliases: { orderBy: [{ scheme: "asc" }, { role: "asc" }, { value: "asc" }] },
    },
  },
} satisfies Prisma.KnowledgeNodeVersionInclude;

type LoadedEdge = Awaited<ReturnType<typeof loadIncidentEdges>>[number];
type LoadedCanonicalVersion = LoadedEdge["sourceNodeVersion"];

async function loadSeedVersion(query: CanonicalGraphQuery) {
  const node = await prisma.knowledgeNode.findUnique({
    where: { id: query.seed },
    include: {
      repository: { select: repositorySelect },
      aliases: { orderBy: [{ scheme: "asc" }, { role: "asc" }, { value: "asc" }] },
      versions: {
        where: {
          ...readableCanonicalNodeVersionWhere,
          ...(query.version ? { id: query.version } : {}),
        },
        include: { snapshot: { select: { id: true, commitSha: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
  });
  const version = node?.versions[0];
  return node && version ? { ...version, knowledgeNode: node } : null;
}

function authoritativeStatusWhere(status: CanonicalGraphQuery["status"]) {
  const sourceAssertion = {
    status: "source-assertion",
    provenance: "imported-from-review",
    confirmedTargetNodeVersionId: { not: null },
    confirmedById: null,
  } as const;
  if (status === "source-assertion") return sourceAssertion;
  if (status === "confirmed") return publicConfirmedNodeEdgeWhere;
  return { OR: [sourceAssertion, publicConfirmedNodeEdgeWhere] };
}

async function loadIncidentEdges(
  query: CanonicalGraphQuery,
  seedVersionId: string,
  upperEdgeId: string,
  afterEdgeId?: string,
) {
  const where = incidentEdgeWhere(query, seedVersionId);
  return prisma.nodeEdge.findMany({
    where: {
      ...where,
      id: { lte: upperEdgeId, ...(afterEdgeId ? { gt: afterEdgeId } : {}) },
    },
    include: {
      sourceNodeVersion: { include: nodeVersionInclude },
      confirmedTargetNodeVersion: { include: nodeVersionInclude },
      claimEvidenceRelation: {
        include: {
          claim: true,
          citation: true,
          trustAssessments: {
            include: { verification: true },
            orderBy: [{ assessedAt: "desc" }, { id: "asc" }],
          },
        },
      },
    },
    orderBy: { id: "asc" },
    take: query.limit + 1,
  });
}

function incidentEdgeWhere(
  query: CanonicalGraphQuery,
  seedVersionId: string,
): Prisma.NodeEdgeWhereInput {
  const source = query.version
    ? { sourceNodeVersionId: seedVersionId }
    : { sourceNodeVersion: { knowledgeNodeId: query.seed } };
  const target = query.version
    ? { targetNodeId: query.seed, confirmedTargetNodeVersionId: seedVersionId }
    : { targetNodeId: query.seed };
  const direction =
    query.direction === "outgoing"
      ? [source]
      : query.direction === "incoming"
        ? [target]
        : [source, target];
  return {
    AND: [authoritativeStatusWhere(query.status), { OR: direction }],
    ...(query.relationType ? { relationType: query.relationType } : {}),
    sourceNodeVersion: readableCanonicalNodeVersionWhere,
    confirmedTargetNodeVersion: readableCanonicalNodeVersionWhere,
  };
}

async function loadUpperEdgeId(
  query: CanonicalGraphQuery,
  seedVersionId: string,
): Promise<string | undefined> {
  const edge = await prisma.nodeEdge.findFirst({
    where: incidentEdgeWhere(query, seedVersionId),
    select: { id: true },
    orderBy: { id: "desc" },
  });
  return edge?.id;
}

function parseStoredJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new CanonicalGraphQueryError(`Stored ${label} is invalid; the record was not published.`);
  }
}

function mapNodeVersion(version: LoadedCanonicalVersion): CanonicalGraphNodeVersion {
  const node = version.knowledgeNode;
  const source = version.snapshotId
    ? { type: "repository-snapshot" as const, snapshotId: version.snapshotId }
    : version.sourceReviewVersionId
      ? { type: "review-version" as const, reviewVersionId: version.sourceReviewVersionId }
      : version.sourceClaimId
        ? { type: "claim-occurrence" as const, claimId: version.sourceClaimId }
        : version.sourceCitationId
          ? { type: "citation-occurrence" as const, citationId: version.sourceCitationId }
          : undefined;
  if (!source) {
    throw new CanonicalGraphQueryError("Canonical node version has no exact source binding.");
  }
  const repository =
    node.repository && version.snapshot
      ? {
          id: node.repository.id,
          owner: node.repository.owner,
          name: node.repository.name,
          canonicalUrl: node.repository.canonicalUrl,
          commitSha: version.snapshot.commitSha,
        }
      : undefined;
  return canonicalGraphNodeVersionSchema.parse({
    nodeId: node.id,
    nodeVersionId: version.id,
    stableKey: node.stableKey ?? undefined,
    localNodeId: node.localNodeId,
    originType: node.originType,
    kind: node.kind,
    source,
    repository,
    title: version.title ?? undefined,
    abstract: version.abstract ?? undefined,
    text: version.text ?? undefined,
    contributors: parseStoredJson(version.contributorsJson, "node contributors"),
    license: version.license ?? undefined,
    provenance: parseStoredJson(version.provenanceJson, "node provenance"),
    payload: parseStoredJson(version.payloadJson, "node payload"),
    aliases: node.aliases.flatMap((alias) => {
      const parsed = nodeAliasSchema.safeParse(alias);
      return parsed.success ? [parsed.data] : [];
    }),
    versionDoi: version.versionDoi ?? undefined,
    conceptDoi: version.conceptDoi ?? undefined,
    isExample: version.isExample,
    createdAt: version.createdAt.toISOString(),
  });
}

function edgeTrustKey(edge: LoadedEdge) {
  return {
    sourceVersionId: edge.sourceNodeVersionId,
    targetVersionId: edge.confirmedTargetNodeVersionId!,
    relationType: edge.relationType as CanonicalGraphEdge["relationType"],
  };
}

async function mapEdges(rows: readonly LoadedEdge[]): Promise<CanonicalGraphEdge[]> {
  const confirmed = rows.filter((edge) => edge.status === "confirmed");
  const trust = await databaseGraphTrustProvider.lookup(confirmed.map(edgeTrustKey));
  return rows.flatMap((row) => {
    const targetVersion = row.confirmedTargetNodeVersion;
    if (!targetVersion || targetVersion.knowledgeNodeId !== row.targetNodeId) return [];
    const rawTrust =
      row.status === "confirmed"
        ? trust.get(graphTrustLookupKey(edgeTrustKey(row)))
        : sourceAssertionTrust(row);
    const parsedTrust = publicGraphTrustSchema
      .array()
      .safeParse(Array.isArray(rawTrust) ? rawTrust : rawTrust ? [rawTrust] : []);
    const common = {
      id: row.id,
      sourceNodeId: row.sourceNodeVersion.knowledgeNodeId,
      sourceNodeVersionId: row.sourceNodeVersionId,
      targetNodeId: row.targetNodeId,
      targetNodeVersionId: targetVersion.id,
      relationType: row.relationType,
      rationale: row.rationale ?? undefined,
      assertedAt: row.assertedAt?.toISOString(),
      trustAssessments: parsedTrust.success ? parsedTrust.data : [],
    };
    const parsed = canonicalGraphEdgeSchema.safeParse(
      row.status === "source-assertion"
        ? { ...common, status: "source-assertion", provenance: row.provenance }
        : {
            ...common,
            status: "confirmed",
            provenance: row.provenance,
            confirmedAt: row.confirmedAt?.toISOString(),
          },
    );
    return parsed.success ? [parsed.data] : [];
  });
}

function sourceAssertionTrust(row: LoadedEdge): unknown[] {
  const relation = row.claimEvidenceRelation;
  if (!relation) return [];
  return relation.trustAssessments.map((assessment) => {
    const resolved = resolveTrustAssessmentRows(
      { assessment, relation, claim: relation.claim, citation: relation.citation },
      assessment.verification,
    );
    return {
      assessmentId: assessment.id,
      protocolVersion: assessment.protocolVersion,
      assessorType: assessment.assessorType,
      assessorId: assessment.assessorId ?? undefined,
      assessedAt: assessment.assessedAt?.toISOString(),
      conflictOfInterest: { status: assessment.conflictOfInterestStatus },
      reviewStatus: resolved.effectiveStatus,
      verificationState: resolved.state,
      assessedCriteria: TRUST_CRITERIA.filter((criterion) => assessment[criterion] !== null),
    };
  });
}

function queryFingerprint(query: CanonicalGraphQuery): string {
  const { cursor: _cursor, ...bound } = query;
  return createHash("sha256").update(canonicalJson(bound)).digest("hex");
}

function cursorSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signaturesMatch(payload: string, signature: string, secret: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== 32 || supplied.toString("base64url") !== signature) return false;
  return timingSafeEqual(createHmac("sha256", secret).update(payload).digest(), supplied);
}

function decodeCursor(
  cursor: string | undefined,
  fingerprint: string,
  seedNodeVersionId: string,
  secret: string,
): { lastEdgeId: string; upperEdgeId: string } | undefined {
  if (!cursor) return undefined;
  try {
    const separator = cursor.lastIndexOf(".");
    if (separator <= 0) throw new Error("missing signature");
    const payload = cursor.slice(0, separator);
    const signature = cursor.slice(separator + 1);
    if (!signaturesMatch(payload, signature, secret)) throw new Error("invalid signature");
    const decoded = cursorSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (decoded.query !== fingerprint || decoded.seedNodeVersionId !== seedNodeVersionId) {
      throw new Error("cursor context changed");
    }
    return { lastEdgeId: decoded.lastEdgeId, upperEdgeId: decoded.upperEdgeId };
  } catch {
    throw new CanonicalGraphQueryError(
      "Graph cursor is invalid or belongs to another node version or query.",
    );
  }
}

function encodeCursor(
  lastEdgeId: string,
  upperEdgeId: string,
  fingerprint: string,
  seedNodeVersionId: string,
  secret: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, query: fingerprint, seedNodeVersionId, upperEdgeId, lastEdgeId }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${cursorSignature(payload, secret)}`;
}

export async function queryCanonicalGraph(
  query: CanonicalGraphQuery,
  options: CanonicalGraphQueryOptions = {},
): Promise<CanonicalGraphResponse> {
  const seedVersion = await loadSeedVersion(query);
  if (!seedVersion) throw new CanonicalGraphQueryError("Seed node version not found.", "not-found");
  const secret = options.cursorSecret ?? getServerEnv().sessionSecret;
  const fingerprint = queryFingerprint(query);
  const cursor = decodeCursor(query.cursor, fingerprint, seedVersion.id, secret);
  const upperEdgeId = cursor?.upperEdgeId ?? (await loadUpperEdgeId(query, seedVersion.id));
  const rows = upperEdgeId
    ? await loadIncidentEdges(query, seedVersion.id, upperEdgeId, cursor?.lastEdgeId)
    : [];
  const pageRows = rows.slice(0, query.limit);
  const edges = await mapEdges(pageRows);
  if (edges.length !== pageRows.length) {
    throw new CanonicalGraphQueryError(
      "An authoritative graph edge failed exact-version validation; the page was not truncated.",
    );
  }
  const versions = new Map<string, CanonicalGraphNodeVersion>();
  versions.set(seedVersion.id, mapNodeVersion(seedVersion));
  for (const row of pageRows) {
    versions.set(row.sourceNodeVersion.id, mapNodeVersion(row.sourceNodeVersion));
    if (row.confirmedTargetNodeVersion) {
      versions.set(
        row.confirmedTargetNodeVersion.id,
        mapNodeVersion(row.confirmedTargetNodeVersion),
      );
    }
  }
  const last = pageRows.at(-1);
  return canonicalGraphResponseSchema.parse({
    schemaVersion: "2.0.0",
    seed: { nodeId: query.seed, nodeVersionId: seedVersion.id },
    nodes: [...versions.values()].sort(
      (left, right) =>
        left.nodeId.localeCompare(right.nodeId) ||
        left.nodeVersionId.localeCompare(right.nodeVersionId),
    ),
    edges,
    page: {
      limit: query.limit,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.id, upperEdgeId!, fingerprint, seedVersion.id, secret)
          : undefined,
    },
  });
}
