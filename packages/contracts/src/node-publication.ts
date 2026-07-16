import { z } from "zod";
import {
  codeNodePayloadSchema,
  datasetNodePayloadSchema,
  figureNodePayloadSchema,
  claimNodePayloadSchema,
  knowledgeNodeProvenanceSchema,
} from "./knowledge-nodes.js";
import {
  assessmentReviewStatusSchema,
  knowledgeNodeKindSchema,
  nodeEdgeProvenanceSchema,
  nodeRelationTypeSchema,
  trustVerificationStateSchema,
} from "./enums.js";
import { doiSchema, httpsUrlSchema } from "./identifiers.js";
import { manifestContributorSchema } from "./manifest.js";

export const archiveContentTypeSchema = z.enum(["all", "review", "node"]);

export const nodeArchiveQuerySchema = z
  .object({
    q: z.string().trim().max(500).optional(),
    kind: knowledgeNodeKindSchema.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type NodeArchiveQuery = z.infer<typeof nodeArchiveQuerySchema>;

export const publicNodeIdentifierSchema = z
  .object({
    scheme: z.literal("doi"),
    role: z.enum(["version-doi", "concept-doi", "artifact-doi"]),
    value: doiSchema,
    isExample: z.boolean(),
  })
  .strict();
export type PublicNodeIdentifier = z.infer<typeof publicNodeIdentifierSchema>;

const publicNodeVersionBase = {
  id: z.string().min(1),
  snapshotId: z.string().min(1),
  commitSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i),
  title: z.string().min(1).max(500),
  abstract: z.string().min(1).max(10_000).optional(),
  text: z.string().min(1).max(100_000).optional(),
  contributors: z.array(manifestContributorSchema).max(200),
  license: z.string().min(1).max(120),
  provenance: knowledgeNodeProvenanceSchema,
  identifiers: z.array(publicNodeIdentifierSchema).max(3),
  isExample: z.boolean(),
  createdAt: z.string().datetime(),
};

export const publicNodeVersionSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...publicNodeVersionBase, kind: z.literal("claim"), payload: claimNodePayloadSchema })
    .strict(),
  z
    .object({
      ...publicNodeVersionBase,
      kind: z.literal("figure"),
      payload: figureNodePayloadSchema,
    })
    .strict(),
  z
    .object({
      ...publicNodeVersionBase,
      kind: z.literal("dataset"),
      payload: datasetNodePayloadSchema,
    })
    .strict(),
  z
    .object({ ...publicNodeVersionBase, kind: z.literal("code"), payload: codeNodePayloadSchema })
    .strict(),
]);
export type PublicNodeVersion = z.infer<typeof publicNodeVersionSchema>;

export const publicNodeVersionSummarySchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(500),
    commitSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i),
    createdAt: z.string().datetime(),
    isCurrent: z.boolean(),
  })
  .strict();
export type PublicNodeVersionSummary = z.infer<typeof publicNodeVersionSummarySchema>;

export const publicNodeSummarySchema = z
  .object({
    id: z.string().min(1),
    localNodeId: z.string().min(1).max(120),
    kind: knowledgeNodeKindSchema,
    title: z.string().min(1).max(500),
    abstract: z.string().max(10_000).optional(),
    repository: z.object({ owner: z.string(), name: z.string(), url: httpsUrlSchema }).strict(),
    currentVersionId: z.string().min(1),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PublicNodeSummary = z.infer<typeof publicNodeSummarySchema>;

export const publicRelatedNodeVersionSchema = publicNodeSummarySchema
  .omit({ currentVersionId: true, updatedAt: true })
  .extend({
    versionId: z.string().min(1),
    versionCreatedAt: z.string().datetime(),
  })
  .strict();
export type PublicRelatedNodeVersion = z.infer<typeof publicRelatedNodeVersionSchema>;

export const publicNodeEdgeSchema = z
  .object({
    id: z.string().min(1),
    direction: z.enum(["incoming", "outgoing"]),
    relationType: nodeRelationTypeSchema,
    provenance: nodeEdgeProvenanceSchema,
    rationale: z.string().max(4_000).optional(),
    assertedAt: z.string().datetime().optional(),
    trust: z
      .object({
        assessmentId: z.string().min(1),
        protocolVersion: z.string().min(1).max(40),
        reviewStatus: assessmentReviewStatusSchema,
        verificationState: trustVerificationStateSchema,
      })
      .strict()
      .optional(),
    relatedNode: publicRelatedNodeVersionSchema,
  })
  .strict();

export const publicNodeTrustContextSchema = z
  .object({
    claimId: z.string().min(1),
    claimLocalId: z.string().min(1),
    reviewSlug: z.string().min(1),
    reviewVersionId: z.string().min(1),
    citationId: z.string().min(1),
    citationLocalId: z.string().min(1),
    citationTitle: z.string().optional(),
    citationDoi: doiSchema.optional(),
    citationIsExample: z.boolean(),
    relationType: z.string().min(1),
    trust: z
      .object({
        reviewStatus: assessmentReviewStatusSchema,
        verificationState: trustVerificationStateSchema,
        aggregateScore: z.number().min(0).max(1).optional(),
        aggregateMethod: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const publicNodeDetailSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    id: z.string().min(1),
    localNodeId: z.string().min(1).max(120),
    kind: knowledgeNodeKindSchema,
    repository: z.object({ owner: z.string(), name: z.string(), url: httpsUrlSchema }).strict(),
    version: publicNodeVersionSchema,
    versions: z.array(publicNodeVersionSummarySchema).min(1),
    edges: z.array(publicNodeEdgeSchema),
    trustContext: z.array(publicNodeTrustContextSchema),
  })
  .strict();
export type PublicNodeDetail = z.infer<typeof publicNodeDetailSchema>;

export const publicNodeListResponseSchema = z
  .object({
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    items: z.array(publicNodeSummarySchema),
  })
  .strict();
export type PublicNodeListResponse = z.infer<typeof publicNodeListResponseSchema>;

export const publicNodeVersionListResponseSchema = z
  .object({
    nodeId: z.string().min(1),
    currentVersionId: z.string().min(1),
    items: z.array(publicNodeVersionSummarySchema).min(1),
  })
  .strict();
export type PublicNodeVersionListResponse = z.infer<typeof publicNodeVersionListResponseSchema>;
