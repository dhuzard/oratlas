import { z } from "zod";

/** Archive search query (spec §13, §16). */
export const archiveSearchQuerySchema = z.object({
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
