import { z } from "zod";
import {
  knowledgeNodeKindSchema,
  nodeEdgeProvenanceSchema,
  nodeRelationTypeSchema,
} from "./enums.js";
import { httpsUrlSchema } from "./identifiers.js";
import { knowledgeNodeProvenanceSchema } from "./knowledge-nodes.js";
import { publicNodeIdentifierSchema } from "./node-publication.js";

export const GRAPH_MAX_DEPTH = 3;
export const GRAPH_MAX_PAGE_SIZE = 50;

export const publicGraphQuerySchema = z
  .object({
    seed: z.string().trim().min(1).max(200).optional(),
    q: z.string().trim().min(1).max(500).optional(),
    depth: z.number().int().min(0).max(GRAPH_MAX_DEPTH).default(1),
    limit: z.number().int().min(1).max(GRAPH_MAX_PAGE_SIZE).default(25),
    cursor: z.string().trim().min(1).max(512).optional(),
    kind: knowledgeNodeKindSchema.optional(),
    relationType: nodeRelationTypeSchema.optional(),
    edgeStatus: z.enum(["confirmed", "proposed"]).default("confirmed"),
    hasTrust: z.boolean().optional(),
  })
  .strict()
  .refine((query) => Boolean(query.seed) !== Boolean(query.q), {
    message: "Provide exactly one of seed or q.",
  });
export type PublicGraphQuery = z.infer<typeof publicGraphQuerySchema>;

export const publicGraphNodeSchema = z
  .object({
    id: z.string().min(1),
    localNodeId: z.string().min(1).max(120),
    kind: knowledgeNodeKindSchema,
    repository: z.object({ owner: z.string(), name: z.string(), url: httpsUrlSchema }).strict(),
    versionId: z.string().min(1),
    title: z.string().min(1).max(500),
    abstract: z.string().max(10_000).optional(),
    provenance: knowledgeNodeProvenanceSchema,
    identifiers: z.array(publicNodeIdentifierSchema).max(3),
    createdAt: z.string().datetime(),
    hasTrust: z.boolean(),
  })
  .strict();
export type PublicGraphNode = z.infer<typeof publicGraphNodeSchema>;

const publicGraphEdgeBase = {
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  sourceVersionId: z.string().min(1),
  targetNodeId: z.string().min(1),
  targetVersionId: z.string().min(1),
  relationType: nodeRelationTypeSchema,
  rationale: z.string().max(4_000).optional(),
  assertedAt: z.string().datetime().optional(),
};

export const publicGraphEdgeSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...publicGraphEdgeBase,
      status: z.literal("confirmed"),
      provenance: z.literal("confirmed-by-editor"),
      confirmedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      ...publicGraphEdgeBase,
      status: z.literal("proposed"),
      provenance: nodeEdgeProvenanceSchema.exclude(["confirmed-by-editor"]),
      proposedAt: z.string().datetime(),
    })
    .strict(),
]);
export type PublicGraphEdge = z.infer<typeof publicGraphEdgeSchema>;

export const publicGraphResponseSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    seedNodeIds: z.array(z.string().min(1)).max(10),
    depth: z.number().int().min(0).max(GRAPH_MAX_DEPTH),
    nodes: z.array(publicGraphNodeSchema).max(110),
    edges: z.array(publicGraphEdgeSchema).max(GRAPH_MAX_PAGE_SIZE),
    page: z
      .object({
        limit: z.number().int().min(1).max(GRAPH_MAX_PAGE_SIZE),
        nextCursor: z.string().min(1).max(512).optional(),
      })
      .strict(),
  })
  .strict();
export type PublicGraphResponse = z.infer<typeof publicGraphResponseSchema>;
