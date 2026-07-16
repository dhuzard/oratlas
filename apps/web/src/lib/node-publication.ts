import "server-only";
import { z } from "zod";
import {
  claimNodePayloadSchema,
  codeNodePayloadSchema,
  datasetNodePayloadSchema,
  figureNodePayloadSchema,
  knowledgeNodeProvenanceSchema,
  manifestContributorSchema,
  publicNodeDetailSchema,
  publicNodeListResponseSchema,
  type KnowledgeNodeKind,
  type NodeArchiveQuery,
  type PublicNodeDetail,
  type PublicNodeIdentifier,
  type PublicNodeListResponse,
  type PublicNodeSummary,
  type PublicNodeVersion,
} from "@oratlas/contracts";
import { nodeFieldProvenanceSchema } from "@oratlas/extractor";
import { selectPreferredTrustAssessment } from "@oratlas/trust";
import { prisma } from "./db";
import { resolveTrustAssessmentRows } from "./trust-provenance";

/**
 * KG-07 replaces this predicate with the shared visibility policy. Keeping it
 * in one place prevents UI/API callers from inventing their own edge rules.
 */
export const publicNodeEdgeWhere = { status: "confirmed" } as const;

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

function nodeSummary(
  node: {
    id: string;
    localNodeId: string;
    kind: string;
    repository: { owner: string; name: string; canonicalUrl: string };
  },
  version: StoredVersion,
): PublicNodeSummary {
  return {
    id: node.id,
    localNodeId: node.localNodeId,
    kind: node.kind as KnowledgeNodeKind,
    title: version.title,
    abstract: version.abstract ?? undefined,
    repository: {
      owner: node.repository.owner,
      name: node.repository.name,
      url: node.repository.canonicalUrl,
    },
    currentVersionId: version.id,
    updatedAt: version.createdAt.toISOString(),
  };
}

const versionInclude = { snapshot: { select: { commitSha: true } } } as const;

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
): Promise<PublicNodeSummary[]> {
  const rows = await prisma.knowledgeNode.findMany({
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
  });
  return rows
    .filter((row) => row.versions[0])
    .map((row) => nodeSummary(row, row.versions[0]!))
    .sort(
      (left, right) =>
        compareCanonical(right.updatedAt, left.updatedAt) ||
        compareCanonical(left.title, right.title) ||
        compareCanonical(left.id, right.id),
    );
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
        include: {
          ...versionInclude,
          outgoingEdges: {
            where: publicNodeEdgeWhere,
            include: {
              targetNode: {
                include: {
                  repository: { select: { owner: true, name: true, canonicalUrl: true } },
                  versions: {
                    include: versionInclude,
                    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                    take: 1,
                  },
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
      incomingEdges: {
        where: publicNodeEdgeWhere,
        include: {
          sourceNodeVersion: {
            include: {
              snapshot: { select: { commitSha: true } },
              knowledgeNode: {
                include: {
                  repository: { select: { owner: true, name: true, canonicalUrl: true } },
                },
              },
            },
          },
        },
      },
      linkedClaims: {
        include: {
          reviewVersion: { include: { review: true } },
          evidenceRelations: {
            include: {
              citation: true,
              trustAssessments: { include: { verification: true } },
            },
          },
        },
      },
    },
  });
  if (!node || node.versions.length === 0) return null;
  const kind = node.kind as KnowledgeNodeKind;
  const selected = selectedVersionId
    ? node.versions.find((version) => version.id === selectedVersionId)
    : node.versions[0];
  if (!selected) return null;
  const currentVersionId = node.versions[0]!.id;

  const outgoing = selected.outgoingEdges.flatMap((edge) => {
    const relatedVersion = edge.targetNode.versions[0];
    if (!relatedVersion) return [];
    return [
      {
        id: edge.id,
        direction: "outgoing" as const,
        relationType: edge.relationType,
        provenance: edge.provenance,
        rationale: edge.rationale ?? undefined,
        assertedAt: edge.assertedAt?.toISOString(),
        relatedNode: nodeSummary(edge.targetNode, relatedVersion),
      },
    ];
  });
  const incoming = node.incomingEdges.map((edge) => ({
    id: edge.id,
    direction: "incoming" as const,
    relationType: edge.relationType,
    provenance: edge.provenance,
    rationale: edge.rationale ?? undefined,
    assertedAt: edge.assertedAt?.toISOString(),
    relatedNode: nodeSummary(
      edge.sourceNodeVersion.knowledgeNode,
      edge.sourceNodeVersion as StoredVersion,
    ),
  }));

  const trustContext = node.linkedClaims
    .filter((claim) => claim.reviewVersion.snapshotId === selected.snapshotId)
    .flatMap((claim) =>
      claim.evidenceRelations.map((relation) => {
        const preferred = selectPreferredTrustAssessment(
          relation.trustAssessments.map((assessment) => {
            const resolved = resolveTrustAssessmentRows(
              { assessment, relation, claim, citation: relation.citation },
              assessment.verification,
            );
            return {
              id: assessment.id,
              effectiveStatus: resolved.effectiveStatus,
              assessedAt: assessment.assessedAt?.toISOString() ?? null,
              value: { assessment, resolved },
            };
          }),
        )?.value;
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
          trust: preferred
            ? {
                reviewStatus: preferred.resolved.effectiveStatus,
                verificationState: preferred.resolved.state,
                aggregateScore: preferred.assessment.aggregateScore ?? undefined,
                aggregateMethod: preferred.assessment.aggregateMethod ?? undefined,
              }
            : undefined,
        };
      }),
    );

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
    version: mapVersion(kind, selected),
    versions: node.versions.map((version) => ({
      id: version.id,
      title: version.title,
      commitSha: version.snapshot.commitSha,
      createdAt: version.createdAt.toISOString(),
      isCurrent: version.id === currentVersionId,
    })),
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
