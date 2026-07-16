import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  canonicalJson,
  subgraphEvidencePacketSchema,
  subgraphEvidenceSourceSchema,
  SUBGRAPH_EVIDENCE_LIMITS,
  SUBGRAPH_EVIDENCE_SCHEMA_VERSION,
  type SubgraphEvidenceContradiction,
  type SubgraphEvidenceEdge,
  type SubgraphEvidenceNode,
  type SubgraphEvidencePacket,
  type SubgraphEvidenceReference,
  type SubgraphEvidenceSelection,
  type SubgraphEvidenceSource,
} from "@oratlas/contracts";
import { ZodError } from "zod";

export const SUBGRAPH_EVIDENCE_ERROR_CODES = [
  "invalid-input",
  "overflow",
  "duplicate",
  "dangling-endpoint",
  "version-mismatch",
  "ownership-mismatch",
  "missing-provenance",
  "aggregate-method-required",
  "incomplete-contradictions",
] as const;
export type SubgraphEvidenceErrorCode = (typeof SUBGRAPH_EVIDENCE_ERROR_CODES)[number];

/** Expected, fail-closed domain rejection. It never includes source content in its message. */
export class SubgraphEvidenceBuildError extends Error {
  readonly code: SubgraphEvidenceErrorCode;

  constructor(code: SubgraphEvidenceErrorCode, message: string) {
    super(message);
    this.name = "SubgraphEvidenceBuildError";
    this.code = code;
  }
}

export interface PreparedSubgraphEvidencePacket {
  packet: SubgraphEvidencePacket;
  /** Exact canonical UTF-8 JSON bytes represented as a string. */
  json: string;
  sha256: string;
}

/** Canonical topic identity used by KG-08 loaders and packet audits. */
export function canonicalizeEvidenceTopic(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Normalize identifier equality without resolving it or making a network request. */
export function normalizeEvidenceIdentifier(scheme: "doi", value: string): string {
  if (scheme !== "doi") return value;
  return value.normalize("NFKC").toLowerCase();
}

export function fingerprintSubgraphEvidenceSelection(selection: SubgraphEvidenceSelection): string {
  const canonicalSelection =
    selection.kind === "topic"
      ? { ...selection, seedNodeIds: [...selection.seedNodeIds].sort(compare) }
      : selection;
  return createHash("sha256").update(canonicalJson(canonicalSelection), "utf8").digest("hex");
}

function referenceId(identity: Record<string, unknown>): string {
  return `reference:sha256:${createHash("sha256")
    .update(canonicalJson(identity), "utf8")
    .digest("hex")}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nodeKey(node: Pick<SubgraphEvidenceNode, "id" | "versionId">): string {
  return `${node.id}\u0000${node.versionId}`;
}

function edgeKey(edge: SubgraphEvidenceEdge): string {
  return [
    edge.sourceNodeId,
    edge.sourceVersionId,
    edge.relationType,
    edge.targetNodeId,
    edge.targetVersionId,
    edge.id,
  ].join("\u0000");
}

function endpointKey(endpoint: { nodeId: string; versionId: string }): string {
  return `${endpoint.nodeId}\u0000${endpoint.versionId}`;
}

function preflightRawBounds(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.nodes) && record.nodes.length > SUBGRAPH_EVIDENCE_LIMITS.maxNodes) {
    throw new SubgraphEvidenceBuildError("overflow", "Subgraph node cap exceeded.");
  }
  if (Array.isArray(record.edges) && record.edges.length > SUBGRAPH_EVIDENCE_LIMITS.maxEdges) {
    throw new SubgraphEvidenceBuildError("overflow", "Subgraph edge cap exceeded.");
  }
}

function parseSource(value: unknown): SubgraphEvidenceSource {
  preflightRawBounds(value);
  try {
    return subgraphEvidenceSourceSchema.parse(value);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const aggregateMissing = error.issues.some((issue) => issue.path.at(-1) === "aggregateMethod");
    if (aggregateMissing) {
      throw new SubgraphEvidenceBuildError(
        "aggregate-method-required",
        "A TRUST aggregate is missing its method.",
      );
    }
    const missingProvenance = error.issues.some(
      (issue) => issue.path.includes("provenance") || issue.path.includes("commitSha"),
    );
    if (missingProvenance) {
      throw new SubgraphEvidenceBuildError(
        "missing-provenance",
        "Immutable item provenance is incomplete.",
      );
    }
    const overflow = error.issues.some(
      (issue) => issue.code === "too_big" && issue.path.at(-1) !== "aggregateScore",
    );
    throw new SubgraphEvidenceBuildError(
      overflow ? "overflow" : "invalid-input",
      overflow ? "Subgraph evidence cap exceeded." : "Subgraph evidence input is invalid.",
    );
  }
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new SubgraphEvidenceBuildError("duplicate", `Duplicate ${label} detected.`);
  }
}

function countStringBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + countStringBytes(entry), 0);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (sum, entry) => sum + countStringBytes(entry),
      0,
    );
  }
  return 0;
}

function normalizeNode(node: SubgraphEvidenceNode): SubgraphEvidenceNode {
  const identifiers = node.identifiers
    .map((identifier) => ({
      ...identifier,
      value: normalizeEvidenceIdentifier(identifier.scheme, identifier.value),
    }))
    .sort((left, right) =>
      compare(
        `${left.scheme}\u0000${left.role}\u0000${left.value}`,
        `${right.scheme}\u0000${right.role}\u0000${right.value}`,
      ),
    );
  const trustless = { ...node, identifiers };
  trustless.contributors = trustless.contributors.map((contributor) => ({
    ...contributor,
    roles: contributor.roles ? [...contributor.roles].sort(compare) : undefined,
  }));
  if (trustless.kind === "claim") {
    return {
      ...trustless,
      payload: { ...trustless.payload, qualifiers: [...trustless.payload.qualifiers] },
    };
  }
  if (trustless.kind === "code") {
    return {
      ...trustless,
      payload: {
        ...trustless.payload,
        entryPoints: [...trustless.payload.entryPoints].sort(compare),
      },
    };
  }
  return trustless;
}

function normalizeEdge(edge: SubgraphEvidenceEdge): SubgraphEvidenceEdge {
  if (!edge.trust) return edge;
  return {
    ...edge,
    trust: {
      ...edge.trust,
      criteria: [...edge.trust.criteria].sort((left, right) =>
        compare(left.criterion, right.criterion),
      ),
    },
  };
}

function buildReferences(nodes: SubgraphEvidenceNode[]): {
  references: SubgraphEvidenceReference[];
  identifierWhitelist: string[];
} {
  const references: SubgraphEvidenceReference[] = [];
  for (const node of nodes) {
    const nodeIdentity = {
      kind: "node" as const,
      nodeId: node.id,
      nodeVersionId: node.versionId,
    };
    references.push({ referenceId: referenceId(nodeIdentity), ...nodeIdentity });
    for (const identifier of node.identifiers) {
      if (node.isExample || identifier.isExample) continue;
      const identity = {
        kind: "identifier" as const,
        nodeId: node.id,
        nodeVersionId: node.versionId,
        scheme: identifier.scheme,
        role: identifier.role,
        value: normalizeEvidenceIdentifier(identifier.scheme, identifier.value),
      };
      references.push({
        referenceId: referenceId(identity),
        ...identity,
        isExample: false,
      });
    }
  }
  const identifierReferences = references.filter(
    (reference): reference is Extract<SubgraphEvidenceReference, { kind: "identifier" }> =>
      reference.kind === "identifier",
  );
  if (identifierReferences.length > SUBGRAPH_EVIDENCE_LIMITS.maxIdentifiers) {
    throw new SubgraphEvidenceBuildError("overflow", "Identifier whitelist cap exceeded.");
  }
  assertUnique(
    references.map((reference) => reference.referenceId),
    "evidence reference",
  );
  references.sort((left, right) => compare(left.referenceId, right.referenceId));
  return {
    references,
    identifierWhitelist: identifierReferences
      .map((reference) => reference.referenceId)
      .sort(compare),
  };
}

function buildContradictions(edges: SubgraphEvidenceEdge[]): SubgraphEvidenceContradiction[] {
  const grouped = new Map<string, SubgraphEvidenceContradiction>();
  for (const edge of edges) {
    if (edge.relationType !== "contradicts") continue;
    const source = { nodeId: edge.sourceNodeId, versionId: edge.sourceVersionId };
    const target = { nodeId: edge.targetNodeId, versionId: edge.targetVersionId };
    if (endpointKey(source) === endpointKey(target)) {
      throw new SubgraphEvidenceBuildError(
        "ownership-mismatch",
        "A contradiction cannot refer to one exact node version twice.",
      );
    }
    const [left, right] =
      compare(endpointKey(source), endpointKey(target)) < 0 ? [source, target] : [target, source];
    const key = `${endpointKey(left)}\u0001${endpointKey(right)}`;
    const existing = grouped.get(key) ?? { left, right, edgeIds: [], provenance: [] };
    existing.edgeIds.push(edge.id);
    existing.provenance.push({
      edgeId: edge.id,
      provenance: edge.provenance,
      confirmedAt: edge.confirmedAt,
    });
    if (existing.edgeIds.length > 2) {
      throw new SubgraphEvidenceBuildError(
        "duplicate",
        "More than two directed contradiction assertions identify one canonical pair.",
      );
    }
    grouped.set(key, existing);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([, contradiction]) => ({
      ...contradiction,
      edgeIds: contradiction.edgeIds.sort(compare),
      provenance: contradiction.provenance.sort((left, right) =>
        compare(left.edgeId, right.edgeId),
      ),
    }));
}

function validateGraph(source: SubgraphEvidenceSource): void {
  if (
    source.declaredCounts.nodeCount !== source.nodes.length ||
    source.declaredCounts.edgeCount !== source.edges.length
  ) {
    throw new SubgraphEvidenceBuildError(
      "invalid-input",
      "Declared subgraph counts do not match the supplied bounded domain.",
    );
  }
  if (
    source.source.selectorFingerprint !== fingerprintSubgraphEvidenceSelection(source.selection)
  ) {
    throw new SubgraphEvidenceBuildError(
      "invalid-input",
      "Source fingerprint is not bound to the selected bounded domain.",
    );
  }
  assertUnique(
    source.nodes.map((node) => node.id),
    "node id",
  );
  assertUnique(
    source.nodes.map((node) => node.versionId),
    "node version id",
  );
  assertUnique(
    source.nodes.map((node) => `${node.repository.url.toLowerCase()}\u0000${node.localNodeId}`),
    "repository-local node ownership",
  );
  assertUnique(
    source.edges.map((edge) => edge.id),
    "edge id",
  );
  assertUnique(
    source.edges.flatMap((edge) => (edge.trust ? [edge.trust.assessmentId] : [])),
    "TRUST assessment ownership",
  );
  assertUnique(
    source.edges.map((edge) =>
      [
        edge.sourceNodeId,
        edge.sourceVersionId,
        edge.relationType,
        edge.targetNodeId,
        edge.targetVersionId,
      ].join("\u0000"),
    ),
    "exact-version edge",
  );

  const nodes = new Map(source.nodes.map((node) => [node.id, node]));
  for (const node of source.nodes) {
    if (
      node.provenance.commitSha !== node.commitSha ||
      node.provenance.repositoryUrl !== node.repository.url
    ) {
      throw new SubgraphEvidenceBuildError(
        "ownership-mismatch",
        "Node provenance does not own the exact published version.",
      );
    }
    const identifierValues = node.identifiers.map((identifier) =>
      normalizeEvidenceIdentifier(identifier.scheme, identifier.value),
    );
    if (
      node.identifiers.some(
        (identifier) =>
          normalizeEvidenceIdentifier(identifier.scheme, identifier.value).startsWith("10.5555/") &&
          !identifier.isExample,
      )
    ) {
      throw new SubgraphEvidenceBuildError(
        "invalid-input",
        "A reserved example DOI was not marked as example data.",
      );
    }
    if (new Set(identifierValues).size !== identifierValues.length) {
      throw new SubgraphEvidenceBuildError(
        "duplicate",
        "One node version assigns multiple roles to the same identifier.",
      );
    }
    const identifierRoles = node.identifiers.map((identifier) => identifier.role);
    if (new Set(identifierRoles).size !== identifierRoles.length) {
      throw new SubgraphEvidenceBuildError(
        "duplicate",
        "One node version declares the same identifier role more than once.",
      );
    }
  }
  for (const edge of source.edges) {
    const sourceNode = nodes.get(edge.sourceNodeId);
    const targetNode = nodes.get(edge.targetNodeId);
    if (!sourceNode || !targetNode) {
      throw new SubgraphEvidenceBuildError(
        "dangling-endpoint",
        "An edge endpoint is absent from the supplied bounded subgraph.",
      );
    }
    if (
      sourceNode.versionId !== edge.sourceVersionId ||
      targetNode.versionId !== edge.targetVersionId
    ) {
      throw new SubgraphEvidenceBuildError(
        "version-mismatch",
        "An edge is not bound to the supplied exact node versions.",
      );
    }
    if (
      edge.trust &&
      (edge.trust.subject.sourceNodeId !== edge.sourceNodeId ||
        edge.trust.subject.sourceVersionId !== edge.sourceVersionId ||
        edge.trust.subject.targetNodeId !== edge.targetNodeId ||
        edge.trust.subject.targetVersionId !== edge.targetVersionId ||
        edge.trust.subject.relationType !== edge.relationType)
    ) {
      throw new SubgraphEvidenceBuildError(
        "ownership-mismatch",
        "A TRUST summary is not bound to its owning exact edge.",
      );
    }
    if (edge.trust) {
      const expectedRelation =
        targetNode.kind === "dataset"
          ? "uses-dataset"
          : targetNode.kind === "code"
            ? "uses-code"
            : targetNode.kind === "figure"
              ? "derives-from"
              : undefined;
      if (
        sourceNode.kind !== "claim" ||
        !expectedRelation ||
        (edge.relationType !== expectedRelation && edge.relationType !== "derives-from")
      ) {
        throw new SubgraphEvidenceBuildError(
          "ownership-mismatch",
          "TRUST is allowed only on its exact claim-to-evidence relation.",
        );
      }
    }
  }

  if (source.selection.kind === "seed") {
    const seed = nodes.get(source.selection.nodeId);
    if (!seed) {
      throw new SubgraphEvidenceBuildError(
        "dangling-endpoint",
        "The selected seed is absent from the supplied bounded subgraph.",
      );
    }
    if (seed.versionId !== source.selection.versionId) {
      throw new SubgraphEvidenceBuildError(
        "version-mismatch",
        "The selected seed version is not the supplied exact version.",
      );
    }
  } else {
    if (
      canonicalizeEvidenceTopic(source.selection.canonicalQuery) !== source.selection.canonicalQuery
    ) {
      throw new SubgraphEvidenceBuildError(
        "invalid-input",
        "Topic selection must use its canonical query.",
      );
    }
    assertUnique(source.selection.seedNodeIds, "topic seed node id");
    if (source.selection.seedNodeIds.some((id) => !nodes.has(id))) {
      throw new SubgraphEvidenceBuildError(
        "dangling-endpoint",
        "A topic seed is absent from the supplied bounded subgraph.",
      );
    }
  }

  const actualContradictionIds = source.edges
    .filter((edge) => edge.relationType === "contradicts")
    .map((edge) => edge.id)
    .sort(compare);
  const assertedContradictionIds = [...source.declaredCounts.contradictionEdgeIds].sort(compare);
  assertUnique(assertedContradictionIds, "contradiction coverage edge id");
  if (canonicalJson(actualContradictionIds) !== canonicalJson(assertedContradictionIds)) {
    throw new SubgraphEvidenceBuildError(
      "incomplete-contradictions",
      "Declared contradiction coverage does not match the supplied bounded subgraph.",
    );
  }

  const textBytes = countStringBytes({
    selection: source.selection,
    nodes: source.nodes,
    edges: source.edges,
  });
  if (textBytes > SUBGRAPH_EVIDENCE_LIMITS.maxTotalTextBytes) {
    throw new SubgraphEvidenceBuildError("overflow", "Subgraph text byte cap exceeded.");
  }
}

/**
 * Build deterministic writer evidence from a bounded subgraph supplied by a trusted loader.
 * This function is pure: it performs no I/O, hydration, clock reads, or input mutation.
 */
export function buildSubgraphEvidencePacket(value: unknown): SubgraphEvidencePacket {
  const source = parseSource(value);
  validateGraph(source);
  const nodes = source.nodes
    .map(normalizeNode)
    .sort((left, right) => compare(nodeKey(left), nodeKey(right)));
  const edges = source.edges
    .map(normalizeEdge)
    .sort((left, right) => compare(edgeKey(left), edgeKey(right)));
  const references = buildReferences(nodes);
  const selection =
    source.selection.kind === "topic"
      ? { ...source.selection, seedNodeIds: [...source.selection.seedNodeIds].sort(compare) }
      : source.selection;
  const packet = {
    schemaVersion: SUBGRAPH_EVIDENCE_SCHEMA_VERSION,
    selection,
    source: source.source,
    nodes,
    edges,
    references: references.references,
    identifierWhitelist: references.identifierWhitelist,
    contradictions: buildContradictions(edges),
  } as const;
  if (Buffer.byteLength(canonicalJson(packet), "utf8") > SUBGRAPH_EVIDENCE_LIMITS.maxPacketBytes) {
    throw new SubgraphEvidenceBuildError(
      "overflow",
      "Canonical evidence packet byte cap exceeded.",
    );
  }
  return subgraphEvidencePacketSchema.parse(packet);
}

/** The only preparation path rebuilds every derived table from the complete source. */
export function buildPreparedSubgraphEvidencePacket(
  source: unknown,
): PreparedSubgraphEvidencePacket {
  const packet = buildSubgraphEvidencePacket(source);
  const json = canonicalJson(packet);
  return {
    packet,
    json,
    sha256: createHash("sha256").update(json, "utf8").digest("hex"),
  };
}
