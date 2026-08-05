import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  canonicalJson,
  discussionTraversalScopeSchema,
  type DiscussionTraversalScope,
} from "@oratlas/contracts";
import { getServerEnv } from "@oratlas/config";
import { buildEvidencePacket, type KnowledgeIndexData } from "@oratlas/knowledge";
import { prisma } from "./db";
import { publicConfirmedNodeEdgeWhere } from "./node-edge-publication";
import { readableCanonicalNodeVersionWhere } from "./public-snapshot-visibility";
import { canonicalLandscapeNodeId } from "./knowledge-landscape-service";

export interface ResolvedDiscussionScope {
  kind: "explore";
  claimIds: string[];
  landscapeNodeIds: string[];
  landscapeNodeVersionIds: string[];
  landscapeEdgeIds: string[];
  claimLandscapeNodeIds: Record<string, string>;
  citationLandscapeNodeIds: Record<string, string>;
  label: string;
}

export class DiscussionScopeError extends Error {
  constructor(
    message: string,
    readonly code: "bad-request" | "conflict" = "bad-request",
  ) {
    super(message);
  }
}

type VisibleGraphScope = {
  nodes: readonly { nodeId: string; nodeVersionId: string }[];
  edges: readonly { graphEdgeId: string }[];
};

/** Whether an exact visible graph scope contains a public claim occurrence Discuss can resolve. */
export async function hasDiscussableCanonicalClaimOccurrence(
  nodes: readonly { nodeId: string; nodeVersionId: string }[],
): Promise<boolean> {
  if (nodes.length === 0) return false;
  const occurrence = await prisma.knowledgeNodeVersion.findFirst({
    where: {
      sourceClaimId: { not: null },
      ...readableCanonicalNodeVersionWhere,
      OR: nodes.map(({ nodeId, nodeVersionId }) => ({
        id: nodeVersionId,
        knowledgeNodeId: nodeId,
      })),
    },
    select: { id: true },
  });
  return Boolean(occurrence);
}

/** Bind the exact canonical occurrences rendered by Explore to this server. */
export function issueDiscussionTraversalScope(
  visible: VisibleGraphScope,
  secret = getServerEnv().sessionSecret,
): DiscussionTraversalScope {
  const unsigned = normalizeUnsignedScope({
    nodes: visible.nodes,
    edgeIds: visible.edges.map((edge) => edge.graphEdgeId),
  });
  if (unsigned.nodes.length === 0) {
    throw new DiscussionScopeError("Atlas Discuss requires a nonempty traversed graph scope.");
  }
  return discussionTraversalScopeSchema.parse({
    ...unsigned,
    signature: signUnsignedScope(unsigned, secret),
  });
}

/** Reject edited, malformed, or server-stale traversal tokens before any evidence lookup. */
export function verifyDiscussionTraversalScope(
  input: DiscussionTraversalScope,
  secret = getServerEnv().sessionSecret,
): DiscussionTraversalScope {
  const parsed = discussionTraversalScopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new DiscussionScopeError("Atlas Discuss requires an exact traversed graph scope.");
  }
  const unsigned = normalizeUnsignedScope(parsed.data);
  const expected = Buffer.from(signUnsignedScope(unsigned, secret), "base64url");
  const supplied = Buffer.from(parsed.data.signature, "base64url");
  if (
    supplied.length !== expected.length ||
    supplied.toString("base64url") !== parsed.data.signature ||
    !timingSafeEqual(expected, supplied)
  ) {
    throw new DiscussionScopeError("Atlas Discuss traversal scope is invalid or was modified.");
  }
  return { ...unsigned, signature: parsed.data.signature };
}

/**
 * Build a packet only from the signed, exact node versions and edges that were
 * visible in Explore. This never re-runs recommendation or search selection.
 */
export async function selectDiscussionEvidence(
  index: KnowledgeIndexData,
  question: string,
  input: DiscussionTraversalScope,
) {
  const scope = verifyDiscussionTraversalScope(input);
  const validated = await validatePersistedTraversal(scope);
  const indexedClaimByGraphVersion = new Map(
    index.claims.flatMap((claim) =>
      claim.graphNodeVersionId ? [[claim.graphNodeVersionId, claim] as const] : [],
    ),
  );
  const indexedCitationByGraphVersion = new Map(
    index.citations.flatMap((citation) =>
      citation.graphNodeVersionId ? [[citation.graphNodeVersionId, citation] as const] : [],
    ),
  );
  const selectedClaims = validated.nodes.flatMap((node) => {
    if (!node.sourceClaimId) return [];
    const claim = indexedClaimByGraphVersion.get(node.id);
    return claim ? [claim] : [];
  });
  const expectedClaimCount = validated.nodes.filter((node) => node.sourceClaimId).length;
  if (selectedClaims.length === 0) {
    throw new DiscussionScopeError(
      "Atlas Discuss requires at least one visible canonical claim occurrence.",
    );
  }
  if (selectedClaims.length !== expectedClaimCount) {
    throw new DiscussionScopeError(
      "A selected claim occurrence is stale or no longer publicly discussable.",
      "conflict",
    );
  }
  const selectedCitations = validated.nodes.flatMap((node) => {
    if (!node.sourceCitationId) return [];
    const citation = indexedCitationByGraphVersion.get(node.id);
    return citation ? [citation] : [];
  });
  const expectedCitationCount = validated.nodes.filter((node) => node.sourceCitationId).length;
  if (selectedCitations.length !== expectedCitationCount) {
    throw new DiscussionScopeError(
      "A selected citation occurrence is stale or no longer publicly discussable.",
      "conflict",
    );
  }

  const allowedRelations = new Set(
    validated.edges.flatMap((edge) => {
      const sourceClaim = indexedClaimByGraphVersion.get(edge.sourceNodeVersionId);
      const targetClaim = edge.confirmedTargetNodeVersionId
        ? indexedClaimByGraphVersion.get(edge.confirmedTargetNodeVersionId)
        : undefined;
      const sourceCitation = indexedCitationByGraphVersion.get(edge.sourceNodeVersionId);
      const targetCitation = edge.confirmedTargetNodeVersionId
        ? indexedCitationByGraphVersion.get(edge.confirmedTargetNodeVersionId)
        : undefined;
      const claim = sourceClaim ?? targetClaim;
      const citation = sourceCitation ?? targetCitation;
      return claim && citation
        ? [relationKey(claim.claimId, citation.citationId, edge.relationType)]
        : [];
    }),
  );
  const selectedCitationIds = new Set(selectedCitations.map((citation) => citation.citationId));
  const scopedIndex: KnowledgeIndexData = {
    ...index,
    claims: selectedClaims.map((claim) => ({
      ...claim,
      relations: claim.relations.filter(
        (relation) =>
          selectedCitationIds.has(relation.citationId) &&
          allowedRelations.has(
            relationKey(claim.claimId, relation.citationId, relation.relationType),
          ),
      ),
    })),
    citations: selectedCitations,
  };
  const claimIds = selectedClaims.map((claim) => claim.claimId);
  const builtPacket = buildEvidencePacket(scopedIndex, "", {
    claimIds,
    maxClaims: claimIds.length,
  });
  const packet = { ...builtPacket, question };
  if (packet.claims.length !== claimIds.length) {
    throw new DiscussionScopeError(
      "Atlas Discuss could not resolve every selected canonical claim occurrence.",
      "conflict",
    );
  }
  const landscapeIdByVersion = new Map(
    validated.nodes.map((node) => [
      node.id,
      canonicalLandscapeNodeId(node.knowledgeNodeId, node.id),
    ]),
  );
  return {
    packet,
    scope: {
      kind: "explore" as const,
      claimIds: packet.claims.map((claim) => claim.claimId),
      landscapeNodeIds: validated.nodes.map((node) => landscapeIdByVersion.get(node.id)!),
      landscapeNodeVersionIds: validated.nodes.map((node) => node.id),
      landscapeEdgeIds: validated.edges.map((edge) => edge.id),
      claimLandscapeNodeIds: Object.fromEntries(
        selectedClaims.map((claim) => [
          claim.claimId,
          landscapeIdByVersion.get(claim.graphNodeVersionId!)!,
        ]),
      ),
      citationLandscapeNodeIds: Object.fromEntries(
        selectedCitations.map((citation) => [
          citation.citationId,
          landscapeIdByVersion.get(citation.graphNodeVersionId!)!,
        ]),
      ),
      label: `${validated.nodes.length} exact graph occurrence${validated.nodes.length === 1 ? "" : "s"} · ${validated.edges.length} visible edge${validated.edges.length === 1 ? "" : "s"}`,
    },
  };
}

function normalizeUnsignedScope(input: {
  nodes: readonly { nodeId: string; nodeVersionId: string }[];
  edgeIds: readonly string[];
}) {
  return {
    nodes: [...input.nodes].sort(
      (left, right) =>
        left.nodeId.localeCompare(right.nodeId) ||
        left.nodeVersionId.localeCompare(right.nodeVersionId),
    ),
    edgeIds: [...input.edgeIds].sort((left, right) => left.localeCompare(right)),
  };
}

function signUnsignedScope(
  scope: ReturnType<typeof normalizeUnsignedScope>,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`oratlas-discussion-traversal-v1\n${canonicalJson(scope)}`)
    .digest("base64url");
}

const sourceAssertionWhere = {
  status: "source-assertion",
  provenance: "imported-from-review",
  confirmedTargetNodeVersionId: { not: null },
  confirmedById: null,
} as const;

async function validatePersistedTraversal(scope: DiscussionTraversalScope) {
  const versionIds = scope.nodes.map((node) => node.nodeVersionId);
  const nodes = await prisma.knowledgeNodeVersion.findMany({
    where: { id: { in: versionIds }, ...readableCanonicalNodeVersionWhere },
    select: {
      id: true,
      knowledgeNodeId: true,
      sourceClaimId: true,
      sourceCitationId: true,
    },
  });
  const expectedNodeKeys = new Set(
    scope.nodes.map(({ nodeId, nodeVersionId }) => nodeKey(nodeId, nodeVersionId)),
  );
  const actualNodeKeys = new Set(nodes.map((node) => nodeKey(node.knowledgeNodeId, node.id)));
  if (
    nodes.length !== scope.nodes.length ||
    [...expectedNodeKeys].some((key) => !actualNodeKeys.has(key))
  ) {
    throw new DiscussionScopeError(
      "A selected graph occurrence is missing, stale, or no longer public.",
      "conflict",
    );
  }

  const edges = await prisma.nodeEdge.findMany({
    where: {
      id: { in: scope.edgeIds },
      OR: [sourceAssertionWhere, publicConfirmedNodeEdgeWhere],
      sourceNodeVersion: readableCanonicalNodeVersionWhere,
      confirmedTargetNodeVersion: readableCanonicalNodeVersionWhere,
    },
    select: {
      id: true,
      sourceNodeVersionId: true,
      targetNodeId: true,
      confirmedTargetNodeVersionId: true,
      relationType: true,
    },
  });
  if (edges.length !== scope.edgeIds.length) {
    throw new DiscussionScopeError(
      "A selected graph edge is missing, stale, or no longer public.",
      "conflict",
    );
  }
  const visibleVersionIds = new Set(versionIds);
  if (
    edges.some(
      (edge) =>
        !edge.confirmedTargetNodeVersionId ||
        !visibleVersionIds.has(edge.sourceNodeVersionId) ||
        !visibleVersionIds.has(edge.confirmedTargetNodeVersionId) ||
        nodes.find((node) => node.id === edge.confirmedTargetNodeVersionId)?.knowledgeNodeId !==
          edge.targetNodeId,
    )
  ) {
    throw new DiscussionScopeError(
      "A selected graph edge does not connect the exact visible occurrences.",
      "conflict",
    );
  }
  return { nodes, edges };
}

function nodeKey(nodeId: string, nodeVersionId: string): string {
  return `${nodeId}\u0000${nodeVersionId}`;
}

function relationKey(claimId: string, citationId: string, relationType: string): string {
  return `${claimId}\u0000${citationId}\u0000${relationType}`;
}
