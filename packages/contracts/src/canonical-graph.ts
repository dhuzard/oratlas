import { z } from "zod";
import { knowledgeNodeKindSchema, nodeRelationTypeSchema } from "./enums.js";
import { manifestContributorSchema } from "./manifest.js";
import { nodeAliasSchema } from "./node-identity.js";
import { publicGraphTrustSchema } from "./graph.js";
import { publicationAdapterTypeSchema } from "./publication-adapters.js";

export const CANONICAL_GRAPH_SCHEMA_VERSION = "2.0.0" as const;
export const CANONICAL_GRAPH_MAX_PAGE_SIZE = 100;

export const canonicalGraphQuerySchema = z
  .object({
    seed: z.string().trim().min(1).max(200),
    version: z.string().trim().min(1).max(200).optional(),
    direction: z.enum(["outgoing", "incoming", "both"]).default("both"),
    status: z.enum(["authoritative", "source-assertion", "confirmed"]).default("authoritative"),
    relationType: nodeRelationTypeSchema.optional(),
    limit: z.number().int().min(1).max(CANONICAL_GRAPH_MAX_PAGE_SIZE).default(25),
    cursor: z.string().trim().min(1).max(768).optional(),
  })
  .strict();
export type CanonicalGraphQuery = z.infer<typeof canonicalGraphQuerySchema>;

export const canonicalGraphSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("repository-snapshot"), snapshotId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("review-version"), reviewVersionId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("claim-occurrence"), claimId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("citation-occurrence"), citationId: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("publication-claim-occurrence"),
      publicationClaimOccurrenceId: z.string().min(1),
      publicationId: z.string().min(1),
      publicationVersionId: z.string().min(1),
      publicationType: z.enum([
        "review-article",
        "research-article",
        "methods-article",
        "preprint",
        "living-review",
        "other",
      ]),
      sourceLocalClaimId: z.string().min(1).max(120),
      adapterType: publicationAdapterTypeSchema,
      structuralProvenance: z.enum(["published-structure", "source-byte"]),
      publisherCanonicalUrl: z.string().url().startsWith("https://").max(2_000).nullable(),
      observedPublicationBaseUrl: z.string().url().startsWith("https://").max(2_000),
      publishedTargetUrl: z.string().url().startsWith("https://").max(2_000),
      captureIds: z.array(z.string().min(1)).max(1_000),
      sourcesSha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict(),
]);
export type CanonicalGraphSource = z.infer<typeof canonicalGraphSourceSchema>;

export const canonicalGraphNodeVersionSchema = z
  .object({
    nodeId: z.string().min(1).max(200),
    nodeVersionId: z.string().min(1).max(200),
    stableKey: z.string().min(1).max(800).optional(),
    localNodeId: z.string().min(1).max(500),
    originType: z.enum([
      "repository-object",
      "review-record",
      "claim-occurrence",
      "canonical-work",
    ]),
    kind: knowledgeNodeKindSchema,
    source: canonicalGraphSourceSchema,
    repository: z
      .object({
        id: z.string().min(1),
        owner: z.string().min(1),
        name: z.string().min(1),
        canonicalUrl: z.string().url(),
        commitSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i),
      })
      .strict()
      .optional(),
    title: z.string().min(1).optional(),
    abstract: z.string().optional(),
    text: z.string().optional(),
    contributors: z.array(manifestContributorSchema),
    license: z.string().min(1).optional(),
    provenance: z.unknown(),
    payload: z.unknown(),
    aliases: z.array(nodeAliasSchema),
    versionDoi: z.string().min(1).optional(),
    conceptDoi: z.string().min(1).optional(),
    isExample: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type CanonicalGraphNodeVersion = z.infer<typeof canonicalGraphNodeVersionSchema>;

const canonicalGraphEdgeBase = {
  id: z.string().min(1).max(200),
  sourceNodeId: z.string().min(1).max(200),
  sourceNodeVersionId: z.string().min(1).max(200),
  targetNodeId: z.string().min(1).max(200),
  targetNodeVersionId: z.string().min(1).max(200),
  relationType: nodeRelationTypeSchema,
  rationale: z.string().optional(),
  assertedAt: z.string().datetime().optional(),
  trustAssessments: z.array(publicGraphTrustSchema),
};

export const canonicalGraphEdgeSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...canonicalGraphEdgeBase,
      status: z.literal("source-assertion"),
      provenance: z.literal("imported-from-review"),
    })
    .strict(),
  z
    .object({
      ...canonicalGraphEdgeBase,
      status: z.literal("confirmed"),
      provenance: z.literal("confirmed-by-editor"),
      confirmedAt: z.string().datetime(),
    })
    .strict(),
]);
export type CanonicalGraphEdge = z.infer<typeof canonicalGraphEdgeSchema>;

export const canonicalGraphResponseSchema = z
  .object({
    schemaVersion: z.literal(CANONICAL_GRAPH_SCHEMA_VERSION),
    seed: z.object({ nodeId: z.string().min(1), nodeVersionId: z.string().min(1) }).strict(),
    nodes: z.array(canonicalGraphNodeVersionSchema).max(CANONICAL_GRAPH_MAX_PAGE_SIZE * 2 + 1),
    edges: z.array(canonicalGraphEdgeSchema).max(CANONICAL_GRAPH_MAX_PAGE_SIZE),
    page: z
      .object({
        limit: z.number().int().min(1).max(CANONICAL_GRAPH_MAX_PAGE_SIZE),
        nextCursor: z.string().min(1).max(768).optional(),
      })
      .strict(),
  })
  .strict();
export type CanonicalGraphResponse = z.infer<typeof canonicalGraphResponseSchema>;
