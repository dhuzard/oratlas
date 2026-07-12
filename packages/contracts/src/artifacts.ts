import { z } from "zod";
import {
  assessmentReviewStatusSchema,
  assessorTypeSchema,
  claimEvidenceRelationTypeSchema,
  claimTypeSchema,
  trustOrdinalSchema,
  TRUST_CRITERIA,
} from "./enums.js";
import { doiSchema } from "./identifiers.js";

/**
 * Knowledge artifact records as they appear inside review repositories
 * (JSONL files referenced from the review manifest `artifacts` block).
 * All content is untrusted input and is strictly validated and size-bounded.
 */

export const claimRecordSchema = z.object({
  id: z.string().min(1).max(120),
  text: z.string().min(1).max(5_000),
  section: z.string().max(300).optional(),
  anchor: z.string().max(300).optional(),
  claimType: claimTypeSchema.optional(),
  qualification: z.string().max(2_000).optional(),
});
export type ClaimRecord = z.infer<typeof claimRecordSchema>;

export const citationRecordSchema = z.object({
  id: z.string().min(1).max(120),
  doi: doiSchema.optional(),
  pmid: z
    .string()
    .regex(/^\d{1,9}$/)
    .optional(),
  openAlexId: z.string().max(60).optional(),
  title: z.string().max(1_000).optional(),
  authors: z.array(z.string().max(300)).max(200).optional(),
  year: z.number().int().min(1500).max(2100).optional(),
  source: z.string().max(500).optional(),
  url: z.string().url().max(1_000).optional(),
});
export type CitationRecord = z.infer<typeof citationRecordSchema>;

export const relationRecordSchema = z.object({
  claimId: z.string().min(1).max(120),
  citationId: z.string().min(1).max(120),
  relationType: claimEvidenceRelationTypeSchema,
  supportDirection: z.enum(["positive", "negative", "mixed", "neutral"]).optional(),
  sourceLocation: z.string().max(500).optional(),
  extractionMethod: z.string().max(200).optional(),
  extractionConfidence: z.number().min(0).max(1).optional(),
  humanReviewed: z.boolean().optional(),
});
export type RelationRecord = z.infer<typeof relationRecordSchema>;

export const trustCriterionAssessmentSchema = z.object({
  rating: trustOrdinalSchema,
  status: z.enum(["assessed", "not-assessed", "not-applicable"]).default("assessed"),
  rationale: z.string().max(4_000).optional(),
  evidencePointer: z.string().max(500).optional(),
});
export type TrustCriterionAssessment = z.infer<typeof trustCriterionAssessmentSchema>;

const criteriaShape = Object.fromEntries(
  TRUST_CRITERIA.map((c) => [c, trustCriterionAssessmentSchema.optional()]),
) as Record<(typeof TRUST_CRITERIA)[number], z.ZodOptional<typeof trustCriterionAssessmentSchema>>;

export const trustRecordSchema = z.object({
  claimId: z.string().min(1).max(120),
  citationId: z.string().min(1).max(120),
  protocolVersion: z.string().min(1).max(40),
  assessorType: assessorTypeSchema,
  assessorId: z.string().max(200).optional(),
  assessedAt: z.string().datetime().optional(),
  criteria: z.object(criteriaShape),
  limitations: z.array(z.string().max(2_000)).max(50).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  // Explicit null is retained as a source assertion. Atlas recomputes the
  // public aggregate from criterion-level data after import.
  aggregateScore: z.number().min(0).max(1).nullable().optional(),
  aggregateMethod: z.string().max(200).nullable().optional(),
  reviewStatus: assessmentReviewStatusSchema.default("agent-proposed"),
});
export type TrustRecord = z.infer<typeof trustRecordSchema>;

export interface JsonlParseResult<T> {
  records: T[];
  errors: Array<{ line: number; message: string }>;
  truncated: boolean;
}

/**
 * Parse a JSONL artifact with strict per-line validation and a record cap.
 * Invalid lines are reported but never abort the rest of the file.
 */
export function parseJsonlArtifact<S extends z.ZodTypeAny>(
  content: string,
  schema: S,
  maxRecords = 5_000,
): JsonlParseResult<z.infer<S>> {
  const records: z.infer<S>[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  const lines = content.split(/\r?\n/);
  let truncated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    if (records.length >= maxRecords) {
      truncated = true;
      break;
    }
    try {
      const parsed = schema.safeParse(JSON.parse(line));
      if (parsed.success) {
        records.push(parsed.data);
      } else {
        errors.push({
          line: i + 1,
          message: parsed.error.issues
            .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
            .join("; "),
        });
      }
    } catch {
      errors.push({ line: i + 1, message: "Invalid JSON" });
    }
  }
  return { records, errors, truncated };
}
