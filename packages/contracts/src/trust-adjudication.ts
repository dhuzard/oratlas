import { z } from "zod";
import {
  conflictOfInterestSnapshotSchema,
  publicConflictOverrideSchema,
} from "./conflicts-of-interest.js";
import { TRUST_DISAGREEMENT_MAX_ASSESSMENTS } from "./trust-disagreement.js";

export const TRUST_ADJUDICATION_OUTCOMES = [
  "disagreement-upheld",
  "assessment-upheld",
  "reassessment-requested",
] as const;
export const trustAdjudicationOutcomeSchema = z.enum(TRUST_ADJUDICATION_OUTCOMES);
export type TrustAdjudicationOutcome = z.infer<typeof trustAdjudicationOutcomeSchema>;

export const createTrustAdjudicationInputSchema = z
  .object({
    subjectType: z.enum(["claim-citation", "node-relation"]),
    assessmentIds: z
      .array(z.string().trim().min(1).max(200))
      .min(2)
      .max(TRUST_DISAGREEMENT_MAX_ASSESSMENTS),
    expectedDisagreementHash: z.string().regex(/^[a-f0-9]{64}$/),
    outcome: trustAdjudicationOutcomeSchema,
    selectedAssessmentId: z.string().trim().min(1).max(200).optional(),
    rationale: z.string().trim().min(20).max(10_000),
    conflictOfInterest: conflictOfInterestSnapshotSchema,
    administratorOverride: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.assessmentIds).size !== input.assessmentIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assessmentIds"],
        message: "Assessment identifiers must be unique.",
      });
    }
    if ((input.outcome === "assessment-upheld") !== (input.selectedAssessmentId !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedAssessmentId"],
        message: "assessment-upheld requires exactly one selected referenced assessment.",
      });
    }
    if (
      input.selectedAssessmentId !== undefined &&
      !input.assessmentIds.includes(input.selectedAssessmentId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedAssessmentId"],
        message: "The selected assessment must be referenced by the adjudication.",
      });
    }
    if (input.administratorOverride && input.conflictOfInterest.status !== "conflict-declared") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["administratorOverride"],
        message: "Administrator override requires conflict-declared.",
      });
    }
  });
export type CreateTrustAdjudicationInput = z.infer<typeof createTrustAdjudicationInputSchema>;

export const publicTrustAdjudicationSchema = z
  .object({
    id: z.string().min(1),
    subjectType: z.enum(["claim-citation", "node-relation"]),
    protocolVersion: z.string().min(1),
    assessmentIds: z.array(z.string().min(1)).min(2),
    outcome: trustAdjudicationOutcomeSchema,
    selectedAssessmentId: z.string().min(1).optional(),
    adjudicator: z.object({ githubLogin: z.string().min(1) }).strict(),
    conflictOfInterest: conflictOfInterestSnapshotSchema,
    administratorOverride: publicConflictOverrideSchema.optional(),
    disagreementHash: z.string().regex(/^[a-f0-9]{64}$/),
    outcomeHash: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string().datetime(),
    valid: z.boolean(),
  })
  .strict();
export type PublicTrustAdjudication = z.infer<typeof publicTrustAdjudicationSchema>;
