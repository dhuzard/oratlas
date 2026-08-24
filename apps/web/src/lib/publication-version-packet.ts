import "server-only";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  publicationClaimSelectorSchema,
  publicationClaimSourceBindingSchema,
  publicationClaimTargetSchema,
  publicationVersionPacketSchema,
  PUBLICATION_VERSION_PACKET_CAPTURE_LIMIT,
  PUBLICATION_VERSION_PACKET_OCCURRENCE_LIMIT,
  PUBLICATION_VERSION_PACKET_RELATION_LIMIT,
  type CanonicalGraphEdge,
} from "@oratlas/contracts";
import { prisma } from "./db";
import { resolveObservedPublicationBaseUrl } from "@oratlas/db";
import { queryCanonicalGraph } from "./canonical-graph-query";
import { publicConfirmedNodeEdgeWhere } from "./node-edge-publication";

export class PublicationVersionPacketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationVersionPacketError";
  }
}

export async function getPublicationVersionPacket(id: string) {
  const version = await prisma.publicationVersion.findUnique({
    where: { id },
    include: {
      publication: true,
      captures: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: PUBLICATION_VERSION_PACKET_CAPTURE_LIMIT + 1,
      },
      claimOccurrences: {
        include: { graphVersion: { select: { id: true } } },
        orderBy: [{ sourceLocalClaimId: "asc" }, { id: "asc" }],
        take: PUBLICATION_VERSION_PACKET_OCCURRENCE_LIMIT + 1,
      },
      _count: { select: { captures: true, claimOccurrences: true } },
    },
  });
  if (!version) throw new PublicationVersionPacketError("Publication version not found.");
  const observedBaseUrl = resolveObservedPublicationBaseUrl(version);
  if (!observedBaseUrl) {
    throw new PublicationVersionPacketError(
      "Publication version has no valid observed publication base URL.",
    );
  }

  const captures = version.captures.slice(0, PUBLICATION_VERSION_PACKET_CAPTURE_LIMIT);
  const occurrences = version.claimOccurrences.slice(
    0,
    PUBLICATION_VERSION_PACKET_OCCURRENCE_LIMIT,
  );
  const bindings = occurrences.flatMap((occurrence) =>
    occurrence.knowledgeNodeId && occurrence.graphVersion
      ? [
          {
            nodeId: occurrence.knowledgeNodeId,
            versionId: occurrence.graphVersion.id,
          },
        ]
      : [],
  );
  const totalRelations = bindings.length
    ? await prisma.nodeEdge.count({
        where: {
          ...publicConfirmedNodeEdgeWhere,
          OR: [
            { sourceNodeVersionId: { in: bindings.map((binding) => binding.versionId) } },
            { targetNodeId: { in: bindings.map((binding) => binding.nodeId) } },
          ],
        },
      })
    : 0;
  const relationMap = new Map<string, CanonicalGraphEdge>();
  for (const binding of bindings) {
    if (relationMap.size >= PUBLICATION_VERSION_PACKET_RELATION_LIMIT) break;
    let cursor: string | undefined;
    do {
      const graph = await queryCanonicalGraph({
        seed: binding.nodeId,
        version: binding.versionId,
        direction: "both",
        status: "confirmed",
        limit: Math.min(100, PUBLICATION_VERSION_PACKET_RELATION_LIMIT - relationMap.size),
        cursor,
      });
      for (const edge of graph.edges) relationMap.set(edge.id, edge);
      cursor = graph.page.nextCursor;
    } while (cursor && relationMap.size < PUBLICATION_VERSION_PACKET_RELATION_LIMIT);
  }
  const relations = [...relationMap.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  const packetWithoutDigest = {
    schemaVersion: "1.0.0" as const,
    publication: {
      id: version.publication.id,
      publicationType: version.publication.publicationType,
      recordSource: version.publication.recordSource,
      sourceLocalPublicationId: version.publication.sourceLocalPublicationId,
    },
    version: {
      id: version.id,
      sourcesSha256: version.sourcesSha256,
      sourceLocalPublicationId: version.sourceLocalPublicationId,
      versionLabel: version.versionLabel,
      title: version.title,
      publisherCanonicalUrl: version.canonicalUrl,
      observedPublicationBaseUrl: observedBaseUrl,
      adapterType: version.adapterType,
      structuralProvenance: version.structuralProvenance,
      observedAt: version.observedAt.toISOString(),
    },
    captures: captures.map((capture) => ({
      id: capture.id,
      artifactKind: capture.artifactKind,
      declaredPath: capture.declaredPath,
      requestedUrl: capture.requestedUrl,
      observedUrl: capture.observedUrl,
      contentSha256: capture.contentSha256,
      byteLength: capture.byteLength,
      structuralProvenance: capture.structuralProvenance,
    })),
    occurrences: occurrences.map((occurrence) => {
      if (!occurrence.publishedUrl) {
        throw new PublicationVersionPacketError(
          `Occurrence '${occurrence.id}' has no exact published target URL.`,
        );
      }
      const canonicalBinding =
        occurrence.knowledgeNodeId && occurrence.graphVersion
          ? {
              knowledgeNodeId: occurrence.knowledgeNodeId,
              knowledgeNodeVersionId: occurrence.graphVersion.id,
            }
          : null;
      return {
        id: occurrence.id,
        sourceLocalClaimId: occurrence.sourceLocalClaimId,
        publishedTargetUrl: occurrence.publishedUrl,
        target: publicationClaimTargetSchema.parse(JSON.parse(occurrence.targetJson)),
        sourceBinding: publicationClaimSourceBindingSchema.parse(
          JSON.parse(occurrence.sourceBindingJson),
        ),
        selector: publicationClaimSelectorSchema.parse(JSON.parse(occurrence.selectorJson)),
        declarationSha256: occurrence.declarationSha256,
        declarationAuthority: occurrence.declarationAuthority,
        text: occurrence.text,
        claimType: occurrence.claimType,
        qualification: occurrence.qualification,
        canonicalBinding,
        links: {
          occurrence: `/api/publication-claim-occurrences/${occurrence.id}`,
          canonicalGraph: canonicalBinding
            ? `/api/graph?seed=${encodeURIComponent(canonicalBinding.knowledgeNodeId)}&version=${encodeURIComponent(canonicalBinding.knowledgeNodeVersionId)}`
            : null,
          originalPublication: occurrence.publishedUrl,
        },
      };
    }),
    relations,
    challenges: [],
    completeness: {
      captures: section(captures.length, version._count.captures),
      occurrences: section(occurrences.length, version._count.claimOccurrences),
      relations: section(relations.length, totalRelations),
      challenges: section(0, 0),
    },
    links: {
      self: `/api/publication-versions/${version.id}/packet`,
      publication: `/api/publications/${version.publication.id}`,
      publicationVersion: `/api/publication-versions/${version.id}`,
    },
  };
  const sha256 = createHash("sha256").update(canonicalJson(packetWithoutDigest)).digest("hex");
  return publicationVersionPacketSchema.parse({ ...packetWithoutDigest, sha256 });
}

function section(returned: number, total: number) {
  return { returned, total, truncated: returned < total };
}
