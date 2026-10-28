import "server-only";
import {
  claimScopeSchema,
  publicationHttpsUrlSchema,
  publicationAdapterBindingSchema,
  publicationStructuralProvenanceSchema,
  publicationClaimSelectorSchema,
  publicationClaimSourceBindingSchema,
  publicationClaimTargetSchema,
  type CanonicalGraphEdge,
  type ClaimScope,
} from "@oratlas/contracts";
import { prisma } from "./db";
import { CanonicalGraphQueryError, queryCanonicalGraph } from "./canonical-graph-query";
import { isReadablePublicState } from "./review-lifecycle";

export const CLAIM_COMPARISON_EVIDENCE_LIMIT = 25;

export interface ComparisonEvidence {
  id: string;
  title: string;
  href: string;
  relationType: string;
  status: "source-assertion" | "confirmed";
  locator?: string;
  doi?: string;
  isExample: boolean;
}

export interface ComparisonClaim {
  reference: string;
  text: string;
  qualification?: string;
  scope: ClaimScope | null;
  canonical: { nodeId: string; nodeVersionId: string } | null;
  source: {
    type: "review-version" | "publication-version";
    title: string;
    href: string;
    publishedTargetUrl?: string;
    versionId: string;
    occurrenceId: string;
    lifecycle: string;
    locator?: string;
    passage?: string;
    passageLabel: string;
    structuralProvenance?: string;
  };
  evidence: ComparisonEvidence[];
  evidenceTruncated: boolean;
  isExample: boolean;
}

export interface PublicClaimComparison {
  left: ComparisonClaim;
  right: ComparisonClaim;
  href: string;
  relationships: CanonicalGraphEdge[];
  sharedSourceFacts: string[];
  limitations: string[];
}

type ExactReference =
  | { kind: "review"; versionId: string; localClaimId: string }
  | { kind: "external"; occurrenceId: string }
  | { kind: "node"; nodeId: string; nodeVersionId: string };

/** Local exact-version paths only: no external fetch, latest alias or inferred identity. */
export function parseClaimComparisonReference(reference: string): ExactReference | null {
  if (reference.length > 1600 || /[?#\\]/.test(reference)) return null;
  const match = /^\/claims\/([^/]+)\/([^/]+)$/.exec(reference);
  const node = /^\/nodes\/([^/]+)\/versions\/([^/]+)$/.exec(reference);
  const external = /^\/api\/publication-claim-occurrences\/([^/]+)$/.exec(reference);
  if (!match && !node && !external) return null;
  try {
    const parts = (match ?? node ?? external)!.slice(1).map(decodeURIComponent);
    if (
      parts.some(
        (part) =>
          !part ||
          part.length > 300 ||
          /[/\\]/.test(part) ||
          [...part].some((character) => character.charCodeAt(0) < 32),
      )
    ) {
      return null;
    }
    return external
      ? { kind: "external", occurrenceId: parts[0]! }
      : match
        ? { kind: "review", versionId: parts[0]!, localClaimId: parts[1]! }
        : { kind: "node", nodeId: parts[0]!, nodeVersionId: parts[1]! };
  } catch {
    return null;
  }
}

export function claimComparisonHref(left: string, right: string): string {
  return `/compare/claims?${new URLSearchParams({ left, right })}`;
}

function reviewReference(versionId: string, localClaimId: string): string {
  return `/claims/${encodeURIComponent(versionId)}/${encodeURIComponent(localClaimId)}`;
}

function nodeReference(nodeId: string, versionId: string): string {
  return `/nodes/${encodeURIComponent(nodeId)}/versions/${encodeURIComponent(versionId)}`;
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function readReviewClaim(
  versionId: string,
  localClaimId: string,
): Promise<ComparisonClaim | null> {
  const claim = await prisma.claim.findFirst({
    where: {
      reviewVersionId: versionId,
      localClaimId,
      reviewVersion: {
        publicState: { in: ["published", "withdrawn"] },
        review: { status: "published" },
      },
    },
    include: {
      reviewVersion: { include: { review: { select: { slug: true, status: true } } } },
      graphVersion: { select: { id: true, knowledgeNodeId: true } },
      evidenceRelations: {
        include: { citation: true },
        orderBy: { id: "asc" },
        take: CLAIM_COMPARISON_EVIDENCE_LIMIT + 1,
      },
    },
  });
  if (
    !claim ||
    claim.reviewVersion.review.status !== "published" ||
    !isReadablePublicState(claim.reviewVersion.publicState)
  )
    return null;
  const version = claim.reviewVersion;
  const reference = reviewReference(version.id, claim.localClaimId);
  const scope = claimScopeSchema.safeParse(parseJson(claim.scopeJson));
  return {
    reference,
    text: claim.text,
    qualification: claim.qualification ?? undefined,
    scope: scope.success ? scope.data : null,
    canonical:
      claim.graphVersion && claim.knowledgeNodeId === claim.graphVersion.knowledgeNodeId
        ? { nodeId: claim.graphVersion.knowledgeNodeId, nodeVersionId: claim.graphVersion.id }
        : null,
    source: {
      type: "review-version",
      title: version.title,
      href: `/reviews/${encodeURIComponent(version.review.slug)}/versions/${encodeURIComponent(version.id)}`,
      versionId: version.id,
      occurrenceId: claim.id,
      lifecycle: version.publicState,
      locator: [claim.section, claim.anchor].filter(Boolean).join(" · ") || undefined,
      passageLabel:
        "The stored claim declaration is shown above. A separately captured source passage is not available here.",
    },
    evidence: claim.evidenceRelations.slice(0, CLAIM_COMPARISON_EVIDENCE_LIMIT).map((relation) => ({
      id: relation.id,
      title: relation.citation.title ?? relation.citation.localCitationId,
      href: `${reference}#relation-${encodeURIComponent(relation.id)}`,
      relationType: relation.relationType,
      status: "source-assertion",
      locator: relation.sourceLocation ?? undefined,
      doi: relation.citation.doi ?? undefined,
      isExample: version.isExample || /^10\.5555\//i.test(relation.citation.doi ?? ""),
    })),
    evidenceTruncated: claim.evidenceRelations.length > CLAIM_COMPARISON_EVIDENCE_LIMIT,
    isExample: version.isExample,
  };
}

async function readExactGraph(nodeId: string, nodeVersionId: string) {
  try {
    return await queryCanonicalGraph({
      seed: nodeId,
      version: nodeVersionId,
      direction: "both",
      status: "authoritative",
      limit: CLAIM_COMPARISON_EVIDENCE_LIMIT,
    });
  } catch (error) {
    if (error instanceof CanonicalGraphQueryError && error.code === "not-found") return null;
    throw error;
  }
}

async function readClaim(reference: ExactReference): Promise<ComparisonClaim | null> {
  if (reference.kind === "review")
    return readReviewClaim(reference.versionId, reference.localClaimId);
  if (reference.kind === "external") return readExternalClaim(reference.occurrenceId);
  const graph = await readExactGraph(reference.nodeId, reference.nodeVersionId);
  const node = graph?.nodes.find(
    (entry) => entry.nodeId === reference.nodeId && entry.nodeVersionId === reference.nodeVersionId,
  );
  if (!graph || !node || node.kind !== "claim") return null;
  const exactReference = nodeReference(node.nodeId, node.nodeVersionId);
  if (node.source.type === "claim-occurrence") {
    const claim = await prisma.claim.findUnique({
      where: { id: node.source.claimId },
      select: { reviewVersionId: true, localClaimId: true },
    });
    if (!claim) return null;
    const side = await readReviewClaim(claim.reviewVersionId, claim.localClaimId);
    if (
      !side ||
      side.canonical?.nodeId !== node.nodeId ||
      side.canonical.nodeVersionId !== node.nodeVersionId
    )
      return null;
    return { ...side, reference: exactReference };
  }
  if (node.source.type !== "publication-claim-occurrence") return null;
  return readExternalClaim(node.source.publicationClaimOccurrenceId, {
    nodeId: node.nodeId,
    nodeVersionId: node.nodeVersionId,
    publicationVersionId: node.source.publicationVersionId,
  });
}

async function readExternalClaim(
  occurrenceId: string,
  expected?: { nodeId: string; nodeVersionId: string; publicationVersionId: string },
): Promise<ComparisonClaim | null> {
  const occurrence = await prisma.publicationClaimOccurrence.findFirst({
    where: {
      id: occurrenceId,
      ...(expected
        ? {
            publicationVersionId: expected.publicationVersionId,
            knowledgeNodeId: expected.nodeId,
            graphVersion: { id: expected.nodeVersionId },
          }
        : {}),
      publicationVersion: { publication: { recordSource: "external-publication" } },
    },
    include: {
      publicationVersion: true,
      graphVersion: { select: { id: true, knowledgeNodeId: true } },
    },
  });
  if (!occurrence) return null;
  const selector = publicationClaimSelectorSchema.safeParse(parseJson(occurrence.selectorJson));
  const binding = publicationClaimSourceBindingSchema.safeParse(
    parseJson(occurrence.sourceBindingJson),
  );
  const publishedUrl = publicationHttpsUrlSchema.nullable().safeParse(occurrence.publishedUrl);
  const target = publicationClaimTargetSchema.safeParse(parseJson(occurrence.targetJson));
  const structural = publicationStructuralProvenanceSchema.safeParse(
    occurrence.publicationVersion.structuralProvenance,
  );
  const adapter = publicationAdapterBindingSchema.safeParse(
    parseJson(occurrence.publicationVersion.adapterBindingJson),
  );
  if (
    !selector.success ||
    !binding.success ||
    !target.success ||
    !publishedUrl.success ||
    !structural.success ||
    !adapter.success ||
    adapter.data.type !== occurrence.publicationVersion.adapterType
  )
    return null;
  const canonical =
    occurrence.graphVersion &&
    occurrence.graphVersion.knowledgeNodeId === occurrence.knowledgeNodeId
      ? {
          nodeId: occurrence.graphVersion.knowledgeNodeId,
          nodeVersionId: occurrence.graphVersion.id,
        }
      : null;
  if ((occurrence.knowledgeNodeId || occurrence.graphVersion) && !canonical) return null;
  if (
    expected &&
    (!canonical ||
      canonical.nodeId !== expected.nodeId ||
      canonical.nodeVersionId !== expected.nodeVersionId)
  )
    return null;
  const graph = canonical ? await readExactGraph(canonical.nodeId, canonical.nodeVersionId) : null;
  if (canonical && !graph) return null;
  return {
    reference: expected
      ? nodeReference(expected.nodeId, expected.nodeVersionId)
      : `/api/publication-claim-occurrences/${encodeURIComponent(occurrence.id)}`,
    text: occurrence.text ?? "No semantic claim text was declared.",
    qualification: occurrence.qualification ?? undefined,
    scope: null,
    canonical,
    source: {
      type: "publication-version",
      title: occurrence.publicationVersion.title ?? occurrence.sourceLocalClaimId,
      href: `/publications/${encodeURIComponent(occurrence.publicationVersion.publicationId)}/versions/${encodeURIComponent(occurrence.publicationVersionId)}`,
      publishedTargetUrl: publishedUrl.data ?? undefined,
      versionId: occurrence.publicationVersionId,
      occurrenceId: occurrence.id,
      lifecycle: "registered external occurrence (no review lifecycle state)",
      locator: `${binding.data.documentPath}:L${binding.data.startLine}-L${binding.data.endLine} · ${selector.data.representation}`,
      passage: selector.data.textQuote.exact,
      passageLabel: "Source-declared exact quote in the recorded selector frame",
      structuralProvenance: structural.data,
    },
    evidence: (graph?.edges ?? []).flatMap((edge) => {
      const otherId =
        edge.sourceNodeVersionId === canonical!.nodeVersionId
          ? edge.targetNodeVersionId
          : edge.sourceNodeVersionId;
      const other = graph?.nodes.find((entry) => entry.nodeVersionId === otherId);
      if (!other)
        throw new CanonicalGraphQueryError(
          "An exact relationship endpoint is missing; the comparison was not published.",
        );
      if (!["work", "figure", "dataset", "code"].includes(other.kind)) return [];
      return [
        {
          id: edge.id,
          title: other.title ?? other.text ?? other.localNodeId,
          href: nodeReference(other.nodeId, other.nodeVersionId),
          relationType: edge.relationType,
          status: edge.status,
          isExample: other.isExample,
        },
      ];
    }),
    evidenceTruncated: Boolean(graph?.page.nextCursor),
    isExample:
      graph?.nodes.find((entry) => entry.nodeVersionId === canonical?.nodeVersionId)?.isExample ??
      false,
  };
}

/** Internal UI composition only. Does not publish a new API or write graph decisions. */
export async function getPublicClaimComparison(
  left: string,
  right: string,
): Promise<PublicClaimComparison | null> {
  const leftRef = parseClaimComparisonReference(left);
  const rightRef = parseClaimComparisonReference(right);
  if (!leftRef || !rightRef) return null;
  const [a, b] = await Promise.all([readClaim(leftRef), readClaim(rightRef)]);
  if (!a || !b) return null;
  const graph = a.canonical
    ? await readExactGraph(a.canonical.nodeId, a.canonical.nodeVersionId)
    : null;
  const relationships =
    graph?.edges.filter(
      (edge) =>
        b.canonical &&
        ((edge.sourceNodeVersionId === a.canonical!.nodeVersionId &&
          edge.targetNodeVersionId === b.canonical.nodeVersionId) ||
          (edge.targetNodeVersionId === a.canonical!.nodeVersionId &&
            edge.sourceNodeVersionId === b.canonical.nodeVersionId)),
    ) ?? [];
  const sharedDois = [
    ...new Set(a.evidence.flatMap((entry) => (entry.doi ? [entry.doi.toLowerCase()] : []))),
  ].filter((doi) => b.evidence.some((entry) => entry.doi?.toLowerCase() === doi));
  const sharedSourceFacts = sharedDois.map(
    (doi) =>
      `Both displayed evidence lists cite DOI ${doi}; this is a repeated source identifier, not independent corroboration.`,
  );
  if (a.source.type === b.source.type && a.source.versionId === b.source.versionId)
    sharedSourceFacts.unshift("Both occurrences belong to the same exact source version.");
  if (a.text === b.text)
    sharedSourceFacts.push(
      "The stored claim texts are identical. Equal text does not establish equal scope or canonical identity.",
    );
  return {
    left: a,
    right: b,
    href: claimComparisonHref(a.reference, b.reference),
    relationships,
    sharedSourceFacts,
    limitations: [
      "Only declared scope and recorded links are shown. Missing fields remain unknown; comparison does not establish contradiction, equivalence or scientific correctness.",
      "Source assertions and editor-confirmed relationships retain their recorded status. Opening a comparison confirms nothing and merges no claims.",
      "Pending and rejected relation proposals are not included in this public read; their absence here does not establish that no proposal exists.",
      "Evidence lists show at most 25 records per side; source overlap is limited to displayed DOI identifiers. Missing overlap does not establish independence.",
      ...(!a.canonical || !b.canonical
        ? [
            "At least one occurrence has no canonical graph binding; graph relationship coverage is unavailable for that occurrence.",
          ]
        : []),
      ...(graph?.page.nextCursor
        ? [
            "The exact graph neighborhood is truncated; additional relationships may exist outside this bounded view.",
          ]
        : []),
    ],
  };
}

/** Resolve fixture-local names once into exact URLs; never put a moving alias in a copied pair. */
export async function getFeaturedClaimComparisonHref(): Promise<string | null> {
  const picks = [
    { slug: "hippocampal-replay-computational-review", localClaimId: "claim-001" },
    { slug: "cortical-oscillations-attention-review", localClaimId: "claim-003" },
  ];
  const claims = await Promise.all(
    picks.map(({ slug, localClaimId }) =>
      prisma.claim.findFirst({
        where: {
          localClaimId,
          reviewVersion: {
            isExample: true,
            publicState: "published",
            review: { slug, status: "published" },
          },
        },
        select: { reviewVersionId: true, localClaimId: true },
        orderBy: [{ reviewVersion: { createdAt: "desc" } }, { id: "desc" }],
      }),
    ),
  );
  const [left, right] = claims;
  return left && right
    ? claimComparisonHref(
        reviewReference(left.reviewVersionId, left.localClaimId),
        reviewReference(right.reviewVersionId, right.localClaimId),
      )
    : null;
}
