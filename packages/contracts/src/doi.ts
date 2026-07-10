import { z } from "zod";

/**
 * Structured DOI validation result (spec §3). Never a plain boolean:
 * warnings and confidence are recorded separately from hard errors, and a
 * version DOI is never conflated with a concept DOI.
 */
export const doiCheckOutcomeSchema = z.enum(["pass", "warn", "fail", "skipped"]);
export type DoiCheckOutcome = z.infer<typeof doiCheckOutcomeSchema>;

export const doiCheckSchema = z.object({
  id: z.string(),
  description: z.string(),
  outcome: doiCheckOutcomeSchema,
  details: z.string().optional(),
});
export type DoiCheck = z.infer<typeof doiCheckSchema>;

export const doiValidationStatusSchema = z.enum([
  "valid",
  "valid-with-warnings",
  "invalid",
  "unresolvable",
  "example-not-resolvable",
  "not-validated",
]);
export type DoiValidationStatus = z.infer<typeof doiValidationStatusSchema>;

export const doiKindSchema = z.enum(["version", "concept", "unknown"]);
export type DoiKind = z.infer<typeof doiKindSchema>;

export const doiValidationReportSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  input: z.string(),
  normalizedDoi: z.string().optional(),
  status: doiValidationStatusSchema,
  /** Whether the DOI is a Zenodo DOI (10.5281/zenodo.*). */
  isZenodo: z.boolean(),
  doiKind: doiKindSchema,
  zenodoRecordId: z.string().optional(),
  zenodoConceptRecordId: z.string().optional(),
  /** Concept DOI discovered from Zenodo metadata, when the input was a version DOI. */
  discoveredConceptDoi: z.string().optional(),
  resolvedUrl: z.string().optional(),
  recordTitle: z.string().optional(),
  recordCreators: z.array(z.string()).default([]),
  recordPublicationDate: z.string().optional(),
  recordRepositoryUrls: z.array(z.string()).default([]),
  recordVersionTag: z.string().optional(),
  checks: z.array(doiCheckSchema).default([]),
  /** Hard errors: the DOI cannot be linked as-is. */
  errors: z.array(z.string()).default([]),
  /** Soft mismatches: recorded, displayed, but not blocking. */
  warnings: z.array(z.string()).default([]),
  /** Deterministic confidence that this DOI corresponds to the repository. */
  confidence: z.enum(["high", "medium", "low", "none"]),
  validatedAt: z.string().datetime(),
});
export type DoiValidationReport = z.infer<typeof doiValidationReportSchema>;

/**
 * Overall submission validation report shown at wizard step 4 and stored on
 * the submission (spec §8).
 */
export const submissionValidationReportSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  hardErrors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  doiValidation: z
    .object({
      versionDoi: doiValidationReportSchema.optional(),
      conceptDoi: doiValidationReportSchema.optional(),
    })
    .optional(),
  releaseValidation: z.object({
    releaseDetected: z.boolean(),
    releaseTagMatches: z.boolean().optional(),
    details: z.array(z.string()).default([]),
  }),
  metadataCompleteness: z.object({
    requiredMissing: z.array(z.string()).default([]),
    recommendedMissing: z.array(z.string()).default([]),
    score: z.number().min(0).max(1),
  }),
  compatibilityLevel: z.string(),
  evidenceDataAvailable: z.boolean(),
  trustDataAvailable: z.boolean(),
  validatedAt: z.string().datetime(),
});
export type SubmissionValidationReport = z.infer<typeof submissionValidationReportSchema>;
