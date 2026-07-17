import "server-only";
import { type PublicSynthesisReview } from "@oratlas/contracts";
import { getPublicNode } from "./node-publication";

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

const MAX_PUBLIC_CITATION_OCCURRENCES = 2_000;
const MAX_PUBLIC_CITATION_REFERENCES = 256;

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Enrich accepted citation references exclusively through the public node projection.
 * If an exact immutable citation cannot be projected, the reading page fails closed.
 */
export async function loadSynthesisReadingContext(
  synthesis: PublicSynthesisReview,
): Promise<SynthesisReadingContext | null> {
  if (synthesis.citations.length > MAX_PUBLIC_CITATION_OCCURRENCES) return null;
  const unique = new Map<string, PublicSynthesisReview["citations"][number]>();
  for (const citation of synthesis.citations) {
    const previous = unique.get(citation.referenceId);
    if (
      previous &&
      (previous.nodeId !== citation.nodeId ||
        previous.nodeVersionId !== citation.nodeVersionId ||
        previous.nodeKind !== citation.nodeKind ||
        previous.title !== citation.title ||
        previous.href !== citation.href)
    ) {
      return null;
    }
    unique.set(citation.referenceId, citation);
  }
  if (unique.size > MAX_PUBLIC_CITATION_REFERENCES) return null;
  const loaded = await Promise.all(
    [...unique.values()]
      .sort((left, right) => compare(left.referenceId, right.referenceId))
      .map(async (citation) => ({
        citation,
        node: await getPublicNode(citation.nodeId, citation.nodeVersionId),
      })),
  );
  const citedVersions = new Set(
    synthesis.citations.map((citation) => `${citation.nodeId}:${citation.nodeVersionId}`),
  );
  const citations = new Map<string, SynthesisCitationReadingContext>();
  const disputedReferenceIds = new Set<string>();

  for (const { citation, node } of loaded) {
    if (
      !node ||
      node.id !== citation.nodeId ||
      node.version.id !== citation.nodeVersionId ||
      node.kind !== citation.nodeKind ||
      node.version.title !== citation.title
    ) {
      return null;
    }

    const disputes = node.edges
      .filter(
        (edge) =>
          edge.relationType === "contradicts" &&
          citedVersions.has(`${edge.relatedNode.id}:${edge.relatedNode.versionId}`),
      )
      .map((edge) => ({
        relatedNodeId: edge.relatedNode.id,
        relatedNodeVersionId: edge.relatedNode.versionId,
        relatedTitle: edge.relatedNode.title,
        provenance: edge.provenance,
      }))
      .filter(
        (dispute, index, values) =>
          values.findIndex(
            (candidate) =>
              candidate.relatedNodeId === dispute.relatedNodeId &&
              candidate.relatedNodeVersionId === dispute.relatedNodeVersionId &&
              candidate.provenance === dispute.provenance,
          ) === index,
      )
      .sort(
        (left, right) =>
          compare(left.relatedNodeId, right.relatedNodeId) ||
          compare(left.relatedNodeVersionId, right.relatedNodeVersionId) ||
          compare(left.provenance, right.provenance),
      );
    if (disputes.length > 0) disputedReferenceIds.add(citation.referenceId);

    const trust = [
      ...node.trustContext.flatMap((entry) =>
        entry.trust
          ? [
              {
                subject: `claim–citation ${entry.relationType.replace(/-/g, " ")}`,
                reviewStatus: entry.trust.reviewStatus,
                verificationState: entry.trust.verificationState,
              },
            ]
          : [],
      ),
      ...node.edges.flatMap((edge) =>
        edge.trust
          ? [
              {
                subject: `node relation ${edge.relationType.replace(/-/g, " ")}`,
                reviewStatus: edge.trust.reviewStatus,
                verificationState: edge.trust.verificationState,
              },
            ]
          : [],
      ),
    ]
      .filter(
        (entry, index, values) =>
          values.findIndex(
            (candidate) =>
              candidate.subject === entry.subject &&
              candidate.reviewStatus === entry.reviewStatus &&
              candidate.verificationState === entry.verificationState,
          ) === index,
      )
      .sort(
        (left, right) =>
          compare(left.subject, right.subject) ||
          compare(left.reviewStatus, right.reviewStatus) ||
          compare(left.verificationState, right.verificationState),
      );

    citations.set(citation.referenceId, {
      referenceId: citation.referenceId,
      nodeId: citation.nodeId,
      nodeVersionId: citation.nodeVersionId,
      nodeKind: citation.nodeKind,
      repository: node.repository,
      provenance: {
        commitSha: node.version.commitSha,
        sourcePath: node.version.provenance.sourcePath,
        sourcePointer: node.version.provenance.sourcePointer,
        license: node.version.license,
      },
      trust,
      disputes,
    });
  }

  return { citations, disputedReferenceIds };
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
