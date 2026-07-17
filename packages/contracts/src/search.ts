import { z } from "zod";
import { publicNodeSummarySchema } from "./node-publication.js";
import {
  publicSynthesisVersionSchema,
  synthesisFreshnessBaseSchema,
} from "./synthesis-editorial.js";

const archiveSynthesisFreshnessSchema = synthesisFreshnessBaseSchema
  .pick({ status: true, affectedReferenceCount: true })
  .superRefine((freshness, context) => {
    if (
      (freshness.status === "stale" && freshness.affectedReferenceCount === 0) ||
      (freshness.status !== "stale" && freshness.affectedReferenceCount !== 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Archive freshness status must match its affected-reference count.",
      });
    }
  });

/** Archive search query (spec §13, §16). */
export const archiveSearchQuerySchema = z.object({
  contentType: z.enum(["all", "review", "node", "synthesis"]).optional(),
  nodeKind: z.enum(["claim", "figure", "dataset", "code"]).optional(),
  q: z.string().max(500).optional(),
  keywords: z.array(z.string().max(100)).max(20).optional(),
  author: z.string().max(200).optional(),
  domain: z.string().max(100).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  reviewStatus: z.string().max(40).optional(),
  hasDoi: z.boolean().optional(),
  hasTrustData: z.boolean().optional(),
  hasEvidenceData: z.boolean().optional(),
  compatibility: z.string().max(40).optional(),
  trustReviewState: z.enum(["any", "human-reviewed", "agent-proposed-only"]).optional(),
  sort: z.enum(["accepted", "updated", "title", "relevance"]).default("accepted"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});
export type ArchiveSearchQuery = z.infer<typeof archiveSearchQuerySchema>;

export const archiveSearchResponseSchema = z
  .object({
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    items: z.array(
      z.discriminatedUnion("contentType", [
        z
          .object({
            contentType: z.literal("review"),
            slug: z.string().min(1),
            title: z.string().min(1),
            abstract: z.string().optional(),
            authors: z.array(z.string()),
            domains: z.array(z.string()),
            hasDoi: z.boolean(),
            hasTrustData: z.boolean(),
            compatibilityLevel: z.string().optional(),
            status: z.string(),
            score: z.number(),
            sortDate: z.string().datetime().optional(),
          })
          .strict(),
        z
          .object({
            contentType: z.literal("node"),
            node: publicNodeSummarySchema,
            score: z.number(),
            sortDate: z.string().datetime(),
          })
          .strict(),
        z
          .object({
            contentType: z.literal("synthesis"),
            slug: z.string().min(1).max(200),
            title: z.string().min(1).max(300),
            abstract: z.string().min(1).max(2_000),
            version: publicSynthesisVersionSchema,
            freshness: archiveSynthesisFreshnessSchema,
            score: z.number(),
            sortDate: z.string().datetime(),
          })
          .strict(),
      ]),
    ),
  })
  .strict();
export type ArchiveSearchResponse = z.infer<typeof archiveSearchResponseSchema>;

export const claimSearchQuerySchema = z.object({
  q: z.string().max(500).optional(),
  reviewSlug: z.string().max(200).optional(),
  claimType: z.string().max(40).optional(),
  relationType: z.string().max(40).optional(),
  trustCriterion: z.string().max(60).optional(),
  trustMinimum: z.string().max(20).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});
export type ClaimSearchQuery = z.infer<typeof claimSearchQuerySchema>;
