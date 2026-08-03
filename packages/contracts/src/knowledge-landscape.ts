import { z } from "zod";

export const KNOWLEDGE_LANDSCAPE_SCHEMA_VERSION = "1.0.0" as const;
export const KNOWLEDGE_LANDSCAPE_ALGORITHM_VERSION = "1.0.0" as const;

export const explorationInterestSchema = z.enum([
  "disagreements",
  "reproducibility",
  "methods-models",
  "data-code",
  "assessed-evidence",
]);
export type ExplorationInterest = z.infer<typeof explorationInterestSchema>;

export const knowledgeLandscapeQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(500).optional(),
    interests: z.array(explorationInterestSchema).max(5).default([]),
    focusNodeId: z.string().trim().min(1).max(500).optional(),
    reviewSlug: z.string().max(200).optional(),
    claimType: z.string().max(40).optional(),
    relationType: z.string().max(40).optional(),
    trustCriterion: z.string().max(60).optional(),
  })
  .strict();
export type KnowledgeLandscapeQuery = z.infer<typeof knowledgeLandscapeQuerySchema>;

export const knowledgeLandscapeNodeSchema = z
  .object({
    id: z.string().min(1).max(500),
    kind: z.enum(["review", "claim", "evidence"]),
    label: z.string().min(1),
    detail: z.string().min(1),
    href: z.string().startsWith("/"),
    reasons: z.array(z.string().min(1)).min(1),
    year: z.number().int().min(1000).max(2100).optional(),
  })
  .strict();
export type KnowledgeLandscapeNode = z.infer<typeof knowledgeLandscapeNodeSchema>;
export type LandscapeNodeKind = KnowledgeLandscapeNode["kind"];

export const knowledgeLandscapeEdgeSchema = z
  .object({
    sourceId: z.string().min(1).max(500),
    targetId: z.string().min(1).max(500),
    label: z.string().min(1).max(100),
    relationType: z.string().min(1).max(100),
  })
  .strict();
export type KnowledgeLandscapeEdge = z.infer<typeof knowledgeLandscapeEdgeSchema>;

export const knowledgeLandscapeYearSchema = z
  .object({
    year: z.number().int().min(1000).max(2100),
    reviewCount: z.number().int().nonnegative(),
    evidenceCount: z.number().int().nonnegative(),
  })
  .strict();
export type KnowledgeLandscapeYear = z.infer<typeof knowledgeLandscapeYearSchema>;

export const knowledgeLandscapeDataSchema = z
  .object({
    nodes: z.array(knowledgeLandscapeNodeSchema).max(22),
    edges: z.array(knowledgeLandscapeEdgeSchema),
    matchedClaimCount: z.number().int().nonnegative(),
    shownClaimCount: z.number().int().min(0).max(6),
    timeline: z.array(knowledgeLandscapeYearSchema),
    focusedNodeId: z.string().min(1).max(500).optional(),
  })
  .strict();
export type KnowledgeLandscapeData = z.infer<typeof knowledgeLandscapeDataSchema>;

export const knowledgeLandscapeResponseSchema = z
  .object({
    schemaVersion: z.literal(KNOWLEDGE_LANDSCAPE_SCHEMA_VERSION),
    algorithm: z
      .object({
        id: z.literal("explicit-interest-landscape"),
        version: z.literal(KNOWLEDGE_LANDSCAPE_ALGORITHM_VERSION),
        purpose: z.literal("navigation"),
        limitations: z.tuple([
          z.literal("not-a-truth-score"),
          z.literal("not-a-quality-score"),
          z.literal("bounded-to-six-claims-and-ten-evidence-records"),
        ]),
      })
      .strict(),
    query: knowledgeLandscapeQuerySchema,
    landscape: knowledgeLandscapeDataSchema,
  })
  .strict();
export type KnowledgeLandscapeResponse = z.infer<typeof knowledgeLandscapeResponseSchema>;
