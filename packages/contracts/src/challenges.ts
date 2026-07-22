import { z } from "zod";
import {
  conflictOfInterestSnapshotSchema,
  publicConflictOverrideSchema,
} from "./conflicts-of-interest.js";

export const CHALLENGE_SUBJECT_TYPES = ["claim", "relation", "assessment-criterion"] as const;
export const challengeSubjectTypeSchema = z.enum(CHALLENGE_SUBJECT_TYPES);

export const CHALLENGE_GROUNDS = [
  "entailment",
  "source-access",
  "methodology",
  "identity",
  "other",
] as const;
export const challengeGroundsSchema = z.enum(CHALLENGE_GROUNDS);
export type ChallengeGrounds = z.infer<typeof challengeGroundsSchema>;

export const CHALLENGE_STATUSES = [
  "open",
  "author-responded",
  "resolved",
  "dismissed",
  "withdrawn",
] as const;
export const challengeStatusSchema = z.enum(CHALLENGE_STATUSES);
export type ChallengeStatus = z.infer<typeof challengeStatusSchema>;

export const CHALLENGE_BODY_MAX = 10_000;
export const CHALLENGE_RESPONSE_BODY_MAX = 10_000;
export const CHALLENGE_RATIONALE_MAX = 5_000;
const id = z.string().trim().min(1).max(200);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const challengeSubjectInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("claim"), claimId: id }),
  z.object({ type: z.literal("relation"), relationId: id }),
  z.object({
    type: z.literal("assessment-criterion"),
    assessmentId: id,
    criterion: id,
  }),
]);
export type ChallengeSubjectInput = z.infer<typeof challengeSubjectInputSchema>;

export const createChallengeInputSchema = z.object({
  reviewVersionId: id,
  subject: challengeSubjectInputSchema,
  canonicalSubjectHash: sha256,
  grounds: challengeGroundsSchema,
  body: z.string().trim().min(1).max(CHALLENGE_BODY_MAX),
});
export type CreateChallengeInput = z.infer<typeof createChallengeInputSchema>;

export const transitionChallengeInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    toStatus: challengeStatusSchema.exclude(["open"]),
    rationale: z.string().trim().min(1).max(CHALLENGE_RATIONALE_MAX).optional(),
    conflictOfInterest: conflictOfInterestSnapshotSchema.optional(),
    administratorOverride: z.literal(true).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const outcome = input.toStatus === "resolved" || input.toStatus === "dismissed";
    if (outcome && !input.conflictOfInterest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conflictOfInterest"],
        message: "Editorial outcomes require a conflict-of-interest snapshot.",
      });
    }
    if (!outcome && (input.conflictOfInterest || input.administratorOverride)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Conflict snapshots and overrides apply only to editorial outcomes.",
      });
    }
    if (input.administratorOverride && input.conflictOfInterest?.status !== "conflict-declared") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["administratorOverride"],
        message: "An administrator override requires conflict-declared.",
      });
    }
  });
export type TransitionChallengeInput = z.infer<typeof transitionChallengeInputSchema>;

export const challengeTransitionSchema = z
  .object({
    id: z.string(),
    fromStatus: challengeStatusSchema.nullable(),
    toStatus: challengeStatusSchema,
    actor: z.object({ githubLogin: z.string() }),
    conflictOfInterest: conflictOfInterestSnapshotSchema,
    administratorOverride: publicConflictOverrideSchema.optional(),
    revision: z.number().int().nonnegative(),
    createdAt: z.string(),
  })
  .superRefine((transition, context) => {
    if (
      transition.administratorOverride &&
      transition.conflictOfInterest.status !== "conflict-declared"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["administratorOverride"],
        message: "A public administrator override requires conflict-declared.",
      });
    }
  });

export const challengeContentStatusSchema = z.enum(["visible", "removed"]);
export type ChallengeContentStatus = z.infer<typeof challengeContentStatusSchema>;

export const createChallengeResponseInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  body: z.string().trim().min(1).max(CHALLENGE_RESPONSE_BODY_MAX),
});
export type CreateChallengeResponseInput = z.infer<typeof createChallengeResponseInputSchema>;

export const moderateChallengeContentInputSchema = z
  .object({
    expectedContentRevision: z.number().int().nonnegative(),
  })
  .strict();
export type ModerateChallengeContentInput = z.infer<typeof moderateChallengeContentInputSchema>;

export const publicChallengeResponseSchema = z.object({
  id: z.string(),
  body: z.string(),
  contentHash: sha256,
  contentStatus: challengeContentStatusSchema,
  contentRevision: z.number().int().nonnegative(),
  responder: z.object({ githubLogin: z.string(), displayName: z.string().nullable() }),
  createdAt: z.string(),
});

export const publicChallengeSchema = z.object({
  id: z.string(),
  reviewVersionId: z.string(),
  subjectType: challengeSubjectTypeSchema,
  subjectLabel: z.string(),
  subjectHref: z.string(),
  canonicalSubjectHash: sha256,
  filedContentHash: sha256,
  grounds: challengeGroundsSchema,
  body: z.string(),
  contentStatus: challengeContentStatusSchema,
  contentRevision: z.number().int().nonnegative(),
  status: challengeStatusSchema,
  revision: z.number().int().nonnegative(),
  challenger: z.object({ githubLogin: z.string(), displayName: z.string().nullable() }),
  transitions: z.array(challengeTransitionSchema),
  response: publicChallengeResponseSchema.nullable(),
  createdAt: z.string(),
});
export type PublicChallenge = z.infer<typeof publicChallengeSchema>;

export const challengeListSchema = z.object({
  reviewSlug: z.string(),
  reviewVersionId: z.string(),
  challenges: z.array(publicChallengeSchema),
});
export type ChallengeList = z.infer<typeof challengeListSchema>;

/** Legal edges are intentionally closed; terminal states cannot transition. */
export function isLegalChallengeTransition(from: ChallengeStatus, to: ChallengeStatus): boolean {
  if (from === "open") return to === "author-responded";
  if (from === "author-responded") return ["resolved", "dismissed", "withdrawn"].includes(to);
  return false;
}
