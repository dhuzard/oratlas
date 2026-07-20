import { z } from "zod";
import {
  assessmentReviewStatusSchema,
  claimEvidenceRelationTypeSchema,
  trustVerificationStateSchema,
} from "./enums.js";
import { commitShaSchema } from "./identifiers.js";

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
  localClaimId: z.string(),
  reviewSlug: z.string(),
  reviewTitle: z.string(),
  reviewVersionId: z.string(),
  commitSha: commitShaSchema,
  versionDoi: z.string().optional(),
  text: z.string(),
  section: z.string().optional(),
  /** Atlas-owned durable DOM anchor. */
  anchor: z.string(),
  /** Untrusted repository anchor retained only as source metadata. */
  sourceAnchor: z.string().optional(),
  claimType: z.string().optional(),
  relations: z
    .array(
      z.object({
        citationId: z.string(),
        relationType: claimEvidenceRelationTypeSchema,
        trust: z
          .object({
            reviewStatus: assessmentReviewStatusSchema,
            verificationState: trustVerificationStateSchema,
            aggregateScore: z.number().min(0).max(1).optional(),
            aggregateMethod: z.string().optional(),
            notableCriteria: z.array(z.string()).default([]),
          })
          .optional(),
        trustAssessments: z
          .array(
            z.object({
              reviewStatus: assessmentReviewStatusSchema,
              verificationState: trustVerificationStateSchema,
              aggregateScore: z.number().min(0).max(1).optional(),
              aggregateMethod: z.string().optional(),
              notableCriteria: z.array(z.string()).default([]),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
});
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;

export const evidenceCitationSchema = z.object({
  citationId: z.string(),
  localCitationId: z.string(),
  reviewVersionId: z.string(),
  workId: z.string(),
  canonicalWorkAliases: z.array(z.string()).default([]),
  doi: z.string().optional(),
  pmid: z.string().optional(),
  openAlexId: z.string().optional(),
  title: z.string().optional(),
  year: z.number().int().optional(),
  source: z.string().optional(),
});
export type EvidenceCitation = z.infer<typeof evidenceCitationSchema>;

export const workIdentityConflictSchema = z.object({
  citationIds: z.array(z.string()).min(2),
  scheme: z.enum(["doi", "pmid", "openalex"]),
  values: z.array(z.string()).min(2),
  message: z.string(),
});

export const evidencePacketSchema = z.object({
  schemaVersion: z.literal("1.1.0"),
  question: z.string(),
  builtAt: z.string().datetime(),
  reviews: z.array(
    z.object({
      reviewSlug: z.string(),
      reviewVersionId: z.string(),
      title: z.string(),
      commitSha: commitShaSchema,
      versionDoi: z.string().optional(),
      conceptDoi: z.string().optional(),
    }),
  ),
  claims: z.array(evidenceClaimSchema),
  citations: z.array(evidenceCitationSchema),
  identifierConflicts: z.array(workIdentityConflictSchema).default([]),
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
  grounding: z
    .array(
      z.object({
        statement: z.string().min(1).max(2_000),
        evidenceEdges: z
          .array(z.object({ claimId: z.string(), citationId: z.string() }))
          .min(1)
          .max(100),
      }),
    )
    .min(1),
});
export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;

export interface GroundingValidationResult {
  ok: boolean;
  unknownClaimIds: string[];
  unknownCitationIds: string[];
  unknownReviewRefs: string[];
  invalidEvidenceEdges: Array<{ claimId: string; citationId: string }>;
  claimsMissingFromGrounding: string[];
  citationsMissingFromGrounding: string[];
  claimsMissingFromSummary: string[];
  citationsMissingFromSummary: string[];
}

/**
 * Reject unknown identifiers, nonexistent claim→citation edges, and any
 * mismatch between the top-level evidence summary and the exact per-statement
 * edge set. Pair validation prevents one claim from borrowing another claim's
 * citation merely because both identifiers occur somewhere in the packet.
 */
export function validateGrounding(
  answer: GroundedAnswer,
  packet: EvidencePacket,
): GroundingValidationResult {
  const claimIds = new Set(packet.claims.map((c) => c.claimId));
  const citationIds = new Set(packet.citations.map((c) => c.citationId));
  const unknownClaimIds = new Set<string>();
  const unknownCitationIds = new Set<string>();
  const packetEdges = new Set(
    packet.claims.flatMap((claim) =>
      claim.relations.map((relation) => edgeKey(claim.claimId, relation.citationId)),
    ),
  );
  const invalidEvidenceEdges = new Map<string, { claimId: string; citationId: string }>();
  const groundedClaimIds = new Set<string>();
  const groundedCitationIds = new Set<string>();

  for (const id of answer.reviewClaimsUsed) {
    if (!claimIds.has(id)) unknownClaimIds.add(id);
  }
  for (const id of answer.citationsUsed) {
    if (!citationIds.has(id)) unknownCitationIds.add(id);
  }
  for (const g of answer.grounding) {
    for (const edge of g.evidenceEdges) {
      groundedClaimIds.add(edge.claimId);
      groundedCitationIds.add(edge.citationId);
      if (!claimIds.has(edge.claimId)) unknownClaimIds.add(edge.claimId);
      if (!citationIds.has(edge.citationId)) unknownCitationIds.add(edge.citationId);
      const key = edgeKey(edge.claimId, edge.citationId);
      if (!packetEdges.has(key)) invalidEvidenceEdges.set(key, edge);
    }
  }
  const summaryClaimIds = new Set(answer.reviewClaimsUsed);
  const summaryCitationIds = new Set(answer.citationsUsed);
  const claimsMissingFromGrounding = difference(summaryClaimIds, groundedClaimIds);
  const citationsMissingFromGrounding = difference(summaryCitationIds, groundedCitationIds);
  const claimsMissingFromSummary = difference(groundedClaimIds, summaryClaimIds);
  const citationsMissingFromSummary = difference(groundedCitationIds, summaryCitationIds);
  return {
    ok:
      unknownClaimIds.size === 0 &&
      unknownCitationIds.size === 0 &&
      invalidEvidenceEdges.size === 0 &&
      claimsMissingFromGrounding.length === 0 &&
      citationsMissingFromGrounding.length === 0 &&
      claimsMissingFromSummary.length === 0 &&
      citationsMissingFromSummary.length === 0,
    unknownClaimIds: [...unknownClaimIds],
    unknownCitationIds: [...unknownCitationIds],
    unknownReviewRefs: [],
    invalidEvidenceEdges: [...invalidEvidenceEdges.values()],
    claimsMissingFromGrounding,
    citationsMissingFromGrounding,
    claimsMissingFromSummary,
    citationsMissingFromSummary,
  };
}

function edgeKey(claimId: string, citationId: string): string {
  return JSON.stringify([claimId, citationId]);
}

function difference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort();
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
