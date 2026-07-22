import { z } from "zod";

export const CONFLICT_OF_INTEREST_STATUSES = [
  "none-declared",
  "conflict-declared",
  "not-provided",
] as const;

export const conflictOfInterestStatusSchema = z.enum(CONFLICT_OF_INTEREST_STATUSES);
export type ConflictOfInterestStatus = z.infer<typeof conflictOfInterestStatusSchema>;

/** Immutable public snapshot. Deliberately contains no severity or free text. */
export const conflictOfInterestSnapshotSchema = z
  .object({ status: conflictOfInterestStatusSchema })
  .strict();
export type ConflictOfInterestSnapshot = z.infer<typeof conflictOfInterestSnapshotSchema>;

/** Public provenance for the exceptional administrator self-involvement path. */
export const publicConflictOverrideSchema = z
  .object({
    administrator: z.object({ githubLogin: z.string().min(1) }).strict(),
    exercisedAt: z.string().datetime(),
  })
  .strict();
export type PublicConflictOverride = z.infer<typeof publicConflictOverrideSchema>;

/** Input shared by every immutable editorial outcome surface. */
export const conflictOfInterestOutcomeInputSchema = z
  .object({
    conflictOfInterest: conflictOfInterestSnapshotSchema,
    administratorOverride: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.administratorOverride && input.conflictOfInterest.status !== "conflict-declared") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["administratorOverride"],
        message: "Administrator override requires conflict-declared.",
      });
    }
  });
export type ConflictOfInterestOutcomeInput = z.infer<typeof conflictOfInterestOutcomeInputSchema>;
