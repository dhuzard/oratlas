import { z } from "zod";
import {
  assessmentReviewStatusSchema,
  nodeRelationTypeSchema,
  trustOrdinalSchema,
  trustVerificationStateSchema,
  TRUST_CRITERIA,
} from "./enums.js";
import { commitShaSchema, httpsUrlSchema } from "./identifiers.js";
import {
  claimNodePayloadSchema,
  codeNodePayloadSchema,
  datasetNodePayloadSchema,
  figureNodePayloadSchema,
  localNodeIdSchema,
} from "./knowledge-nodes.js";
import { manifestContributorSchema } from "./manifest.js";
import { publicNodeIdentifierSchema } from "./node-publication.js";
import { safeRepoRelativePathSchema } from "./paths.js";
import { canonicalJson } from "./canonical-json.js";

/** Graph-native evidence packets are separate from Atlas Discuss EvidencePacket 1.1. */
export const SUBGRAPH_EVIDENCE_SCHEMA_VERSION = "1.0.0" as const;
export const SUBGRAPH_EVIDENCE_SOURCE_SCHEMA_VERSION = "bounded-subgraph/1.0.0" as const;

export const SUBGRAPH_EVIDENCE_LIMITS = {
  maxNodes: 100,
  maxEdges: 500,
  maxIdentifiers: 300,
  maxTotalTextBytes: 1_000_000,
  maxPacketBytes: 1_250_000,
} as const;
export const SUBGRAPH_EVIDENCE_AGGREGATE_METHOD = "ordinal-mean-1.0" as const;

const boundedIdSchema = z.string().trim().min(1).max(200);
const utf8Encoder = new TextEncoder();

function countEvidenceStringBytes(value: unknown): number {
  if (typeof value === "string") return utf8Encoder.encode(value).byteLength;
  if (Array.isArray(value)) {
    return value.reduce((sum, entry) => sum + countEvidenceStringBytes(entry), 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (sum, entry) => sum + countEvidenceStringBytes(entry),
      0,
    );
  }
  return 0;
}

export const subgraphEvidenceSelectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("seed"),
      nodeId: boundedIdSchema,
      versionId: boundedIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("topic"),
      canonicalQuery: z.string().min(1).max(500),
      seedNodeIds: z.array(boundedIdSchema).min(1).max(10),
    })
    .strict(),
]);
export type SubgraphEvidenceSelection = z.infer<typeof subgraphEvidenceSelectionSchema>;

export const subgraphEvidenceSourceDescriptorSchema = z
  .object({
    kind: z.literal("bounded-supplied-subgraph"),
    selectorFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type SubgraphEvidenceSourceDescriptor = z.infer<
  typeof subgraphEvidenceSourceDescriptorSchema
>;

const repositorySchema = z
  .object({
    owner: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    url: httpsUrlSchema,
  })
  .strict();

const requiredNodeProvenanceSchema = z
  .object({
    sourcePath: safeRepoRelativePathSchema,
    sourcePointer: z.string().min(1).max(512).optional(),
    repositoryUrl: httpsUrlSchema,
    commitSha: commitShaSchema,
    declaredAt: z.string().datetime().optional(),
  })
  .strict();

const evidenceNodeBase = {
  id: boundedIdSchema,
  localNodeId: localNodeIdSchema,
  repository: repositorySchema,
  versionId: boundedIdSchema,
  snapshotId: boundedIdSchema,
  commitSha: commitShaSchema,
  title: z.string().min(1).max(500),
  abstract: z.string().min(1).max(10_000).optional(),
  text: z.string().min(1).max(100_000).optional(),
  contributors: z.array(manifestContributorSchema).max(200),
  license: z.string().min(1).max(120),
  provenance: requiredNodeProvenanceSchema,
  identifiers: z.array(publicNodeIdentifierSchema).max(3),
  isExample: z.boolean(),
  createdAt: z.string().datetime(),
};

/** Exact immutable versions, including the complete bounded content used by a writer. */
export const subgraphEvidenceNodeSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...evidenceNodeBase, kind: z.literal("claim"), payload: claimNodePayloadSchema })
    .strict(),
  z
    .object({ ...evidenceNodeBase, kind: z.literal("figure"), payload: figureNodePayloadSchema })
    .strict(),
  z
    .object({ ...evidenceNodeBase, kind: z.literal("dataset"), payload: datasetNodePayloadSchema })
    .strict(),
  z
    .object({ ...evidenceNodeBase, kind: z.literal("code"), payload: codeNodePayloadSchema })
    .strict(),
]);
export type SubgraphEvidenceNode = z.infer<typeof subgraphEvidenceNodeSchema>;

const trustCriterionSchema = z
  .object({
    criterion: z.enum(TRUST_CRITERIA),
    rating: trustOrdinalSchema,
    status: z.enum(["assessed", "not-assessed", "not-applicable"]),
    rationale: z.string().max(4_000).optional(),
    evidencePointer: z.string().max(500).optional(),
  })
  .strict();

export const subgraphEvidenceTrustSchema = z
  .object({
    subject: z
      .object({
        sourceNodeId: boundedIdSchema,
        sourceVersionId: boundedIdSchema,
        targetNodeId: boundedIdSchema,
        targetVersionId: boundedIdSchema,
        relationType: nodeRelationTypeSchema,
      })
      .strict(),
    assessmentId: boundedIdSchema,
    protocolVersion: z.string().min(1).max(120),
    reviewStatus: assessmentReviewStatusSchema,
    verificationState: trustVerificationStateSchema,
    criteria: z.array(trustCriterionSchema).min(1).max(TRUST_CRITERIA.length),
    limitations: z.array(z.string().max(2_000)).max(50).optional(),
    aggregateScore: z.number().min(0).max(1).optional(),
    aggregateMethod: z.literal(SUBGRAPH_EVIDENCE_AGGREGATE_METHOD).optional(),
  })
  .strict()
  .superRefine((trust, context) => {
    if (trust.aggregateScore !== undefined && !trust.aggregateMethod) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aggregateMethod"],
        message: "An aggregate score requires its aggregation method.",
      });
    }
    if (trust.aggregateMethod !== undefined && trust.aggregateScore === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aggregateScore"],
        message: "An aggregation method requires its aggregate score.",
      });
    }
    if (
      trust.aggregateScore !== undefined &&
      !trust.criteria.some((criterion) => criterion.status === "assessed")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aggregateScore"],
        message: "A TRUST aggregate requires at least one assessed criterion.",
      });
    }
    const ordinalValues: Record<string, number | undefined> = {
      "very-low": 0,
      low: 0.25,
      moderate: 0.5,
      high: 0.75,
      "very-high": 1,
    };
    const values = trust.criteria.flatMap((criterion) => {
      const value = ordinalValues[criterion.rating];
      return criterion.status === "assessed" && value !== undefined ? [value] : [];
    });
    if (
      trust.criteria.some(
        (criterion) =>
          criterion.status === "assessed" && ordinalValues[criterion.rating] === undefined,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criteria"],
        message: "An assessed criterion requires an assessed ordinal rating.",
      });
    }
    if (
      trust.criteria.some(
        (criterion) =>
          (criterion.status === "not-assessed" && criterion.rating !== "not-assessed") ||
          (criterion.status === "not-applicable" && criterion.rating !== "not-applicable"),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criteria"],
        message: "A non-assessed criterion rating must exactly match its status.",
      });
    }
    if (trust.aggregateScore !== undefined && values.length > 0) {
      const expected =
        Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
      if (trust.aggregateScore !== expected) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aggregateScore"],
          message: "TRUST aggregate must equal the documented ordinal mean.",
        });
      }
    }
    const authoritative =
      trust.verificationState === "platform-verified" &&
      (trust.reviewStatus === "human-reviewed" || trust.reviewStatus === "adjudicated");
    const failClosed =
      trust.verificationState !== "platform-verified" && trust.reviewStatus === "unverified-import";
    if (!authoritative && !failClosed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewStatus"],
        message: "TRUST review status must match its verification state.",
      });
    }
    const criteria = trust.criteria.map((criterion) => criterion.criterion);
    if (new Set(criteria).size !== criteria.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criteria"],
        message: "TRUST criteria must be unique within an assessment.",
      });
    }
  });
export type SubgraphEvidenceTrust = z.infer<typeof subgraphEvidenceTrustSchema>;

/** Only editor-confirmed, exact-version relations can enter writer evidence. */
export const subgraphEvidenceEdgeSchema = z
  .object({
    id: boundedIdSchema,
    sourceNodeId: boundedIdSchema,
    sourceVersionId: boundedIdSchema,
    targetNodeId: boundedIdSchema,
    targetVersionId: boundedIdSchema,
    relationType: nodeRelationTypeSchema,
    status: z.literal("confirmed"),
    provenance: z.literal("confirmed-by-editor"),
    rationale: z.string().max(4_000).optional(),
    assertedAt: z.string().datetime().optional(),
    confirmedAt: z.string().datetime(),
    /** Legacy single-assessment packet field; never populated by new materialization. */
    trust: subgraphEvidenceTrustSchema.optional(),
    trustAssessments: z.array(subgraphEvidenceTrustSchema).optional(),
  })
  .strict();
export type SubgraphEvidenceEdge = z.infer<typeof subgraphEvidenceEdgeSchema>;

export const subgraphEvidenceSourceSchema = z
  .object({
    schemaVersion: z.literal(SUBGRAPH_EVIDENCE_SOURCE_SCHEMA_VERSION),
    selection: subgraphEvidenceSelectionSchema,
    source: subgraphEvidenceSourceDescriptorSchema,
    declaredCounts: z
      .object({
        nodeCount: z.number().int().nonnegative().max(SUBGRAPH_EVIDENCE_LIMITS.maxNodes),
        edgeCount: z.number().int().nonnegative().max(SUBGRAPH_EVIDENCE_LIMITS.maxEdges),
        contradictionEdgeIds: z.array(boundedIdSchema).max(SUBGRAPH_EVIDENCE_LIMITS.maxEdges),
      })
      .strict(),
    nodes: z.array(subgraphEvidenceNodeSchema).max(SUBGRAPH_EVIDENCE_LIMITS.maxNodes),
    edges: z.array(subgraphEvidenceEdgeSchema).max(SUBGRAPH_EVIDENCE_LIMITS.maxEdges),
  })
  .strict();
export type SubgraphEvidenceSource = z.infer<typeof subgraphEvidenceSourceSchema>;

const evidenceReferenceIdSchema = z.string().regex(/^reference:sha256:[0-9a-f]{64}$/);

export const subgraphEvidenceReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      referenceId: evidenceReferenceIdSchema,
      kind: z.literal("node"),
      nodeId: boundedIdSchema,
      nodeVersionId: boundedIdSchema,
    })
    .strict(),
  publicNodeIdentifierSchema
    .extend({
      referenceId: evidenceReferenceIdSchema,
      kind: z.literal("identifier"),
      nodeId: boundedIdSchema,
      nodeVersionId: boundedIdSchema,
      isExample: z.literal(false),
    })
    .strict(),
]);
export type SubgraphEvidenceReference = z.infer<typeof subgraphEvidenceReferenceSchema>;

const contradictionEndpointSchema = z
  .object({ nodeId: boundedIdSchema, versionId: boundedIdSchema })
  .strict();

export const subgraphEvidenceContradictionSchema = z
  .object({
    left: contradictionEndpointSchema,
    right: contradictionEndpointSchema,
    edgeIds: z.array(boundedIdSchema).min(1).max(2),
    provenance: z
      .array(
        z
          .object({
            edgeId: boundedIdSchema,
            provenance: z.literal("confirmed-by-editor"),
            confirmedAt: z.string().datetime(),
          })
          .strict(),
      )
      .min(1)
      .max(2),
  })
  .strict();
export type SubgraphEvidenceContradiction = z.infer<typeof subgraphEvidenceContradictionSchema>;

/** Strict, canonical writer input. It deliberately contains no clock or operational fields. */
export const subgraphEvidencePacketSchema = z
  .object({
    schemaVersion: z.literal(SUBGRAPH_EVIDENCE_SCHEMA_VERSION),
    selection: subgraphEvidenceSelectionSchema,
    source: subgraphEvidenceSourceDescriptorSchema,
    nodes: z.array(subgraphEvidenceNodeSchema).max(SUBGRAPH_EVIDENCE_LIMITS.maxNodes),
    edges: z.array(subgraphEvidenceEdgeSchema).max(SUBGRAPH_EVIDENCE_LIMITS.maxEdges),
    references: z
      .array(subgraphEvidenceReferenceSchema)
      .max(SUBGRAPH_EVIDENCE_LIMITS.maxNodes + SUBGRAPH_EVIDENCE_LIMITS.maxIdentifiers),
    /** Exact eligible identifier reference ids; node references are always cited separately. */
    identifierWhitelist: z
      .array(evidenceReferenceIdSchema)
      .max(SUBGRAPH_EVIDENCE_LIMITS.maxIdentifiers),
    contradictions: z
      .array(subgraphEvidenceContradictionSchema)
      .max(SUBGRAPH_EVIDENCE_LIMITS.maxEdges),
  })
  .strict()
  .superRefine((packet, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const sorted = (values: string[]) => [...values].sort();
    const nodeKey = (node: { id: string; versionId: string }) =>
      `${node.id}\u0000${node.versionId}`;
    const nodes = new Map(packet.nodes.map((node) => [node.id, node]));

    const nodeKeys = packet.nodes.map(nodeKey);
    if (new Set(packet.nodes.map((node) => node.id)).size !== packet.nodes.length) {
      issue(["nodes"], "A packet contains exactly one immutable version per node id.");
    }
    if (new Set(packet.nodes.map((node) => node.versionId)).size !== packet.nodes.length) {
      issue(["nodes"], "Node version ids must be unique.");
    }
    if (new Set(nodeKeys).size !== nodeKeys.length)
      issue(["nodes"], "Node versions must be unique.");
    if (JSON.stringify(nodeKeys) !== JSON.stringify(sorted(nodeKeys))) {
      issue(["nodes"], "Node versions must use canonical ordering.");
    }
    const edgeIds = packet.edges.map((edge) => edge.id);
    if (new Set(edgeIds).size !== edgeIds.length) issue(["edges"], "Edge ids must be unique.");
    const trustAssessmentIds = packet.edges.flatMap((edge) => [
      ...(edge.trust ? [edge.trust.assessmentId] : []),
      ...(edge.trustAssessments ?? []).map((assessment) => assessment.assessmentId),
    ]);
    if (new Set(trustAssessmentIds).size !== trustAssessmentIds.length) {
      issue(["edges"], "A TRUST assessment can own only one exact relation subject.");
    }
    const edgeKeys = packet.edges.map((edge) =>
      [
        edge.sourceNodeId,
        edge.sourceVersionId,
        edge.relationType,
        edge.targetNodeId,
        edge.targetVersionId,
        edge.id,
      ].join("\u0000"),
    );
    if (JSON.stringify(edgeKeys) !== JSON.stringify(sorted(edgeKeys))) {
      issue(["edges"], "Edges must use canonical ordering.");
    }
    for (const [index, edge] of packet.edges.entries()) {
      const source = nodes.get(edge.sourceNodeId);
      const target = nodes.get(edge.targetNodeId);
      if (!source || !target) {
        issue(["edges", index], "Every edge endpoint must be present in the packet.");
      } else if (
        source.versionId !== edge.sourceVersionId ||
        target.versionId !== edge.targetVersionId
      ) {
        issue(["edges", index], "Every edge must bind the exact packet node versions.");
      }
      const assessments = edge.trustAssessments ?? (edge.trust ? [edge.trust] : []);
      for (const [assessmentIndex, assessment] of assessments.entries()) {
        if (
          assessment.subject.sourceNodeId !== edge.sourceNodeId ||
          assessment.subject.sourceVersionId !== edge.sourceVersionId ||
          assessment.subject.targetNodeId !== edge.targetNodeId ||
          assessment.subject.targetVersionId !== edge.targetVersionId ||
          assessment.subject.relationType !== edge.relationType
        ) {
          issue(
            ["edges", index, "trust", assessmentIndex, "subject"],
            "TRUST subject must equal its exact edge.",
          );
        }
      }
      if (assessments.length > 0 && source && target) {
        const expectedRelation =
          target.kind === "dataset"
            ? "uses-dataset"
            : target.kind === "code"
              ? "uses-code"
              : target.kind === "figure"
                ? "derives-from"
                : undefined;
        if (
          source.kind !== "claim" ||
          !expectedRelation ||
          (edge.relationType !== expectedRelation && edge.relationType !== "derives-from")
        ) {
          issue(
            ["edges", index, "trust"],
            "TRUST is allowed only on an exact claim-to-evidence relation.",
          );
        }
      }
    }

    const referenceIds = packet.references.map((reference) => reference.referenceId);
    if (new Set(referenceIds).size !== referenceIds.length) {
      issue(["references"], "Reference ids must be unique.");
    }
    if (JSON.stringify(referenceIds) !== JSON.stringify(sorted(referenceIds))) {
      issue(["references"], "References must use canonical ordering.");
    }
    const nodeReferences = packet.references.filter((reference) => reference.kind === "node");
    const expectedNodeRefs = sorted(nodeKeys);
    const actualNodeRefs = sorted(
      nodeReferences.map((reference) => `${reference.nodeId}\u0000${reference.nodeVersionId}`),
    );
    if (JSON.stringify(expectedNodeRefs) !== JSON.stringify(actualNodeRefs)) {
      issue(["references"], "References must contain every exact node version once.");
    }

    const eligibleIdentifiers = packet.nodes.flatMap((node) =>
      node.identifiers
        .filter((identifier) => !node.isExample && !identifier.isExample)
        .map(
          (identifier) =>
            `${node.id}\u0000${node.versionId}\u0000${identifier.scheme}\u0000${identifier.role}\u0000${identifier.value.normalize("NFKC").toLowerCase()}`,
        ),
    );
    const identifierReferences = packet.references.filter(
      (reference) => reference.kind === "identifier",
    );
    const actualIdentifiers = identifierReferences.map(
      (reference) =>
        `${reference.nodeId}\u0000${reference.nodeVersionId}\u0000${reference.scheme}\u0000${reference.role}\u0000${reference.value}`,
    );
    if (JSON.stringify(sorted(eligibleIdentifiers)) !== JSON.stringify(sorted(actualIdentifiers))) {
      issue(
        ["references"],
        "Identifier references must exactly match eligible, non-example node identifiers.",
      );
    }
    for (const [index, reference] of identifierReferences.entries()) {
      if (reference.value !== reference.value.normalize("NFKC").toLowerCase()) {
        issue(["references", index, "value"], "Identifier references must be normalized.");
      }
    }
    const expectedWhitelist = sorted(
      identifierReferences.map((reference) => reference.referenceId),
    );
    if (
      JSON.stringify(packet.identifierWhitelist) !== JSON.stringify(expectedWhitelist) ||
      new Set(packet.identifierWhitelist).size !== packet.identifierWhitelist.length
    ) {
      issue(
        ["identifierWhitelist"],
        "Identifier whitelist must exactly list canonical identifier reference ids.",
      );
    }

    const contradictionEdges = new Map(
      packet.edges
        .filter((edge) => edge.relationType === "contradicts")
        .map((edge) => [edge.id, edge]),
    );
    const represented = new Set<string>();
    const pairKeys = new Set<string>();
    const contradictionOrder = packet.contradictions.map(
      (pair) =>
        `${pair.left.nodeId}\u0000${pair.left.versionId}\u0001${pair.right.nodeId}\u0000${pair.right.versionId}`,
    );
    if (JSON.stringify(contradictionOrder) !== JSON.stringify(sorted(contradictionOrder))) {
      issue(["contradictions"], "Contradiction pairs must use canonical ordering.");
    }
    for (const [index, pair] of packet.contradictions.entries()) {
      const leftKey = `${pair.left.nodeId}\u0000${pair.left.versionId}`;
      const rightKey = `${pair.right.nodeId}\u0000${pair.right.versionId}`;
      if (leftKey >= rightKey) {
        issue(["contradictions", index], "Contradiction endpoints must be canonical and distinct.");
      }
      const pairKey = `${leftKey}\u0001${rightKey}`;
      if (pairKeys.has(pairKey))
        issue(["contradictions", index], "Contradiction pairs must be unique.");
      pairKeys.add(pairKey);
      if (JSON.stringify(pair.edgeIds) !== JSON.stringify(sorted(pair.edgeIds))) {
        issue(["contradictions", index, "edgeIds"], "Contradiction edge ids must be sorted.");
      }
      for (const edgeId of pair.edgeIds) {
        const edge = contradictionEdges.get(edgeId);
        if (!edge || represented.has(edgeId)) {
          issue(
            ["contradictions", index, "edgeIds"],
            "Contradiction edges must occur exactly once.",
          );
          continue;
        }
        represented.add(edgeId);
        const endpoints = sorted([
          `${edge.sourceNodeId}\u0000${edge.sourceVersionId}`,
          `${edge.targetNodeId}\u0000${edge.targetVersionId}`,
        ]);
        if (endpoints[0] !== leftKey || endpoints[1] !== rightKey) {
          issue(["contradictions", index], "Contradiction pair endpoints do not match its edges.");
        }
        const provenance = pair.provenance.find((entry) => entry.edgeId === edgeId);
        if (
          !provenance ||
          provenance.provenance !== edge.provenance ||
          provenance.confirmedAt !== edge.confirmedAt
        ) {
          issue(["contradictions", index, "provenance"], "Contradiction provenance is incomplete.");
        }
      }
      if (pair.provenance.length !== pair.edgeIds.length) {
        issue(["contradictions", index, "provenance"], "Contradiction provenance must be exact.");
      }
    }
    if (represented.size !== contradictionEdges.size) {
      issue(["contradictions"], "Every contradiction in the subgraph must be represented.");
    }
    if (
      countEvidenceStringBytes({
        selection: packet.selection,
        nodes: packet.nodes,
        edges: packet.edges,
      }) > SUBGRAPH_EVIDENCE_LIMITS.maxTotalTextBytes
    ) {
      issue([], "Packet text exceeds the UTF-8 byte cap.");
    }
    if (
      utf8Encoder.encode(canonicalJson(packet)).byteLength > SUBGRAPH_EVIDENCE_LIMITS.maxPacketBytes
    ) {
      issue([], "Canonical packet exceeds the final UTF-8 byte cap.");
    }
  });
export type SubgraphEvidencePacket = z.infer<typeof subgraphEvidencePacketSchema>;
