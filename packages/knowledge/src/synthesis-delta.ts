import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  subgraphEvidencePacketSchema,
  synthesisReviewDocumentSchema,
  type SubgraphEvidenceEdge,
  type SubgraphEvidencePacket,
  type SubgraphEvidenceReference,
  type SynthesisReviewCitation,
  type SynthesisReviewDocument,
} from "@oratlas/contracts";
import type { PreparedSubgraphEvidencePacket } from "./subgraph-evidence.js";
import { verifySynthesisDocument } from "./synthesis-writer.js";

export const SYNTHESIS_GENERATION_DELTA_VERSION = "synthesis-generation-delta/1.0.0" as const;

/** Hard output bounds derived from the two already-bounded input contracts. */
export const SYNTHESIS_GENERATION_DELTA_LIMITS = {
  maxNodeChanges: 200,
  maxEdgeChanges: 1_000,
  maxContradictionChanges: 1_000,
  maxSectionParagraphChanges: 144,
  maxParagraphCitationChanges: 72,
  maxCanonicalBytes: 524_288,
} as const;

export const SYNTHESIS_GENERATION_DELTA_ERROR_CODES = [
  "invalid-snapshot",
  "integrity-mismatch",
  "ambiguous-reference",
  "ambiguous-edge",
  "immutable-node-drift",
  "overflow",
] as const;
export type SynthesisGenerationDeltaErrorCode =
  (typeof SYNTHESIS_GENERATION_DELTA_ERROR_CODES)[number];

/** Expected fail-closed rejection. Messages never echo supplied evidence or review prose. */
export class SynthesisGenerationDeltaError extends Error {
  constructor(
    readonly code: SynthesisGenerationDeltaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SynthesisGenerationDeltaError";
  }
}

/** A persisted generation snapshot with exact canonical bytes and hashes for both artifacts. */
export interface SynthesisGenerationSnapshot {
  packet: SubgraphEvidencePacket;
  packetJson: string;
  packetHash: string;
  document: SynthesisReviewDocument;
  documentJson: string;
  documentHash: string;
}

export interface SynthesisDeltaNodeReference {
  nodeId: string;
  nodeVersionId: string;
  referenceId: string;
}

export interface SynthesisDeltaNodeReassessment {
  nodeId: string;
  previous: Omit<SynthesisDeltaNodeReference, "nodeId">;
  current: Omit<SynthesisDeltaNodeReference, "nodeId">;
}

export interface SynthesisDeltaEdgeReference {
  edgeId: string;
  source: { nodeId: string; nodeVersionId: string };
  relationType: SubgraphEvidenceEdge["relationType"];
  target: { nodeId: string; nodeVersionId: string };
}

export interface SynthesisDeltaEdgeChange {
  edgeId: string;
  previous: Omit<SynthesisDeltaEdgeReference, "edgeId">;
  current: Omit<SynthesisDeltaEdgeReference, "edgeId">;
  changedFields: ("binding" | "trust" | "confirmation-metadata")[];
}

export interface SynthesisDeltaContradictionReference {
  left: { nodeId: string; nodeVersionId: string };
  right: { nodeId: string; nodeVersionId: string };
  edgeIds: string[];
}

export interface SynthesisSectionParagraphDelta {
  paragraphIndex: number;
  previousText?: string;
  currentText?: string;
}

export interface SynthesisSectionTextDelta {
  sectionId: SynthesisReviewDocument["sections"][number]["id"];
  title: string;
  paragraphChanges: SynthesisSectionParagraphDelta[];
}

export interface SynthesisTextReplacement {
  previous: string;
  current: string;
}

export interface SynthesisCitationListDelta {
  previous: SynthesisReviewCitation[];
  current: SynthesisReviewCitation[];
}

export interface SynthesisParagraphCitationDelta extends SynthesisCitationListDelta {
  sectionId: SynthesisReviewDocument["sections"][number]["id"];
  paragraphIndex: number;
}

export interface SynthesisSecondaryDocumentDelta {
  title?: SynthesisTextReplacement;
  summary?: SynthesisTextReplacement;
  topLevelCitations?: SynthesisCitationListDelta;
  paragraphCitations: SynthesisParagraphCitationDelta[];
}

export interface SynthesisGenerationDelta {
  schemaVersion: typeof SYNTHESIS_GENERATION_DELTA_VERSION;
  previous: { packetHash: string; documentHash: string };
  current: { packetHash: string; documentHash: string };
  nodes: {
    added: SynthesisDeltaNodeReference[];
    removed: SynthesisDeltaNodeReference[];
    reassessed: SynthesisDeltaNodeReassessment[];
  };
  confirmedEdges: {
    added: SynthesisDeltaEdgeReference[];
    removed: SynthesisDeltaEdgeReference[];
    changed: SynthesisDeltaEdgeChange[];
  };
  contradictions: {
    opened: SynthesisDeltaContradictionReference[];
    resolved: SynthesisDeltaContradictionReference[];
  };
  sectionText: SynthesisSectionTextDelta[];
  secondaryDocument: SynthesisSecondaryDocumentDelta;
  isNoop: boolean;
  checksum: string;
}

type DeltaWithoutChecksum = Omit<SynthesisGenerationDelta, "checksum">;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return (
    canonicalJson(Object.keys(value).sort(compare)) === canonicalJson([...expected].sort(compare))
  );
}

function expectedReferenceId(reference: SubgraphEvidenceReference): string {
  const identity =
    reference.kind === "node"
      ? {
          kind: reference.kind,
          nodeId: reference.nodeId,
          nodeVersionId: reference.nodeVersionId,
        }
      : {
          kind: reference.kind,
          nodeId: reference.nodeId,
          nodeVersionId: reference.nodeVersionId,
          scheme: reference.scheme,
          role: reference.role,
          value: reference.value,
        };
  return `reference:sha256:${digest(canonicalJson(identity))}`;
}

function referenceSubjectKey(reference: SubgraphEvidenceReference): string {
  return reference.kind === "node"
    ? `node\u0000${reference.nodeId}\u0000${reference.nodeVersionId}`
    : [
        "identifier",
        reference.nodeId,
        reference.nodeVersionId,
        reference.scheme,
        reference.role,
        reference.value,
      ].join("\u0000");
}

function semanticEdgeKey(edge: SubgraphEvidenceEdge): string {
  return [
    edge.sourceNodeId,
    edge.sourceVersionId,
    edge.relationType,
    edge.targetNodeId,
    edge.targetVersionId,
  ].join("\u0000");
}

function assertUnambiguousPacket(packet: SubgraphEvidencePacket): void {
  const subjects = new Set<string>();
  for (const reference of packet.references) {
    const subject = referenceSubjectKey(reference);
    if (subjects.has(subject) || reference.referenceId !== expectedReferenceId(reference)) {
      throw new SynthesisGenerationDeltaError(
        "ambiguous-reference",
        "Snapshot references are ambiguous or do not match their canonical subjects.",
      );
    }
    subjects.add(subject);
  }

  const semanticEdges = packet.edges.map(semanticEdgeKey);
  if (new Set(semanticEdges).size !== semanticEdges.length) {
    throw new SynthesisGenerationDeltaError(
      "ambiguous-edge",
      "Snapshot contains more than one edge for an exact confirmed relation.",
    );
  }
}

function assertSnapshot(value: unknown): SynthesisGenerationSnapshot {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "packet",
      "packetJson",
      "packetHash",
      "document",
      "documentJson",
      "documentHash",
    ]) ||
    typeof value.packetJson !== "string" ||
    typeof value.packetHash !== "string" ||
    typeof value.documentJson !== "string" ||
    typeof value.documentHash !== "string"
  ) {
    throw new SynthesisGenerationDeltaError("invalid-snapshot", "Generation snapshot is invalid.");
  }

  const packet = subgraphEvidencePacketSchema.safeParse(value.packet);
  const document = synthesisReviewDocumentSchema.safeParse(value.document);
  if (!packet.success || !document.success) {
    throw new SynthesisGenerationDeltaError("invalid-snapshot", "Generation snapshot is invalid.");
  }
  const packetJson = canonicalJson(packet.data);
  const documentJson = canonicalJson(document.data);
  if (
    value.packetJson !== packetJson ||
    value.packetHash !== digest(packetJson) ||
    value.documentJson !== documentJson ||
    value.documentHash !== digest(documentJson)
  ) {
    throw new SynthesisGenerationDeltaError(
      "integrity-mismatch",
      "Generation snapshot bytes and hashes do not match.",
    );
  }

  assertUnambiguousPacket(packet.data);
  try {
    verifySynthesisDocument(document.data, {
      packet: packet.data,
      json: packetJson,
      sha256: value.packetHash,
    });
  } catch {
    throw new SynthesisGenerationDeltaError(
      "invalid-snapshot",
      "Generation snapshot review is not grounded in its packet.",
    );
  }
  return {
    packet: packet.data,
    packetJson,
    packetHash: value.packetHash,
    document: document.data,
    documentJson,
    documentHash: value.documentHash,
  };
}

/** Validate and bind a review document to the canonical evidence prepared for its generation. */
export function prepareSynthesisGenerationSnapshot(
  prepared: PreparedSubgraphEvidencePacket,
  value: unknown,
): SynthesisGenerationSnapshot {
  let document: SynthesisReviewDocument;
  try {
    document = verifySynthesisDocument(value, prepared);
  } catch {
    throw new SynthesisGenerationDeltaError(
      "invalid-snapshot",
      "Generation review is invalid or is not grounded in its packet.",
    );
  }
  const documentJson = canonicalJson(document);
  return assertSnapshot({
    packet: prepared.packet,
    packetJson: prepared.json,
    packetHash: prepared.sha256,
    document,
    documentJson,
    documentHash: digest(documentJson),
  });
}

function nodeReference(
  packet: SubgraphEvidencePacket,
  nodeId: string,
): SynthesisDeltaNodeReference {
  const node = packet.nodes.find((candidate) => candidate.id === nodeId)!;
  const reference = packet.references.find(
    (candidate) =>
      candidate.kind === "node" &&
      candidate.nodeId === node.id &&
      candidate.nodeVersionId === node.versionId,
  )!;
  return { nodeId, nodeVersionId: node.versionId, referenceId: reference.referenceId };
}

function edgeReference(edge: SubgraphEvidenceEdge): SynthesisDeltaEdgeReference {
  return {
    edgeId: edge.id,
    source: { nodeId: edge.sourceNodeId, nodeVersionId: edge.sourceVersionId },
    relationType: edge.relationType,
    target: { nodeId: edge.targetNodeId, nodeVersionId: edge.targetVersionId },
  };
}

function edgeBinding(edge: SubgraphEvidenceEdge): Omit<SynthesisDeltaEdgeReference, "edgeId"> {
  const { edgeId: _edgeId, ...binding } = edgeReference(edge);
  return binding;
}

function edgeMetadata(edge: SubgraphEvidenceEdge): unknown {
  const {
    id: _id,
    sourceNodeId: _sourceNodeId,
    sourceVersionId: _sourceVersionId,
    targetNodeId: _targetNodeId,
    targetVersionId: _targetVersionId,
    relationType: _relationType,
    trust: _trust,
    trustAssessments: _trustAssessments,
    ...metadata
  } = edge;
  return metadata;
}

function contradictionKey(pair: SubgraphEvidencePacket["contradictions"][number]): string {
  const endpoints = [
    `${pair.left.nodeId}\u0000${pair.left.versionId}`,
    `${pair.right.nodeId}\u0000${pair.right.versionId}`,
  ].sort(compare);
  return `${endpoints[0]}\u0001${endpoints[1]}`;
}

function contradictionReference(
  pair: SubgraphEvidencePacket["contradictions"][number],
): SynthesisDeltaContradictionReference {
  const endpoints = [
    { nodeId: pair.left.nodeId, nodeVersionId: pair.left.versionId },
    { nodeId: pair.right.nodeId, nodeVersionId: pair.right.versionId },
  ].sort((left, right) =>
    compare(
      `${left.nodeId}\u0000${left.nodeVersionId}`,
      `${right.nodeId}\u0000${right.nodeVersionId}`,
    ),
  );
  return {
    left: endpoints[0]!,
    right: endpoints[1]!,
    edgeIds: [...pair.edgeIds].sort(compare),
  };
}

function sectionTextDelta(
  previous: SynthesisReviewDocument,
  current: SynthesisReviewDocument,
): SynthesisSectionTextDelta[] {
  const result: SynthesisSectionTextDelta[] = [];
  for (let sectionIndex = 0; sectionIndex < previous.sections.length; sectionIndex += 1) {
    const oldSection = previous.sections[sectionIndex]!;
    const newSection = current.sections[sectionIndex]!;
    const paragraphChanges: SynthesisSectionParagraphDelta[] = [];
    const length = Math.max(oldSection.paragraphs.length, newSection.paragraphs.length);
    for (let paragraphIndex = 0; paragraphIndex < length; paragraphIndex += 1) {
      const previousText = oldSection.paragraphs[paragraphIndex]?.text;
      const currentText = newSection.paragraphs[paragraphIndex]?.text;
      if (previousText === currentText) continue;
      paragraphChanges.push({ paragraphIndex, previousText, currentText });
    }
    if (paragraphChanges.length > 0) {
      result.push({
        sectionId: oldSection.id,
        title: oldSection.title,
        paragraphChanges,
      });
    }
  }
  return result;
}

function citationListDelta(
  previous: SynthesisReviewCitation[],
  current: SynthesisReviewCitation[],
): SynthesisCitationListDelta | undefined {
  return canonicalJson(previous) === canonicalJson(current)
    ? undefined
    : { previous: [...previous], current: [...current] };
}

function secondaryDocumentDelta(
  previous: SynthesisReviewDocument,
  current: SynthesisReviewDocument,
): SynthesisSecondaryDocumentDelta {
  const paragraphCitations: SynthesisParagraphCitationDelta[] = [];
  for (let sectionIndex = 0; sectionIndex < previous.sections.length; sectionIndex += 1) {
    const oldSection = previous.sections[sectionIndex]!;
    const newSection = current.sections[sectionIndex]!;
    const length = Math.max(oldSection.paragraphs.length, newSection.paragraphs.length);
    for (let paragraphIndex = 0; paragraphIndex < length; paragraphIndex += 1) {
      const previousCitations = oldSection.paragraphs[paragraphIndex]?.citations ?? [];
      const currentCitations = newSection.paragraphs[paragraphIndex]?.citations ?? [];
      const citations = citationListDelta(previousCitations, currentCitations);
      if (citations) {
        paragraphCitations.push({
          sectionId: oldSection.id,
          paragraphIndex,
          ...citations,
        });
      }
    }
  }
  const result: SynthesisSecondaryDocumentDelta = { paragraphCitations };
  if (previous.title !== current.title) {
    result.title = { previous: previous.title, current: current.title };
  }
  if (previous.summary !== current.summary) {
    result.summary = { previous: previous.summary, current: current.summary };
  }
  const topLevelCitations = citationListDelta(previous.citations, current.citations);
  if (topLevelCitations) result.topLevelCitations = topLevelCitations;
  return result;
}

function assertDeltaBounds(delta: DeltaWithoutChecksum): void {
  const nodeChanges =
    delta.nodes.added.length + delta.nodes.removed.length + delta.nodes.reassessed.length;
  const edgeChanges =
    delta.confirmedEdges.added.length +
    delta.confirmedEdges.removed.length +
    delta.confirmedEdges.changed.length;
  const contradictionChanges =
    delta.contradictions.opened.length + delta.contradictions.resolved.length;
  const paragraphChanges = delta.sectionText.reduce(
    (sum, section) => sum + section.paragraphChanges.length,
    0,
  );
  const paragraphCitationChanges = delta.secondaryDocument.paragraphCitations.length;
  if (
    nodeChanges > SYNTHESIS_GENERATION_DELTA_LIMITS.maxNodeChanges ||
    edgeChanges > SYNTHESIS_GENERATION_DELTA_LIMITS.maxEdgeChanges ||
    contradictionChanges > SYNTHESIS_GENERATION_DELTA_LIMITS.maxContradictionChanges ||
    paragraphChanges > SYNTHESIS_GENERATION_DELTA_LIMITS.maxSectionParagraphChanges ||
    paragraphCitationChanges > SYNTHESIS_GENERATION_DELTA_LIMITS.maxParagraphCitationChanges ||
    Buffer.byteLength(canonicalJson(delta), "utf8") >
      SYNTHESIS_GENERATION_DELTA_LIMITS.maxCanonicalBytes
  ) {
    throw new SynthesisGenerationDeltaError("overflow", "Generation delta exceeds its bounds.");
  }
}

/**
 * Pure comparison of two complete generation snapshots. Structured evidence changes are the
 * primary artifact; paragraph text changes are intentionally secondary and positional.
 */
export function compareSynthesisGenerations(
  previousValue: unknown,
  currentValue: unknown,
): SynthesisGenerationDelta {
  const previous = assertSnapshot(previousValue);
  const current = assertSnapshot(currentValue);
  const previousNodes = new Map(previous.packet.nodes.map((node) => [node.id, node]));
  const currentNodes = new Map(current.packet.nodes.map((node) => [node.id, node]));
  for (const [nodeId, oldNode] of previousNodes) {
    const newNode = currentNodes.get(nodeId);
    if (
      newNode?.versionId === oldNode.versionId &&
      canonicalJson(oldNode) !== canonicalJson(newNode)
    ) {
      throw new SynthesisGenerationDeltaError(
        "immutable-node-drift",
        "One immutable node identity has conflicting canonical content.",
      );
    }
  }
  const added = [...currentNodes.keys()]
    .filter((nodeId) => !previousNodes.has(nodeId))
    .sort(compare)
    .map((nodeId) => nodeReference(current.packet, nodeId));
  const removed = [...previousNodes.keys()]
    .filter((nodeId) => !currentNodes.has(nodeId))
    .sort(compare)
    .map((nodeId) => nodeReference(previous.packet, nodeId));
  const reassessed = [...previousNodes.keys()]
    .filter(
      (nodeId) =>
        currentNodes.has(nodeId) &&
        previousNodes.get(nodeId)!.versionId !== currentNodes.get(nodeId)!.versionId,
    )
    .sort(compare)
    .map((nodeId): SynthesisDeltaNodeReassessment => {
      const oldReference = nodeReference(previous.packet, nodeId);
      const newReference = nodeReference(current.packet, nodeId);
      return {
        nodeId,
        previous: {
          nodeVersionId: oldReference.nodeVersionId,
          referenceId: oldReference.referenceId,
        },
        current: {
          nodeVersionId: newReference.nodeVersionId,
          referenceId: newReference.referenceId,
        },
      };
    });

  const previousEdges = new Map(previous.packet.edges.map((edge) => [edge.id, edge]));
  const currentEdges = new Map(current.packet.edges.map((edge) => [edge.id, edge]));
  const edgesAdded = [...currentEdges.keys()]
    .filter((edgeId) => !previousEdges.has(edgeId))
    .sort(compare)
    .map((edgeId) => edgeReference(currentEdges.get(edgeId)!));
  const edgesRemoved = [...previousEdges.keys()]
    .filter((edgeId) => !currentEdges.has(edgeId))
    .sort(compare)
    .map((edgeId) => edgeReference(previousEdges.get(edgeId)!));
  const edgesChanged = [...previousEdges.keys()]
    .filter(
      (edgeId) =>
        currentEdges.has(edgeId) &&
        canonicalJson(previousEdges.get(edgeId)) !== canonicalJson(currentEdges.get(edgeId)),
    )
    .sort(compare)
    .map((edgeId): SynthesisDeltaEdgeChange => {
      const oldEdge = previousEdges.get(edgeId)!;
      const newEdge = currentEdges.get(edgeId)!;
      const changedFields: SynthesisDeltaEdgeChange["changedFields"] = [];
      if (canonicalJson(edgeBinding(oldEdge)) !== canonicalJson(edgeBinding(newEdge))) {
        changedFields.push("binding");
      }
      const oldTrust = oldEdge.trustAssessments ?? (oldEdge.trust ? [oldEdge.trust] : []);
      const newTrust = newEdge.trustAssessments ?? (newEdge.trust ? [newEdge.trust] : []);
      if (canonicalJson(oldTrust) !== canonicalJson(newTrust)) {
        changedFields.push("trust");
      }
      if (canonicalJson(edgeMetadata(oldEdge)) !== canonicalJson(edgeMetadata(newEdge))) {
        changedFields.push("confirmation-metadata");
      }
      return {
        edgeId,
        previous: edgeBinding(oldEdge),
        current: edgeBinding(newEdge),
        changedFields,
      };
    });

  const previousContradictions = new Map(
    previous.packet.contradictions.map((pair) => [contradictionKey(pair), pair]),
  );
  const currentContradictions = new Map(
    current.packet.contradictions.map((pair) => [contradictionKey(pair), pair]),
  );
  const opened = [...currentContradictions.keys()]
    .filter((key) => !previousContradictions.has(key))
    .sort(compare)
    .map((key) => contradictionReference(currentContradictions.get(key)!));
  const resolved = [...previousContradictions.keys()]
    .filter((key) => !currentContradictions.has(key))
    .sort(compare)
    .map((key) => contradictionReference(previousContradictions.get(key)!));
  const sectionText = sectionTextDelta(previous.document, current.document);
  const secondaryDocument = secondaryDocumentDelta(previous.document, current.document);
  const isNoop =
    added.length === 0 &&
    removed.length === 0 &&
    reassessed.length === 0 &&
    edgesAdded.length === 0 &&
    edgesRemoved.length === 0 &&
    edgesChanged.length === 0 &&
    opened.length === 0 &&
    resolved.length === 0 &&
    sectionText.length === 0 &&
    !secondaryDocument.title &&
    !secondaryDocument.summary &&
    !secondaryDocument.topLevelCitations &&
    secondaryDocument.paragraphCitations.length === 0 &&
    previous.packetHash === current.packetHash &&
    previous.documentHash === current.documentHash;
  const delta: DeltaWithoutChecksum = {
    schemaVersion: SYNTHESIS_GENERATION_DELTA_VERSION,
    previous: { packetHash: previous.packetHash, documentHash: previous.documentHash },
    current: { packetHash: current.packetHash, documentHash: current.documentHash },
    nodes: { added, removed, reassessed },
    confirmedEdges: { added: edgesAdded, removed: edgesRemoved, changed: edgesChanged },
    contradictions: { opened, resolved },
    sectionText,
    secondaryDocument,
    isNoop,
  };
  assertDeltaBounds(delta);
  return { ...delta, checksum: digest(canonicalJson(delta)) };
}

/** Read-time checksum verification for a stored delta. */
export function verifySynthesisGenerationDelta(delta: SynthesisGenerationDelta): boolean {
  const { checksum, ...content } = delta;
  return /^[0-9a-f]{64}$/.test(checksum) && digest(canonicalJson(content)) === checksum;
}
