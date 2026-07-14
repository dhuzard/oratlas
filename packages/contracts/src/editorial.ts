import { z } from "zod";
import { orcidSchema } from "./identifiers.js";

/**
 * Formal editorial-review lifecycle contracts (issue #6). Archive acceptance
 * and peer review remain distinct: these records describe the open review
 * process around a submission, never the automated structural checks.
 */

/** CRediT contributor-role taxonomy (v1.0), kebab-cased. */
export const CREDIT_ROLES = [
  "conceptualization",
  "data-curation",
  "formal-analysis",
  "funding-acquisition",
  "investigation",
  "methodology",
  "project-administration",
  "resources",
  "software",
  "supervision",
  "validation",
  "visualization",
  "writing-original-draft",
  "writing-review-editing",
] as const;
export const creditRoleSchema = z.enum(CREDIT_ROLES);
export type CreditRole = z.infer<typeof creditRoleSchema>;

/** Split contributor roles into recognized CRediT roles and free-text extras. */
export function normalizeCreditRoles(roles: string[]): {
  credit: CreditRole[];
  other: string[];
} {
  const credit: CreditRole[] = [];
  const other: string[] = [];
  for (const role of roles) {
    const normalized = role
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    const parsed = creditRoleSchema.safeParse(normalized);
    if (parsed.success) {
      if (!credit.includes(parsed.data)) credit.push(parsed.data);
    } else if (role.trim().length > 0) {
      other.push(role.trim());
    }
  }
  return { credit, other };
}

export const EDITOR_ASSIGNMENT_STATUSES = ["active", "recused", "completed"] as const;
export const editorAssignmentStatusSchema = z.enum(EDITOR_ASSIGNMENT_STATUSES);
export type EditorAssignmentStatus = z.infer<typeof editorAssignmentStatusSchema>;

export const REVIEW_ROUND_STATUSES = ["open", "decided"] as const;
export const reviewRoundStatusSchema = z.enum(REVIEW_ROUND_STATUSES);
export type ReviewRoundStatus = z.infer<typeof reviewRoundStatusSchema>;

export const REVIEW_RECOMMENDATIONS = [
  "accept",
  "minor-revision",
  "major-revision",
  "reject",
] as const;
export const reviewRecommendationSchema = z.enum(REVIEW_RECOMMENDATIONS);
export type ReviewRecommendation = z.infer<typeof reviewRecommendationSchema>;

/** Round decisions map onto the existing archive decision endpoint. */
export const ROUND_DECISIONS = ["accept", "reject", "request-changes"] as const;
export const roundDecisionSchema = z.enum(ROUND_DECISIONS);
export type RoundDecision = z.infer<typeof roundDecisionSchema>;

export const NOTIFICATION_KINDS = [
  "editor-assigned",
  "editor-recused",
  "round-opened",
  "report-submitted",
  "author-responded",
  "decision-issued",
  "submission-resubmitted",
  "evidence-alert",
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** Check-scoped editorial overrides accompanying an acceptance decision. */
export const editorialOverridesSchema = z
  .array(
    z.object({
      checkId: z.string().trim().min(1).max(120),
      rationale: z.string().trim().min(20).max(4000),
    }),
  )
  .max(30)
  .default([]);

/** Editor's conflict-of-interest declaration at assignment time. */
export const conflictOfInterestSchema = z.object({
  declared: z.boolean(),
  statement: z.string().trim().max(2000).default(""),
});
export type ConflictOfInterest = z.infer<typeof conflictOfInterestSchema>;

/** Structured, immutable formal peer-review report body. */
export const formalReviewReportBodySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    summary: z.string().trim().min(50).max(20_000),
    strengths: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
    weaknesses: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
    questions: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
  })
  .strict();
export type FormalReviewReportBody = z.infer<typeof formalReviewReportBodySchema>;

export const authorResponseBodySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    response: z.string().trim().min(20).max(50_000),
  })
  .strict();
export type AuthorResponseBody = z.infer<typeof authorResponseBodySchema>;

export const decisionLetterBodySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    letter: z.string().trim().min(20).max(50_000),
  })
  .strict();
export type DecisionLetterBody = z.infer<typeof decisionLetterBodySchema>;

/** Reviewer ORCID snapshot recorded on a report; verification is explicit. */
export const reviewerOrcidSchema = z.object({
  orcid: orcidSchema,
  verified: z.boolean(),
});
export type ReviewerOrcid = z.infer<typeof reviewerOrcidSchema>;
