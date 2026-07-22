import "server-only";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  subgraphEvidencePacketSchema,
  SUBGRAPH_EVIDENCE_LIMITS,
  type PublicSynthesisReview,
  type SubgraphEvidencePacket,
} from "@oratlas/contracts";
import { type PrismaClient } from "@oratlas/db";
import { prisma } from "./db";
import {
  getExactPublicNodeVersions,
  type ExactPublicNodeVersionProjection,
} from "./node-publication";

export type SynthesisCitationReadingContext = {
  referenceId: string;
  nodeId: string;
  nodeVersionId: string;
  nodeKind: PublicSynthesisReview["citations"][number]["nodeKind"];
  repository: { owner: string; name: string; url: string };
  provenance: {
    commitSha: string;
    sourcePath: string;
    sourcePointer?: string;
    license: string;
  };
  trust: Array<{
    subject: string;
    reviewStatus: string;
    verificationState: string;
  }>;
  disputes: Array<{
    relatedNodeId: string;
    relatedNodeVersionId: string;
    relatedTitle: string;
    provenance: string;
  }>;
};

export type SynthesisReadingContext = {
  citations: Map<string, SynthesisCitationReadingContext>;
  disputedReferenceIds: Set<string>;
};

type ExactNodeLoader = typeof getExactPublicNodeVersions;

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function loadAcceptedPacket(
  synthesis: PublicSynthesisReview,
  client: PrismaClient,
): Promise<SubgraphEvidencePacket | null> {
  const review = await client.review.findFirst({
    where: {
      slug: synthesis.slug,
      reviewType: "ai-synthesis",
      status: "published",
      currentSynthesisVersionId: synthesis.version.id,
    },
    select: {
      id: true,
      slug: true,
      reviewType: true,
      status: true,
      currentSynthesisVersionId: true,
      currentSynthesisVersion: {
        select: {
          id: true,
          reviewId: true,
          recordSourceType: true,
          publicState: true,
          isExample: true,
          synthesisDraftId: true,
          synthesisPacketHash: true,
          synthesisDocumentHash: true,
          synthesisDraft: {
            select: {
              id: true,
              reviewId: true,
              status: true,
              packetJson: true,
              packetHash: true,
              documentHash: true,
            },
          },
        },
      },
    },
  });
  const version = review?.currentSynthesisVersion;
  const draft = version?.synthesisDraft;
  if (
    !review ||
    review.slug !== synthesis.slug ||
    review.reviewType !== "ai-synthesis" ||
    review.status !== "published" ||
    review.currentSynthesisVersionId !== synthesis.version.id ||
    !version ||
    version.id !== synthesis.version.id ||
    version.reviewId !== review.id ||
    version.recordSourceType !== "synthesis" ||
    version.publicState !== "published" ||
    version.isExample !== false ||
    !draft ||
    version.synthesisDraftId !== draft.id ||
    draft.reviewId !== review.id ||
    draft.status !== "accepted" ||
    version.synthesisPacketHash !== synthesis.provenance.packetHash ||
    version.synthesisPacketHash !== draft.packetHash ||
    version.synthesisDocumentHash !== synthesis.provenance.documentHash ||
    version.synthesisDocumentHash !== draft.documentHash ||
    digest(draft.packetJson) !== draft.packetHash
  ) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(draft.packetJson) as unknown;
  } catch {
    return null;
  }
  const parsed = subgraphEvidencePacketSchema.safeParse(value);
  if (!parsed.success || canonicalJson(parsed.data) !== draft.packetJson) return null;
  return parsed.data;
}

function citationBindings(synthesis: PublicSynthesisReview, packet: SubgraphEvidencePacket) {
  if (
    synthesis.citations.length > 2_000 ||
    packet.nodes.length > SUBGRAPH_EVIDENCE_LIMITS.maxNodes
  ) {
    return null;
  }
  const references = new Map(
    packet.references.map((reference) => [reference.referenceId, reference]),
  );
  const nodes = new Map(packet.nodes.map((node) => [node.id, node]));
  const citations = new Map<string, PublicSynthesisReview["citations"][number]>();
  for (const citation of synthesis.citations) {
    const previous = citations.get(citation.referenceId);
    if (
      previous &&
      (previous.nodeId !== citation.nodeId ||
        previous.nodeVersionId !== citation.nodeVersionId ||
        previous.nodeKind !== citation.nodeKind ||
        previous.title !== citation.title ||
        previous.href !== citation.href ||
        previous.identifierScheme !== citation.identifierScheme ||
        previous.identifierRole !== citation.identifierRole ||
        previous.identifierValue !== citation.identifierValue)
    ) {
      return null;
    }
    const reference = references.get(citation.referenceId);
    const node = nodes.get(citation.nodeId);
    if (
      !reference ||
      reference.nodeId !== citation.nodeId ||
      reference.nodeVersionId !== citation.nodeVersionId ||
      !node ||
      node.versionId !== citation.nodeVersionId ||
      node.kind !== citation.nodeKind ||
      node.title !== citation.title ||
      node.isExample !== false ||
      citation.href !== `/nodes/${node.id}/versions/${node.versionId}` ||
      (reference.kind === "node" &&
        (citation.identifierScheme !== undefined ||
          citation.identifierRole !== undefined ||
          citation.identifierValue !== undefined)) ||
      (reference.kind === "identifier" &&
        (citation.identifierScheme !== reference.scheme ||
          citation.identifierRole !== reference.role ||
          citation.identifierValue !== reference.value))
    ) {
      return null;
    }
    citations.set(citation.referenceId, citation);
  }
  if (
    citations.size >
    SUBGRAPH_EVIDENCE_LIMITS.maxNodes + SUBGRAPH_EVIDENCE_LIMITS.maxIdentifiers
  ) {
    return null;
  }
  return { citations, nodes };
}

function samePublicPacketNode(
  projection: ExactPublicNodeVersionProjection,
  packetNode: SubgraphEvidencePacket["nodes"][number],
) {
  const publicNode = {
    id: projection.id,
    localNodeId: projection.localNodeId,
    repository: projection.repository,
    versionId: projection.version.id,
    snapshotId: projection.version.snapshotId,
    commitSha: projection.version.commitSha,
    kind: projection.version.kind,
    title: projection.version.title,
    abstract: projection.version.abstract,
    text: projection.version.text,
    contributors: projection.version.contributors,
    license: projection.version.license,
    provenance: projection.version.provenance,
    payload: projection.version.payload,
    identifiers: projection.version.identifiers,
    isExample: projection.version.isExample,
    createdAt: projection.version.createdAt,
  };
  return (
    projection.kind === projection.version.kind &&
    publicNode.isExample === false &&
    packetNode.isExample === false &&
    canonicalJson(publicNode) === canonicalJson(packetNode)
  );
}

/**
 * Re-verifies the exact accepted private packet, then exposes only bounded
 * public-safe display context. Packet bytes never leave this server module.
 */
export async function loadSynthesisReadingContext(
  synthesis: PublicSynthesisReview,
  client: PrismaClient = prisma,
  exactNodeLoader: ExactNodeLoader = getExactPublicNodeVersions,
): Promise<SynthesisReadingContext | null> {
  const packet = await loadAcceptedPacket(synthesis, client);
  if (!packet) return null;
  const bindings = citationBindings(synthesis, packet);
  if (!bindings) return null;
  const requested = [
    ...new Map(
      [...bindings.citations.values()].map((citation) => [
        citation.nodeId,
        { nodeId: citation.nodeId, nodeVersionId: citation.nodeVersionId },
      ]),
    ).values(),
  ];
  const projected = await exactNodeLoader(requested, client);
  if (projected.size !== requested.length) return null;
  for (const request of requested) {
    const packetNode = bindings.nodes.get(request.nodeId);
    if (!packetNode || packetNode.versionId !== request.nodeVersionId) return null;
    const projection = projected.get(`${packetNode.id}\u0000${packetNode.versionId}`);
    if (!projection || !samePublicPacketNode(projection, packetNode)) return null;
  }

  const citedVersions = new Set(
    [...bindings.citations.values()].map(
      (citation) => `${citation.nodeId}\u0000${citation.nodeVersionId}`,
    ),
  );
  const contexts = new Map<string, SynthesisCitationReadingContext>();
  const disputedReferenceIds = new Set<string>();
  for (const [referenceId, citation] of [...bindings.citations].sort(([left], [right]) =>
    compare(left, right),
  )) {
    const node = bindings.nodes.get(citation.nodeId)!;
    const trust = packet.edges
      .filter(
        (edge) =>
          ((edge.trustAssessments?.length ?? 0) > 0 || edge.trust !== undefined) &&
          ((edge.sourceNodeId === node.id && edge.sourceVersionId === node.versionId) ||
            (edge.targetNodeId === node.id && edge.targetVersionId === node.versionId)),
      )
      .flatMap((edge) =>
        (edge.trustAssessments ?? (edge.trust ? [edge.trust] : [])).map((assessment) => ({
          subject: `packet relation ${edge.relationType.replace(/-/g, " ")} (${assessment.assessmentId})`,
          reviewStatus: assessment.reviewStatus,
          verificationState: assessment.verificationState,
        })),
      )
      .sort(
        (left, right) =>
          compare(left.subject, right.subject) ||
          compare(left.reviewStatus, right.reviewStatus) ||
          compare(left.verificationState, right.verificationState),
      );
    const disputes = packet.contradictions
      .flatMap((pair) => {
        const isLeft = pair.left.nodeId === node.id && pair.left.versionId === node.versionId;
        const isRight = pair.right.nodeId === node.id && pair.right.versionId === node.versionId;
        if (!isLeft && !isRight) return [];
        const related = isLeft ? pair.right : pair.left;
        if (!citedVersions.has(`${related.nodeId}\u0000${related.versionId}`)) return [];
        const relatedNode = bindings.nodes.get(related.nodeId);
        if (!relatedNode || relatedNode.versionId !== related.versionId) return [];
        return [
          {
            relatedNodeId: related.nodeId,
            relatedNodeVersionId: related.versionId,
            relatedTitle: relatedNode.title,
            provenance: pair.provenance
              .map((entry) => `${entry.provenance} at ${entry.confirmedAt}`)
              .sort(compare)
              .join("; "),
          },
        ];
      })
      .sort(
        (left, right) =>
          compare(left.relatedNodeId, right.relatedNodeId) ||
          compare(left.relatedNodeVersionId, right.relatedNodeVersionId),
      );
    if (disputes.length > 0) disputedReferenceIds.add(referenceId);
    contexts.set(referenceId, {
      referenceId,
      nodeId: node.id,
      nodeVersionId: node.versionId,
      nodeKind: node.kind,
      repository: node.repository,
      provenance: {
        commitSha: node.commitSha,
        sourcePath: node.provenance.sourcePath,
        sourcePointer: node.provenance.sourcePointer,
        license: node.license,
      },
      trust,
      disputes,
    });
  }
  return { citations: contexts, disputedReferenceIds };
}

export function buildSynthesisJsonLd(synthesis: PublicSynthesisReview) {
  const identifier = synthesis.version.versionDoi
    ? `https://doi.org/${synthesis.version.versionDoi}`
    : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    headline: synthesis.title,
    abstract: synthesis.abstract,
    author: {
      "@type": "SoftwareApplication",
      "@id": synthesis.provenance.pipelineSoftware.id,
      name: synthesis.provenance.pipelineSoftware.displayName,
      softwareVersion: synthesis.provenance.pipelineSoftware.pipelineVersion,
    },
    editor: {
      "@type": "Person",
      name: synthesis.provenance.approvingEditor.displayName,
      sameAs: `https://github.com/${synthesis.provenance.approvingEditor.githubLogin}`,
    },
    dateCreated: synthesis.provenance.generatedAt,
    datePublished: synthesis.provenance.acceptedAt,
    license: synthesis.provenance.licenseSpdx,
    ...(identifier ? { identifier } : {}),
    isBasedOn: [...new Set(synthesis.citations.map((citation) => citation.href))],
    encoding: {
      "@type": "MediaObject",
      sha256: synthesis.provenance.documentHash,
    },
  };
}
