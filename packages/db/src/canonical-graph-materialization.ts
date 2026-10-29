import { createHash } from "node:crypto";
import { canonicalJson, canonicalizeNodeAlias, type NodeAlias } from "@oratlas/contracts";
import type { Prisma } from "../generated/client/index.js";

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

  // Claim identities are independent. Keep their existing IDs and let Prisma
  // generate IDs only for missing stable keys, then resolve by key, never row order.
  const claimNodes = new Map<string, Prisma.KnowledgeNodeGetPayload<object>>();
  for (const claims of batches(version.claims)) {
    const explicitIds = claims.flatMap((claim) =>
      claim.knowledgeNodeId ? [claim.knowledgeNodeId] : [],
    );
    const stableKeys = claims
      .filter((claim) => !claim.knowledgeNodeId)
      .map((claim) => `claim:${claim.id}`);
    const existing = await tx.knowledgeNode.findMany({
      where: { OR: [{ id: { in: explicitIds } }, { stableKey: { in: stableKeys } }] },
    });
    const byId = new Map(existing.map((node) => [node.id, node]));
    const byKey = new Map(existing.map((node) => [node.stableKey, node]));
    const missing: Prisma.KnowledgeNodeCreateManyInput[] = [];
    for (const claim of claims) {
      if (claim.knowledgeNodeId) {
        const node = byId.get(claim.knowledgeNodeId);
        if (!node || node.kind !== "claim") {
          throw new CanonicalGraphMaterializationError(
            `Claim '${claim.id}' has an invalid explicit graph identity binding.`,
          );
        }
        claimNodes.set(claim.id, node);
      } else {
        const input = {
          stableKey: `claim:${claim.id}`,
          originType: "claim-occurrence",
          localNodeId: claim.id,
          kind: "claim",
        };
        const node = byKey.get(input.stableKey);
        if (node) {
          assertStableNode(node, input);
          claimNodes.set(claim.id, node);
        } else missing.push(input);
      }
    }
    if (missing.length) {
      await tx.knowledgeNode.createMany({ data: missing });
      const created = await tx.knowledgeNode.findMany({
        where: { stableKey: { in: missing.map((node) => node.stableKey!) } },
      });
      for (const node of created) claimNodes.set(node.localNodeId, node);
    }
  }
  const reviewAssertions: SourceAssertionInput[] = [];
  const claimVersionById = new Map<string, { nodeId: string; versionId: string }>();
  let reviewAssertionEdgeCount = 0;
  const claimInputs: ExactVersionInput[] = [];
  for (const claim of version.claims) {
    const node = claimNodes.get(claim.id);
    if (!node)
      throw new CanonicalGraphMaterializationError(`Claim '${claim.id}' failed materialization.`);
    if (!claim.knowledgeNodeId) {
      await tx.claim.update({ where: { id: claim.id }, data: { knowledgeNodeId: node.id } });
    }
    claimInputs.push({
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
  }
  const claimVersions = await exactVersions(tx, claimInputs);
  for (const claim of version.claims) {
    const node = claimNodes.get(claim.id)!;
    const graphVersion = claimVersions.get(claim.id)!;
    claimVersionById.set(claim.id, { nodeId: node.id, versionId: graphVersion.id });
    reviewAssertions.push({
      sourceNodeVersionId: reviewGraphVersion.id,
      targetNodeId: node.id,
      targetNodeVersionId: graphVersion.id,
      relationType: "asserts",
      edgeDiscriminator: claim.id,
      assertedAt: version.publishedAt ?? version.createdAt,
    });
    reviewAssertionEdgeCount += 1;
  }
  for (const inputs of batches(reviewAssertions)) {
    const edges = await sourceAssertionEdges(tx, inputs);
    for (const input of inputs) {
      const edge = edges.get(edgeKey(input))!;
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
    }
  }

  const workByCitationId = new Map<string, { nodeId: string; versionId: string }>();
  let workIdentityConflictCount = 0;
  const citationInputs: ExactVersionInput[] = [];
  // Alias writes must remain visible to the next citation in ID order.
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
    citationInputs.push({
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
  }
  const citationVersions = await exactVersions(tx, citationInputs);
  for (const citation of version.citations) {
    const graphVersion = citationVersions.get(citation.id)!;
    workByCitationId.set(citation.id, {
      nodeId: graphVersion.knowledgeNodeId,
      versionId: graphVersion.id,
    });
  }

  const relations = await tx.claimEvidenceRelation.findMany({
    where: { claim: { reviewVersionId: version.id } },
    orderBy: { id: "asc" },
  });
  let evidenceEdgeCount = 0;
  for (const relationBatch of batches(relations)) {
    const inputs = relationBatch.map((relation): SourceAssertionInput => {
      const source = claimVersionById.get(relation.claimId);
      const target = workByCitationId.get(relation.citationId);
      if (!source || !target) {
        throw new CanonicalGraphMaterializationError(
          `Relation '${relation.id}' does not resolve to exact graph endpoints.`,
        );
      }
      return {
        sourceNodeVersionId: source.versionId,
        targetNodeId: target.nodeId,
        targetNodeVersionId: target.versionId,
        relationType: relation.relationType,
        edgeDiscriminator: relation.id,
        assertedAt: version.publishedAt ?? version.createdAt,
      };
    });
    const edges = await sourceAssertionEdges(tx, inputs);
    for (const [index, relation] of relationBatch.entries()) {
      const input = inputs[index]!;
      const edge = edges.get(edgeKey(input))!;
      if (
        edge.status !== "source-assertion" ||
        edge.provenance !== "imported-from-review" ||
        edge.confirmedTargetNodeVersionId !== input.targetNodeVersionId
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

// Conservative bound for both SQLite bind parameters and PostgreSQL. Includes
// Prisma-generated IDs/timestamps in createMany, not just input columns.
const MATERIALIZATION_BATCH_SIZE = 40;

function* batches<T>(values: readonly T[]): Generator<T[]> {
  for (let offset = 0; offset < values.length; offset += MATERIALIZATION_BATCH_SIZE) {
    yield values.slice(offset, offset + MATERIALIZATION_BATCH_SIZE);
  }
}

type SourceAssertionInput = {
  sourceNodeVersionId: string;
  targetNodeId: string;
  targetNodeVersionId: string;
  relationType: string;
  edgeDiscriminator: string;
  assertedAt: Date;
};

function edgeSelector(input: SourceAssertionInput) {
  return {
    sourceNodeVersionId: input.sourceNodeVersionId,
    targetNodeId: input.targetNodeId,
    relationType: input.relationType,
    edgeDiscriminator: input.edgeDiscriminator,
  };
}

function edgeKey(input: ReturnType<typeof edgeSelector>): string {
  return JSON.stringify([
    input.sourceNodeVersionId,
    input.targetNodeId,
    input.relationType,
    input.edgeDiscriminator,
  ]);
}

async function sourceAssertionEdges(tx: Prisma.TransactionClient, inputs: SourceAssertionInput[]) {
  const existing = await tx.nodeEdge.findMany({ where: { OR: inputs.map(edgeSelector) } });
  const edges = new Map(existing.map((edge) => [edgeKey(edge), edge]));
  const missing = inputs.filter((input) => !edges.has(edgeKey(input)));
  if (missing.length) {
    // Do not skip duplicate errors: a concurrent incompatible write must roll
    // back the caller's transaction rather than silently changing its binding.
    await tx.nodeEdge.createMany({
      data: missing.map((input) => ({
        ...edgeSelector(input),
        status: "source-assertion",
        provenance: "imported-from-review",
        assertedAt: input.assertedAt,
        confirmedTargetNodeVersionId: input.targetNodeVersionId,
      })),
    });
    const created = await tx.nodeEdge.findMany({ where: { OR: missing.map(edgeSelector) } });
    for (const edge of created) edges.set(edgeKey(edge), edge);
  }
  for (const input of inputs) {
    if (!edges.has(edgeKey(input))) {
      throw new CanonicalGraphMaterializationError(
        "Canonical source assertion failed materialization.",
      );
    }
  }
  return edges;
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
  assertStableNode(node, input);
  return node;
}

function assertStableNode(
  node: Prisma.KnowledgeNodeGetPayload<object>,
  input: { stableKey: string; originType: string; localNodeId: string; kind: string },
): void {
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
}

type ExactSource =
  { sourceReviewVersionId: string } | { sourceClaimId: string } | { sourceCitationId: string };

type ExactVersionInput = {
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
};

function assertExactVersion(
  existing: Prisma.KnowledgeNodeVersionGetPayload<object>,
  input: ExactVersionInput,
): void {
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
      `Exact source '${Object.values(input.source)[0]}' has incompatible immutable field '${mismatch[0]}'.`,
    );
  }
}

function exactVersionData(input: ExactVersionInput): Prisma.KnowledgeNodeVersionCreateManyInput {
  return {
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
  };
}

async function exactVersion(tx: Prisma.TransactionClient, input: ExactVersionInput) {
  const existing = await tx.knowledgeNodeVersion.findUnique({ where: input.source });
  if (existing) {
    assertExactVersion(existing, input);
    return existing;
  }
  return tx.knowledgeNodeVersion.create({ data: exactVersionData(input) });
}

async function exactVersions(tx: Prisma.TransactionClient, inputs: ExactVersionInput[]) {
  const versions = new Map<string, Prisma.KnowledgeNodeVersionGetPayload<object>>();
  for (const batch of batches(inputs)) {
    const existing = await tx.knowledgeNodeVersion.findMany({
      where: { OR: batch.map((input) => input.source) },
    });
    for (const row of existing) {
      const sourceId = row.sourceClaimId ?? row.sourceCitationId ?? row.sourceReviewVersionId;
      if (sourceId) versions.set(sourceId, row);
    }
    const missing: ExactVersionInput[] = [];
    for (const input of batch) {
      const row = versions.get(Object.values(input.source)[0]!);
      if (row) assertExactVersion(row, input);
      else missing.push(input);
    }
    if (missing.length) {
      await tx.knowledgeNodeVersion.createMany({ data: missing.map(exactVersionData) });
      const created = await tx.knowledgeNodeVersion.findMany({
        where: { OR: missing.map((input) => input.source) },
      });
      for (const row of created) {
        const sourceId = row.sourceClaimId ?? row.sourceCitationId ?? row.sourceReviewVersionId;
        if (sourceId) versions.set(sourceId, row);
      }
    }
    for (const input of batch) {
      if (!versions.has(Object.values(input.source)[0]!)) {
        throw new CanonicalGraphMaterializationError(
          "Exact source version failed materialization.",
        );
      }
    }
  }
  return versions;
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
