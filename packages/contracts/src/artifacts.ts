import { z } from "zod";
import {
  assessmentReviewStatusSchema,
  assessorTypeSchema,
  claimEvidenceRelationTypeSchema,
  claimTypeSchema,
  nodeRelationTypeSchema,
  trustOrdinalSchema,
  TRUST_CRITERIA,
} from "./enums.js";
import { commitShaSchema, doiSchema } from "./identifiers.js";
import { localNodeIdSchema } from "./knowledge-nodes.js";

/**
 * Knowledge artifact records as they appear inside review repositories
 * (JSONL files referenced from the review manifest `artifacts` block).
 * All content is untrusted input and is strictly validated and size-bounded.
 */

/** Declared comparison scope of a claim (issue #5, scope-aware comparison). */
export const claimScopeSchema = z
  .object({
    population: z.string().max(300).optional(),
    model: z.string().max(300).optional(),
    intervention: z.string().max(300).optional(),
    outcome: z.string().max(300).optional(),
    method: z.string().max(300).optional(),
    /** Structured reporting fields used by protocol-drift comparison. */
    exclusions: z.string().max(1_000).optional(),
    analysisPlan: z.string().max(1_000).optional(),
  })
  .strict();
export type ClaimScope = z.infer<typeof claimScopeSchema>;

export const claimRecordSchema = z.object({
  id: z.string().min(1).max(120),
  text: z.string().min(1).max(5_000),
  section: z.string().max(300).optional(),
  anchor: z.string().max(300).optional(),
  claimType: claimTypeSchema.optional(),
  qualification: z.string().max(2_000).optional(),
  /** Declared scope for independence-aware comparison. */
  scope: claimScopeSchema.optional(),
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
  /** Declared dataset/cohort accessions the work uses (independence signal). */
  datasetIds: z.array(z.string().max(200)).max(100).optional(),
  /** DOIs of works this one is a derivative analysis of (independence signal). */
  derivedFromDois: z.array(doiSchema).max(100).optional(),
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

const strictTrustCriterionAssessmentSchema = trustCriterionAssessmentSchema.strict();
const strictCriteriaShape = Object.fromEntries(
  TRUST_CRITERIA.map((criterion) => [criterion, strictTrustCriterionAssessmentSchema.optional()]),
) as Record<
  (typeof TRUST_CRITERIA)[number],
  z.ZodOptional<typeof strictTrustCriterionAssessmentSchema>
>;

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

/** Evidence node kinds that can be assessed only in the context of a claim relation. */
export const trustEvidenceNodeKindSchema = z.enum(["dataset", "code", "figure"]);
export type TrustEvidenceNodeKind = z.infer<typeof trustEvidenceNodeKindSchema>;

const nodeRelationTrustSubjectSchema = z
  .object({
    claimNodeId: localNodeIdSchema,
    evidenceNodeId: localNodeIdSchema,
    evidenceKind: trustEvidenceNodeKindSchema,
    relationType: nodeRelationTypeSchema,
    /** Immutable address for cross-repository evidence; omitted for a local target. */
    evidenceRepository: z
      .object({
        githubRepositoryId: z.string().regex(/^\d+$/).max(30),
        commitSha: commitShaSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((subject, context) => {
    if (subject.claimNodeId === subject.evidenceNodeId && !subject.evidenceRepository) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceNodeId"],
        message: "Claim and evidence must identify different local nodes.",
      });
    }

    const specializedRelation =
      subject.evidenceKind === "dataset"
        ? "uses-dataset"
        : subject.evidenceKind === "code"
          ? "uses-code"
          : undefined;
    if (subject.relationType !== "derives-from" && subject.relationType !== specializedRelation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relationType"],
        message:
          subject.evidenceKind === "figure"
            ? "Figure evidence must use the derives-from relation."
            : `${subject.evidenceKind} evidence must use ${specializedRelation} or derives-from.`,
      });
    }
  });

/**
 * Repository TRUST assertion for dataset, code, or figure evidence. The complete
 * relation is the subject: there is deliberately no nodeId-only alternative.
 */
export const nodeRelationTrustRecordSchema = z
  .object({
    subjectType: z.literal("node-relation"),
    subject: nodeRelationTrustSubjectSchema,
    protocolVersion: z.string().min(1).max(40),
    assessorType: assessorTypeSchema,
    assessorId: z.string().max(200).optional(),
    assessedAt: z.string().datetime().optional(),
    criteria: z.object(strictCriteriaShape).strict(),
    limitations: z.array(z.string().max(2_000)).max(50).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
    aggregateScore: z.number().min(0).max(1).nullable().optional(),
    aggregateMethod: z.string().max(200).nullable().optional(),
    reviewStatus: assessmentReviewStatusSchema.default("agent-proposed"),
  })
  .strict();
export type NodeRelationTrustRecord = z.infer<typeof nodeRelationTrustRecordSchema>;

/**
 * Backward-compatible artifact parser for both subject forms. Presence of a
 * subject or subjectType always selects the new strict schema, preventing
 * malformed or hybrid node records from falling back to the permissive legacy
 * object and having their node-relation intent silently stripped.
 */
export const trustAssessmentRecordSchema = z.unknown().transform((value, context) => {
  const hasNodeSubjectIntent =
    typeof value === "object" && value !== null && ("subjectType" in value || "subject" in value);
  const parsed = (
    hasNodeSubjectIntent ? nodeRelationTrustRecordSchema : trustRecordSchema
  ).safeParse(value);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) context.addIssue(issue);
  return z.NEVER;
});
export type TrustAssessmentRecord = z.infer<typeof trustAssessmentRecordSchema>;

export interface JsonlParseResult<T> {
  records: T[];
  errors: Array<{ line: number; message: string }>;
  truncated: boolean;
  /** Exact number of non-empty records skipped after the valid-record cap. */
  truncatedCount: number;
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
  let truncatedCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    if (records.length >= maxRecords) {
      truncated = true;
      truncatedCount = lines.slice(i).filter((candidate) => candidate.trim().length > 0).length;
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
  return { records, errors, truncated, truncatedCount };
}
