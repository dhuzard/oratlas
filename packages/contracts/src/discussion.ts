import { z } from "zod";
import { assessmentReviewStatusSchema, claimEvidenceRelationTypeSchema } from "./enums.js";

/**
 * Grounded discussion contracts (Atlas Discuss, spec §14).
 *
 * The knowledge unit is an evidence packet — review metadata + claims +
 * citations + relations + TRUST + version identity — not a raw text chunk.
 * LLM answers must validate against `groundedAnswerSchema` and may only
 * reference identifiers present in the packet.
 */

export const evidenceClaimSchema = z.object({
  claimId: z.string(),
  reviewSlug: z.string(),
  reviewTitle: z.string(),
  reviewVersionId: z.string(),
  commitSha: z.string().optional(),
  versionDoi: z.string().optional(),
  text: z.string(),
  section: z.string().optional(),
  anchor: z.string().optional(),
  claimType: z.string().optional(),
  relations: z
    .array(
      z.object({
        citationId: z.string(),
        relationType: claimEvidenceRelationTypeSchema,
        trust: z
          .object({
            reviewStatus: assessmentReviewStatusSchema,
            aggregateScore: z.number().min(0).max(1).optional(),
            aggregateMethod: z.string().optional(),
            notableCriteria: z.array(z.string()).default([]),
          })
          .optional(),
      }),
    )
    .default([]),
});
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;

export const evidenceCitationSchema = z.object({
  citationId: z.string(),
  doi: z.string().optional(),
  title: z.string().optional(),
  year: z.number().int().optional(),
  source: z.string().optional(),
});
export type EvidenceCitation = z.infer<typeof evidenceCitationSchema>;

export const evidencePacketSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  question: z.string(),
  builtAt: z.string().datetime(),
  reviews: z.array(
    z.object({
      reviewSlug: z.string(),
      reviewVersionId: z.string(),
      title: z.string(),
      commitSha: z.string().optional(),
      versionDoi: z.string().optional(),
      conceptDoi: z.string().optional(),
    }),
  ),
  claims: z.array(evidenceClaimSchema),
  citations: z.array(evidenceCitationSchema),
});
export type EvidencePacket = z.infer<typeof evidencePacketSchema>;

/** Structured answer contract for LLM mode (spec §14). */
export const groundedAnswerSchema = z.object({
  answer: z.string().min(1).max(8_000),
  scope: z.string().max(2_000),
  reviewClaimsUsed: z.array(z.string()).max(200),
  citationsUsed: z.array(z.string()).max(200),
  agreements: z.array(z.string().max(2_000)).max(50),
  disagreements: z.array(z.string().max(2_000)).max(50),
  uncertainties: z.array(z.string().max(2_000)).max(50),
  missingEvidence: z.array(z.string().max(2_000)).max(50),
  grounding: z.array(
    z.object({
      statement: z.string().max(2_000),
      claimIds: z.array(z.string()).max(50),
      citationIds: z.array(z.string()).max(50).default([]),
    }),
  ),
});
export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;

export interface GroundingValidationResult {
  ok: boolean;
  unknownClaimIds: string[];
  unknownCitationIds: string[];
  unknownReviewRefs: string[];
}

/** Reject answers that cite identifiers absent from the evidence packet. */
export function validateGrounding(
  answer: GroundedAnswer,
  packet: EvidencePacket,
): GroundingValidationResult {
  const claimIds = new Set(packet.claims.map((c) => c.claimId));
  const citationIds = new Set(packet.citations.map((c) => c.citationId));
  const unknownClaimIds = new Set<string>();
  const unknownCitationIds = new Set<string>();

  for (const id of answer.reviewClaimsUsed) {
    if (!claimIds.has(id)) unknownClaimIds.add(id);
  }
  for (const id of answer.citationsUsed) {
    if (!citationIds.has(id)) unknownCitationIds.add(id);
  }
  for (const g of answer.grounding) {
    for (const id of g.claimIds) if (!claimIds.has(id)) unknownClaimIds.add(id);
    for (const id of g.citationIds) if (!citationIds.has(id)) unknownCitationIds.add(id);
  }
  return {
    ok: unknownClaimIds.size === 0 && unknownCitationIds.size === 0,
    unknownClaimIds: [...unknownClaimIds],
    unknownCitationIds: [...unknownCitationIds],
    unknownReviewRefs: [],
  };
}

/** Deterministic (LLM-free) discussion output: a structured evidence summary. */
export const deterministicDiscussionResultSchema = z.object({
  mode: z.literal("deterministic"),
  question: z.string(),
  matchedClaimCount: z.number().int(),
  groups: z.array(
    z.object({
      relationType: claimEvidenceRelationTypeSchema.or(z.literal("no-linked-citation")),
      claims: z.array(evidenceClaimSchema),
    }),
  ),
  reviewsCovered: z.array(z.object({ reviewSlug: z.string(), title: z.string() })),
  insufficientEvidence: z.boolean(),
  notes: z.array(z.string()).default([]),
});
export type DeterministicDiscussionResult = z.infer<typeof deterministicDiscussionResultSchema>;
