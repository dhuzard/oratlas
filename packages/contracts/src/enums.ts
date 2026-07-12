import { z } from "zod";

/** Editorial lifecycle of a submission. */
export const SUBMISSION_STATUSES = [
  "draft",
  "submitted",
  "automated-checks-failed",
  "pending-editorial-review",
  "changes-requested",
  "accepted",
  "rejected",
  "withdrawn",
  "superseded",
] as const;
export const submissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

/** Lifecycle of a public review record. */
export const REVIEW_STATUSES = ["published", "withdrawn", "superseded"] as const;
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const USER_ROLES = ["USER", "EDITOR", "ADMIN"] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Transparent, rule-based structural compatibility levels. */
export const COMPATIBILITY_LEVELS = [
  "verified-template",
  "compatible",
  "partially-compatible",
  "unsupported",
  "inspection-failed",
] as const;
export const compatibilityLevelSchema = z.enum(COMPATIBILITY_LEVELS);
export type CompatibilityLevel = z.infer<typeof compatibilityLevelSchema>;

export const INSPECTION_STATUSES = ["succeeded", "partial", "failed"] as const;
export const inspectionStatusSchema = z.enum(INSPECTION_STATUSES);
export type InspectionStatus = z.infer<typeof inspectionStatusSchema>;

/** How a citation relates to a claim. */
export const CLAIM_EVIDENCE_RELATION_TYPES = [
  "supports",
  "partially-supports",
  "contradicts",
  "contextualizes",
  "method-source",
  "background",
  "unclear",
] as const;
export const claimEvidenceRelationTypeSchema = z.enum(CLAIM_EVIDENCE_RELATION_TYPES);
export type ClaimEvidenceRelationType = z.infer<typeof claimEvidenceRelationTypeSchema>;

export const CLAIM_TYPES = [
  "empirical",
  "mechanistic",
  "methodological",
  "theoretical",
  "normative",
  "summary",
  "other",
] as const;
export const claimTypeSchema = z.enum(CLAIM_TYPES);
export type ClaimType = z.infer<typeof claimTypeSchema>;

export const REVIEW_TYPES = [
  "computational-literature-review",
  "systematic-review",
  "scoping-review",
  "narrative-review",
  "meta-analysis",
  "other",
] as const;
export const reviewTypeSchema = z.enum(REVIEW_TYPES);
export type ReviewType = z.infer<typeof reviewTypeSchema>;

/** Ordinal ratings for TRUST criteria. Never a probability. */
export const TRUST_ORDINALS = [
  "very-low",
  "low",
  "moderate",
  "high",
  "very-high",
  "not-assessed",
  "not-applicable",
] as const;
export const trustOrdinalSchema = z.enum(TRUST_ORDINALS);
export type TrustOrdinal = z.infer<typeof trustOrdinalSchema>;

export const TRUST_CRITERIA = [
  "identityIntegrity",
  "entailment",
  "sourceAccess",
  "populationRelevance",
  "interventionExposureRelevance",
  "outcomeRelevance",
  "methodologicalSafeguards",
  "statisticalSafeguards",
  "replicationConvergence",
  "conflictDependency",
] as const;
export type TrustCriterion = (typeof TRUST_CRITERIA)[number];

export const ASSESSMENT_REVIEW_STATUSES = [
  "unverified-import",
  "agent-proposed",
  "human-reviewed",
  "adjudicated",
  "superseded",
] as const;
export const assessmentReviewStatusSchema = z.enum(ASSESSMENT_REVIEW_STATUSES);
export type AssessmentReviewStatus = z.infer<typeof assessmentReviewStatusSchema>;

/** Statuses Atlas editors can assign through a platform verification marker. */
export const PLATFORM_TRUST_REVIEW_STATUSES = ["human-reviewed", "adjudicated"] as const;
export const platformTrustReviewStatusSchema = z.enum(PLATFORM_TRUST_REVIEW_STATUSES);
export type PlatformTrustReviewStatus = z.infer<typeof platformTrustReviewStatusSchema>;

/** Result of validating a separate Atlas verification marker against its canonical subject. */
export const TRUST_VERIFICATION_STATES = [
  "platform-verified",
  "unverified-import",
  "stale-verification",
  "legacy-unknown",
] as const;
export const trustVerificationStateSchema = z.enum(TRUST_VERIFICATION_STATES);
export type TrustVerificationState = z.infer<typeof trustVerificationStateSchema>;

export const ASSESSOR_TYPES = ["agent", "human"] as const;
export const assessorTypeSchema = z.enum(ASSESSOR_TYPES);
export type AssessorType = z.infer<typeof assessorTypeSchema>;

export const IDENTIFIER_SCHEMES = ["doi", "github", "orcid", "url", "zenodo-record"] as const;
export const identifierSchemeSchema = z.enum(IDENTIFIER_SCHEMES);
export type IdentifierScheme = z.infer<typeof identifierSchemeSchema>;

export const IDENTIFIER_RELATION_TYPES = [
  "version-doi",
  "concept-doi",
  "repository",
  "release",
  "published-review",
  "zenodo-record",
  "author-orcid",
] as const;
export const identifierRelationTypeSchema = z.enum(IDENTIFIER_RELATION_TYPES);
export type IdentifierRelationType = z.infer<typeof identifierRelationTypeSchema>;

export const IDENTIFIER_VALIDATION_STATUSES = [
  "unvalidated",
  "valid",
  "valid-with-warnings",
  "invalid",
  "example-not-resolvable",
] as const;
export const identifierValidationStatusSchema = z.enum(IDENTIFIER_VALIDATION_STATUSES);
export type IdentifierValidationStatus = z.infer<typeof identifierValidationStatusSchema>;

export const LINK_PROPOSAL_STATUSES = ["proposed", "accepted", "rejected", "superseded"] as const;
export const linkProposalStatusSchema = z.enum(LINK_PROPOSAL_STATUSES);
export type LinkProposalStatus = z.infer<typeof linkProposalStatusSchema>;

export const LINK_PROPOSAL_TYPES = [
  "semantically-similar-claims",
  "potentially-contradictory-claims",
  "shared-citations",
  "shared-population",
  "shared-intervention-exposure",
  "shared-outcome",
  "methodological-dependency",
  "duplicated-evidence-base",
] as const;
export const linkProposalTypeSchema = z.enum(LINK_PROPOSAL_TYPES);
export type LinkProposalType = z.infer<typeof linkProposalTypeSchema>;

export const AGENT_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export const agentRunStatusSchema = z.enum(AGENT_RUN_STATUSES);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const HUMAN_REVIEW_STATUSES = ["unreviewed", "approved", "rejected"] as const;
export const humanReviewStatusSchema = z.enum(HUMAN_REVIEW_STATUSES);
export type HumanReviewStatus = z.infer<typeof humanReviewStatusSchema>;

export const DISCUSSION_ROLES = ["user", "assistant"] as const;
export const discussionRoleSchema = z.enum(DISCUSSION_ROLES);
export type DiscussionRole = z.infer<typeof discussionRoleSchema>;

/** Where an extracted metadata value came from (priority order of the extractor). */
export const EXTRACTION_SOURCES = [
  "review-manifest",
  "citation-cff",
  "zenodo-json",
  "codemeta",
  "myst-config",
  "repository-metadata",
  "readme",
  "heuristic",
  "manual",
] as const;
export const extractionSourceSchema = z.enum(EXTRACTION_SOURCES);
export type ExtractionSource = z.infer<typeof extractionSourceSchema>;
