import { z } from "zod";
import { TRUST_CRITERIA } from "./enums.js";

export const TRUST_DISAGREEMENT_MAX_ASSESSMENTS = 100;

export const EXPLICIT_TRUST_ORDINALS = [
  "very-low",
  "low",
  "moderate",
  "high",
  "very-high",
] as const;

export const explicitTrustOrdinalSchema = z.enum(EXPLICIT_TRUST_ORDINALS);
export type ExplicitTrustOrdinal = z.infer<typeof explicitTrustOrdinalSchema>;

export const trustDisagreementCriterionInputSchema = z.discriminatedUnion("status", [
  z
    .object({
      criterion: z.enum(TRUST_CRITERIA),
      status: z.literal("assessed"),
      rating: explicitTrustOrdinalSchema,
    })
    .strict(),
  z
    .object({
      criterion: z.enum(TRUST_CRITERIA),
      status: z.literal("not-assessed"),
      rating: z.literal("not-assessed"),
    })
    .strict(),
  z
    .object({
      criterion: z.enum(TRUST_CRITERIA),
      status: z.literal("not-applicable"),
      rating: z.literal("not-applicable"),
    })
    .strict(),
]);
export type TrustDisagreementCriterionInput = z.infer<typeof trustDisagreementCriterionInputSchema>;

export const trustDisagreementAssessmentInputSchema = z
  .object({
    assessmentId: z.string().trim().min(1).max(200),
    protocolVersion: z.string().min(1).max(40),
    criteria: z.array(trustDisagreementCriterionInputSchema).max(TRUST_CRITERIA.length),
  })
  .strict()
  .superRefine((assessment, context) => {
    const seen = new Set<string>();
    for (const [index, criterion] of assessment.criteria.entries()) {
      if (seen.has(criterion.criterion)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["criteria", index, "criterion"],
          message: "Each TRUST criterion may appear at most once per assessment.",
        });
      }
      seen.add(criterion.criterion);
    }
  });
export type TrustDisagreementAssessmentInput = z.infer<
  typeof trustDisagreementAssessmentInputSchema
>;

export const trustDisagreementInputSchema = z
  .object({
    assessments: z
      .array(trustDisagreementAssessmentInputSchema)
      .max(TRUST_DISAGREEMENT_MAX_ASSESSMENTS),
  })
  .strict()
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const [index, assessment] of input.assessments.entries()) {
      if (seen.has(assessment.assessmentId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assessments", index, "assessmentId"],
          message: "Assessment identifiers must be unique within a disagreement comparison.",
        });
      }
      seen.add(assessment.assessmentId);
    }
  });
export type TrustDisagreementInput = z.infer<typeof trustDisagreementInputSchema>;

export const trustCriterionDisagreementSchema = z
  .object({
    criterion: z.enum(TRUST_CRITERIA),
    ratings: z
      .array(
        z
          .object({
            rating: explicitTrustOrdinalSchema,
            assessmentIds: z
              .array(z.string().min(1).max(200))
              .min(1)
              .max(TRUST_DISAGREEMENT_MAX_ASSESSMENTS),
          })
          .strict(),
      )
      .min(2)
      .max(EXPLICIT_TRUST_ORDINALS.length),
  })
  .strict();
export type TrustCriterionDisagreement = z.infer<typeof trustCriterionDisagreementSchema>;

export const TRUST_COVERAGE_GAP_REASONS = ["missing", "not-assessed", "not-applicable"] as const;
export const trustCoverageGapReasonSchema = z.enum(TRUST_COVERAGE_GAP_REASONS);
export type TrustCoverageGapReason = z.infer<typeof trustCoverageGapReasonSchema>;

export const trustCriterionCoverageGapSchema = z
  .object({
    criterion: z.enum(TRUST_CRITERIA),
    gaps: z
      .array(
        z
          .object({
            assessmentId: z.string().min(1).max(200),
            reason: trustCoverageGapReasonSchema,
          })
          .strict(),
      )
      .min(1)
      .max(TRUST_DISAGREEMENT_MAX_ASSESSMENTS),
  })
  .strict();
export type TrustCriterionCoverageGap = z.infer<typeof trustCriterionCoverageGapSchema>;

/** Pure comparison result. It deliberately defines no aggregate or adjudicated state. */
export const trustDisagreementReportSchema = z
  .object({
    protocolVersion: z.string().min(1).max(40).nullable(),
    assessmentIds: z.array(z.string().min(1).max(200)).max(TRUST_DISAGREEMENT_MAX_ASSESSMENTS),
    disagreements: z.array(trustCriterionDisagreementSchema).max(TRUST_CRITERIA.length),
    coverageGaps: z.array(trustCriterionCoverageGapSchema).max(TRUST_CRITERIA.length),
  })
  .strict();
export type TrustDisagreementReport = z.infer<typeof trustDisagreementReportSchema>;
