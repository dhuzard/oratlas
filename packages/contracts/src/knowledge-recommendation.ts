import { z } from "zod";
import { explorationInterestSchema } from "./knowledge-landscape.js";

export const KNOWLEDGE_RECOMMENDATION_SCHEMA_VERSION = "2.0.0" as const;
export const KNOWLEDGE_RECOMMENDATION_ALGORITHM_VERSION = "2.0.0" as const;

/** Explicit reader input for a derived ranking overlay; never canonical graph state. */
export const knowledgeRecommendationQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(500).optional(),
    interests: z.array(explorationInterestSchema).max(5).default([]),
    reviewSlug: z.string().max(200).optional(),
    claimType: z.string().max(40).optional(),
    relationType: z.string().max(40).optional(),
    trustCriterion: z.string().max(60).optional(),
  })
  .strict();
export type KnowledgeRecommendationQuery = z.infer<typeof knowledgeRecommendationQuerySchema>;

export const knowledgeRecommendationSchema = z
  .object({
    nodeId: z.string().min(1).max(200),
    nodeVersionId: z.string().min(1).max(200).optional(),
    rank: z.number().int().min(1).max(34),
    /** Relative ordering aid only; never truth, quality, or confidence. */
    score: z.number().min(0).max(1),
    reasons: z.array(z.string().min(1).max(1_000)).min(1).max(10),
  })
  .strict();
export type KnowledgeRecommendation = z.infer<typeof knowledgeRecommendationSchema>;

export const knowledgeRecommendationResponseSchema = z
  .object({
    schemaVersion: z.literal(KNOWLEDGE_RECOMMENDATION_SCHEMA_VERSION),
    algorithm: z
      .object({
        id: z.literal("explicit-interest-recommendation"),
        version: z.literal(KNOWLEDGE_RECOMMENDATION_ALGORITHM_VERSION),
        purpose: z.literal("recommendation"),
        limitations: z.tuple([
          z.literal("not-a-truth-score"),
          z.literal("not-a-quality-score"),
          z.literal("confirmed-graph-edges-only"),
          z.literal("bounded-to-six-claims-ten-evidence-and-twelve-graph-nodes"),
        ]),
      })
      .strict(),
    query: knowledgeRecommendationQuerySchema,
    recommendations: z.array(knowledgeRecommendationSchema).max(34),
    omittedUnboundCount: z.number().int().nonnegative(),
  })
  .strict();
export type KnowledgeRecommendationResponse = z.infer<typeof knowledgeRecommendationResponseSchema>;
