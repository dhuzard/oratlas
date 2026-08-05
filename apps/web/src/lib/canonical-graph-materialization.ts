import "server-only";
import { createHash } from "node:crypto";
import { canonicalJson, canonicalizeNodeAlias, type NodeAlias } from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";

export interface CanonicalGraphMaterializationReport {
  reviewNodeId: string;
  reviewNodeVersionId: string;
  claimCount: number;
  reviewAssertionEdgeCount: number;
  workCount: number;
  evidenceEdgeCount: number;
  workIdentityConflictCount: number;
}

export class CanonicalGraphMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalGraphMaterializationError";
  }
}

/**
 * Materialize one immutable relational review version into the canonical graph.
 * The caller owns the transaction: relational rows, graph rows, and compatibility
 * bindings therefore commit or roll back together.
 */
export async function materializeCanonicalReviewGraph(
  tx: Prisma.TransactionClient,
  reviewVersionId: string,
): Promise<CanonicalGraphMaterializationReport> {
  const version = await tx.reviewVersion.findUnique({
    where: { id: reviewVersionId },
    include: {
      review: true,
      claims: { orderBy: { id: "asc" } },
      citations: { orderBy: { id: "asc" } },
    },
  });
  if (!version) {
    throw new CanonicalGraphMaterializationError("Review version not found.");
  }

  const reviewNode = await stableNode(tx, {
    stableKey: `review:${version.review.id}`,
    originType: "review-record",
    localNodeId: version.review.id,
    kind: "review",
  });
  assertNullableBinding("review", version.review.knowledgeNodeId, reviewNode.id);
  if (!version.review.knowledgeNodeId) {
    await tx.review.update({
      where: { id: version.review.id },
      data: { knowledgeNodeId: reviewNode.id },
    });
  }
  const reviewGraphVersion = await exactVersion(tx, {
    knowledgeNodeId: reviewNode.id,
    source: { sourceReviewVersionId: version.id },
    title: version.title,
    abstract: version.abstract,
    text: version.synthesisDocumentJson,
    contributorsJson: "[]",
    license: version.synthesisLicenseSpdx ?? version.review.licenseSpdx,
    provenanceJson: canonicalJson({
      reviewId: version.review.id,
      reviewVersionId: version.id,
      sourceType: "review-version",
    }),
    payloadJson: canonicalJson({
      recordSourceType: version.recordSourceType,
      reviewId: version.review.id,
      reviewVersionId: version.id,
    }),
    isExample: version.isExample,
  });

  const claimVersionById = new Map<string, { nodeId: string; versionId: string }>();
  let reviewAssertionEdgeCount = 0;
  for (const claim of version.claims) {
    const explicitlyBound = claim.knowledgeNodeId
      ? await tx.knowledgeNode.findUnique({ where: { id: claim.knowledgeNodeId } })
      : null;
    if (claim.knowledgeNodeId && (!explicitlyBound || explicitlyBound.kind !== "claim")) {
      throw new CanonicalGraphMaterializationError(
        `Claim '${claim.id}' has an invalid explicit graph identity binding.`,
      );
    }
    const node =
      explicitlyBound ??
      (await stableNode(tx, {
        stableKey: `claim:${claim.id}`,
        originType: "claim-occurrence",
        localNodeId: claim.id,
        kind: "claim",
      }));
    if (!claim.knowledgeNodeId) {
      await tx.claim.update({ where: { id: claim.id }, data: { knowledgeNodeId: node.id } });
    }
    const graphVersion = await exactVersion(tx, {
      knowledgeNodeId: node.id,
      source: { sourceClaimId: claim.id },
      title: null,
      abstract: null,
      text: claim.text,
      contributorsJson: "[]",
      license: version.synthesisLicenseSpdx ?? version.review.licenseSpdx,
      provenanceJson: canonicalJson({
        claimId: claim.id,
        reviewVersionId: version.id,
        sourceType: "claim-occurrence",
      }),
      payloadJson: canonicalJson({
        anchor: claim.anchor,
        claimType: claim.claimType,
        qualification: claim.qualification,
        scopeJson: claim.scopeJson,
        section: claim.section,
        statement: claim.text,
      }),
      isExample: version.isExample,
    });
    claimVersionById.set(claim.id, { nodeId: node.id, versionId: graphVersion.id });
    const reviewAssertion = await exactSourceAssertionEdge(tx, {
      sourceNodeVersionId: reviewGraphVersion.id,
      targetNodeId: node.id,
      targetNodeVersionId: graphVersion.id,
      relationType: "asserts",
      edgeDiscriminator: claim.id,
      assertedAt: version.publishedAt ?? version.createdAt,
    });
    if (!reviewAssertion) {
      throw new CanonicalGraphMaterializationError(
        `Review assertion for claim '${claim.id}' failed materialization.`,
      );
    }
    reviewAssertionEdgeCount += 1;
  }

  const workByCitationId = new Map<string, { nodeId: string; versionId: string }>();
  let workIdentityConflictCount = 0;
  for (const citation of version.citations) {
    const resolution = await resolveWorkNode(tx, citation, version.isExample);
    if (resolution.conflict) workIdentityConflictCount += 1;
    assertNullableBinding("citation", citation.knowledgeNodeId, resolution.node.id);
    if (!citation.knowledgeNodeId || citation.workId !== resolution.node.stableKey) {
      await tx.citation.update({
        where: { id: citation.id },
        data: {
          knowledgeNodeId: resolution.node.id,
          workId: resolution.node.stableKey,
        },
      });
    }
    const graphVersion = await exactVersion(tx, {
      knowledgeNodeId: resolution.node.id,
      source: { sourceCitationId: citation.id },
      title: citation.title,
      abstract: null,
      text: citation.rawCitationJson,
      contributorsJson: canonicalCitationContributors(citation.id, citation.authorsJson),
      license: null,
      provenanceJson: canonicalJson({
        citationId: citation.id,
        reviewVersionId: version.id,
        sourceType: "citation-occurrence",
      }),
      payloadJson: canonicalJson({
        doi: citation.doi,
        openAlexId: citation.openAlexId,
        pmid: citation.pmid,
        source: citation.source,
        url: citation.url,
        workId: resolution.node.stableKey,
      }),
      isExample: version.isExample,
    });
    workByCitationId.set(citation.id, { nodeId: resolution.node.id, versionId: graphVersion.id });
  }

  const relations = await tx.claimEvidenceRelation.findMany({
    where: { claim: { reviewVersionId: version.id } },
    orderBy: { id: "asc" },
  });
  let evidenceEdgeCount = 0;
  for (const relation of relations) {
    const source = claimVersionById.get(relation.claimId);
    const target = workByCitationId.get(relation.citationId);
    if (!source || !target) {
      throw new CanonicalGraphMaterializationError(
        `Relation '${relation.id}' does not resolve to exact graph endpoints.`,
      );
    }
    const unique = {
      sourceNodeVersionId: source.versionId,
      targetNodeId: target.nodeId,
      relationType: relation.relationType,
      edgeDiscriminator: relation.id,
    };
    let edge = await tx.nodeEdge.findUnique({
      where: { sourceNodeVersionId_targetNodeId_relationType_edgeDiscriminator: unique },
    });
    if (!edge) {
      edge = await tx.nodeEdge.create({
        data: {
          ...unique,
          status: "source-assertion",
          provenance: "imported-from-review",
          assertedAt: version.publishedAt ?? version.createdAt,
          confirmedTargetNodeVersionId: target.versionId,
        },
      });
    }
    if (
      edge.status !== "source-assertion" ||
      edge.provenance !== "imported-from-review" ||
      edge.confirmedTargetNodeVersionId !== target.versionId
    ) {
      throw new CanonicalGraphMaterializationError(
        `Canonical edge '${edge.id}' disagrees with relation '${relation.id}'.`,
      );
    }
    assertNullableBinding("claim-evidence relation", relation.nodeEdgeId, edge.id);
    if (!relation.nodeEdgeId) {
      await tx.claimEvidenceRelation.update({
        where: { id: relation.id },
        data: { nodeEdgeId: edge.id },
      });
    }
    evidenceEdgeCount += 1;
  }

  return {
    reviewNodeId: reviewNode.id,
    reviewNodeVersionId: reviewGraphVersion.id,
    claimCount: version.claims.length,
    reviewAssertionEdgeCount,
    workCount: version.citations.length,
    evidenceEdgeCount,
    workIdentityConflictCount,
  };
}

function canonicalCitationContributors(citationId: string, authorsJson: string): string {
  let authors: unknown;
  try {
    authors = JSON.parse(authorsJson);
  } catch {
    throw new CanonicalGraphMaterializationError(
      `Citation '${citationId}' has malformed author provenance.`,
    );
  }
  if (!Array.isArray(authors) || authors.some((author) => typeof author !== "string")) {
    throw new CanonicalGraphMaterializationError(
      `Citation '${citationId}' authors must be a JSON string array.`,
    );
  }
  return canonicalJson(
    authors
      .map((author) => author.trim())
      .filter(Boolean)
      .map((displayName) => ({ displayName })),
  );
}

async function exactSourceAssertionEdge(
  tx: Prisma.TransactionClient,
  input: {
    sourceNodeVersionId: string;
    targetNodeId: string;
    targetNodeVersionId: string;
    relationType: string;
    edgeDiscriminator: string;
    assertedAt: Date;
  },
) {
  const unique = {
    sourceNodeVersionId: input.sourceNodeVersionId,
    targetNodeId: input.targetNodeId,
    relationType: input.relationType,
    edgeDiscriminator: input.edgeDiscriminator,
  };
  let edge = await tx.nodeEdge.findUnique({
    where: { sourceNodeVersionId_targetNodeId_relationType_edgeDiscriminator: unique },
  });
  if (!edge) {
    edge = await tx.nodeEdge.create({
      data: {
        ...unique,
        status: "source-assertion",
        provenance: "imported-from-review",
        assertedAt: input.assertedAt,
        confirmedTargetNodeVersionId: input.targetNodeVersionId,
      },
    });
  }
  if (
    edge.status !== "source-assertion" ||
    edge.provenance !== "imported-from-review" ||
    edge.confirmedTargetNodeVersionId !== input.targetNodeVersionId ||
    edge.confirmedById !== null
  ) {
    throw new CanonicalGraphMaterializationError(
      `Canonical source assertion '${edge.id}' has incompatible semantics.`,
    );
  }
  return edge;
}

async function stableNode(
  tx: Prisma.TransactionClient,
  input: { stableKey: string; originType: string; localNodeId: string; kind: string },
) {
  const node = await tx.knowledgeNode.upsert({
    where: { stableKey: input.stableKey },
    update: {},
    create: input,
  });
  if (
    node.repositoryId !== null ||
    node.originType !== input.originType ||
    node.localNodeId !== input.localNodeId ||
    node.kind !== input.kind
  ) {
    throw new CanonicalGraphMaterializationError(
      `Stable key '${input.stableKey}' is bound to incompatible node identity.`,
    );
  }
  return node;
}

type ExactSource =
  { sourceReviewVersionId: string } | { sourceClaimId: string } | { sourceCitationId: string };

async function exactVersion(
  tx: Prisma.TransactionClient,
  input: {
    knowledgeNodeId: string;
    source: ExactSource;
    title: string | null;
    abstract: string | null;
    text: string | null;
    contributorsJson: string;
    license: string | null;
    provenanceJson: string;
    payloadJson: string;
    isExample: boolean;
  },
) {
  const selector =
    "sourceReviewVersionId" in input.source
      ? { sourceReviewVersionId: input.source.sourceReviewVersionId }
      : "sourceClaimId" in input.source
        ? { sourceClaimId: input.source.sourceClaimId }
        : { sourceCitationId: input.source.sourceCitationId };
  const existing = await tx.knowledgeNodeVersion.findUnique({ where: selector });
  if (existing) {
    const expected = {
      knowledgeNodeId: input.knowledgeNodeId,
      snapshotId: null,
      sourceReviewVersionId:
        "sourceReviewVersionId" in input.source ? input.source.sourceReviewVersionId : null,
      sourceClaimId: "sourceClaimId" in input.source ? input.source.sourceClaimId : null,
      sourceCitationId: "sourceCitationId" in input.source ? input.source.sourceCitationId : null,
      sourceSubmissionId: null,
      inspectionCaptureId: null,
      capturePayloadHash: null,
      title: input.title,
      abstract: input.abstract,
      text: input.text,
      contributorsJson: input.contributorsJson,
      license: input.license,
      provenanceJson: input.provenanceJson,
      payloadJson: input.payloadJson,
      versionDoi: null,
      conceptDoi: null,
      isExample: input.isExample,
    };
    const mismatch = Object.entries(expected).find(
      ([key, value]) => existing[key as keyof typeof existing] !== value,
    );
    if (mismatch) {
      throw new CanonicalGraphMaterializationError(
        `Exact source '${Object.values(selector)[0]}' has incompatible immutable field '${mismatch[0]}'.`,
      );
    }
    return existing;
  }
  return tx.knowledgeNodeVersion.create({
    data: {
      knowledgeNodeId: input.knowledgeNodeId,
      ...input.source,
      title: input.title,
      abstract: input.abstract,
      text: input.text,
      contributorsJson: input.contributorsJson,
      license: input.license,
      provenanceJson: input.provenanceJson,
      payloadJson: input.payloadJson,
      isExample: input.isExample,
    },
  });
}

type CitationIdentityInput = {
  id: string;
  workId: string | null;
  knowledgeNodeId: string | null;
  doi: string | null;
  pmid: string | null;
  openAlexId: string | null;
};

async function resolveWorkNode(
  tx: Prisma.TransactionClient,
  citation: CitationIdentityInput,
  reviewIsExample: boolean,
) {
  if (citation.workId || citation.knowledgeNodeId) {
    if (!citation.workId || !citation.knowledgeNodeId) {
      throw new CanonicalGraphMaterializationError(
        `Citation '${citation.id}' has a partial canonical work binding.`,
      );
    }
    const aliases = citationAliases(citation, reviewIsExample);
    const matchable = aliases.filter((alias) => !alias.isExample);
    const [node, existingConflict] = await Promise.all([
      tx.knowledgeNode.findUnique({
        where: { id: citation.knowledgeNodeId },
        include: { aliases: true },
      }),
      tx.workIdentityConflict.findUnique({ where: { citationId: citation.id } }),
    ]);
    if (
      !node ||
      node.kind !== "work" ||
      node.originType !== "canonical-work" ||
      node.stableKey !== citation.workId
    ) {
      throw new CanonicalGraphMaterializationError(
        `Citation '${citation.id}' has an incompatible canonical work binding.`,
      );
    }
    if (!existingConflict && !aliasesCompatible(node.aliases, matchable)) {
      throw new CanonicalGraphMaterializationError(
        `Citation '${citation.id}' aliases conflict with its canonical work binding.`,
      );
    }
    for (const alias of aliases) await preserveAlias(tx, node.id, alias);
    return { node, conflict: Boolean(existingConflict) };
  }
  const aliases = citationAliases(citation, reviewIsExample);
  const matchable = aliases.filter((alias) => !alias.isExample);
  const matches = matchable.length
    ? await tx.nodeAlias.findMany({
        where: {
          OR: matchable.map((alias) => ({ scheme: alias.scheme, value: alias.value })),
        },
        include: { knowledgeNode: { include: { aliases: true } } },
        orderBy: { id: "asc" },
      })
    : [];
  const candidates = new Map(matches.map((match) => [match.knowledgeNode.id, match.knowledgeNode]));
  const candidateNodes = [...candidates.values()];
  const compatible = candidateNodes.filter(
    (node) =>
      node.kind === "work" &&
      node.originType === "canonical-work" &&
      aliasesCompatible(node.aliases, matchable),
  );
  const conflict =
    candidateNodes.length > 1 || (candidateNodes.length === 1 && compatible.length !== 1);

  const primary = [...matchable].sort((left, right) =>
    `${left.scheme}:${left.value}`.localeCompare(`${right.scheme}:${right.value}`, "en"),
  )[0];
  const stableKey = conflict
    ? `work-occurrence:${citation.id}`
    : (compatible[0]?.stableKey ??
      (primary ? `work:${primary.scheme}:${primary.value}` : `work-occurrence:${citation.id}`));
  if (!stableKey) {
    throw new CanonicalGraphMaterializationError("Resolved work node has no stable key.");
  }
  const node =
    compatible.length === 1 && !conflict
      ? compatible[0]!
      : await stableNode(tx, {
          stableKey,
          originType: "canonical-work",
          localNodeId: `work-${digest(stableKey).slice(0, 24)}`,
          kind: "work",
        });
  if (!node.stableKey) {
    throw new CanonicalGraphMaterializationError("Canonical work node has no stable key.");
  }
  for (const alias of aliases) {
    await preserveAlias(tx, node.id, alias);
  }
  if (conflict) {
    const evidence = canonicalJson(aliases);
    const ids = canonicalJson(candidateNodes.map(({ id }) => id).sort());
    const existing = await tx.workIdentityConflict.findUnique({
      where: { citationId: citation.id },
    });
    if (existing) {
      if (existing.aliasEvidenceJson !== evidence || existing.candidateNodeIdsJson !== ids) {
        throw new CanonicalGraphMaterializationError(
          `Work identity conflict for citation '${citation.id}' changed during retry.`,
        );
      }
    } else {
      await tx.workIdentityConflict.create({
        data: {
          citationId: citation.id,
          reason: "incompatible-or-ambiguous-alias-set",
          aliasEvidenceJson: evidence,
          candidateNodeIdsJson: ids,
        },
      });
    }
  }
  return { node, conflict };
}

async function preserveAlias(
  tx: Prisma.TransactionClient,
  knowledgeNodeId: string,
  alias: NodeAlias,
): Promise<void> {
  const key = {
    knowledgeNodeId,
    scheme: alias.scheme,
    role: alias.role,
    value: alias.value,
  };
  const existing = await tx.nodeAlias.findUnique({
    where: { knowledgeNodeId_scheme_role_value: key },
  });
  if (existing) {
    if (existing.isExample !== alias.isExample) {
      throw new CanonicalGraphMaterializationError(
        `Alias '${alias.scheme}:${alias.value}' changed its example provenance.`,
      );
    }
    return;
  }
  await tx.nodeAlias.create({ data: { ...key, isExample: alias.isExample } });
}

function citationAliases(citation: CitationIdentityInput, reviewIsExample: boolean): NodeAlias[] {
  return [
    citation.doi
      ? { scheme: "doi", role: "work-doi", value: citation.doi, isExample: reviewIsExample }
      : undefined,
    citation.pmid
      ? { scheme: "pmid", role: "work-pmid", value: citation.pmid, isExample: false }
      : undefined,
    citation.openAlexId
      ? { scheme: "openalex", role: "work-openalex", value: citation.openAlexId, isExample: false }
      : undefined,
  ].flatMap((alias) => {
    if (!alias) return [];
    const canonical = canonicalizeNodeAlias(alias);
    return canonical ? [canonical] : [];
  });
}

function aliasesCompatible(
  existing: readonly { scheme: string; value: string; isExample: boolean }[],
  incoming: readonly NodeAlias[],
): boolean {
  for (const alias of incoming) {
    const sameScheme = existing.filter(
      (candidate) => !candidate.isExample && candidate.scheme === alias.scheme,
    );
    if (sameScheme.length > 0 && sameScheme.some((candidate) => candidate.value !== alias.value)) {
      return false;
    }
  }
  return true;
}

function assertNullableBinding(label: string, existing: string | null, expected: string): void {
  if (existing && existing !== expected) {
    throw new CanonicalGraphMaterializationError(
      `Existing ${label} graph binding '${existing}' disagrees with '${expected}'.`,
    );
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
