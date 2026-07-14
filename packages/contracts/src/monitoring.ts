import { z } from "zod";

/**
 * Evidence monitoring contracts (issue #3): externally observed changes to
 * cited works and the human-reviewable update proposals they open. A signal
 * never rewrites a conclusion — it only identifies affected claims and asks
 * an editor to decide.
 */

export const CITATION_STATUSES = [
  "retracted",
  "corrected",
  "expression-of-concern",
  "new-evidence",
] as const;
export const citationStatusSchema = z.enum(CITATION_STATUSES);
export type CitationStatus = z.infer<typeof citationStatusSchema>;

export const PROPOSAL_STATUSES = [
  "open",
  "resolved-updated",
  "resolved-no-action",
  "dismissed",
] as const;
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

/** Input for registering a cited-work status signal. */
export const citationStatusInputSchema = z
  .object({
    doi: z.string().trim().max(300).optional(),
    pmid: z.string().trim().max(50).optional(),
    openAlexId: z.string().trim().max(50).optional(),
    status: citationStatusSchema,
    /** Where the signal came from (e.g. "crossref", "publisher notice", "manual"). */
    source: z.string().trim().min(1).max(200),
    evidenceUrl: z.string().trim().url().max(2000).optional(),
    note: z.string().trim().max(4000).optional(),
  })
  .refine((value) => Boolean(value.doi || value.pmid || value.openAlexId), {
    message: "At least one work identifier (doi, pmid, openAlexId) is required.",
  });
export type CitationStatusInput = z.infer<typeof citationStatusInputSchema>;

export const proposalResolutionSchema = z.object({
  resolution: z.enum(["resolved-updated", "resolved-no-action", "dismissed"]),
  note: z.string().trim().min(10).max(4000),
});
export type ProposalResolution = z.infer<typeof proposalResolutionSchema>;
