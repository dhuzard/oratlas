import { z } from "zod";

export const REVIEW_LIFECYCLE_KINDS = ["correction", "withdrawal", "tombstone"] as const;
export type ReviewLifecycleKind = (typeof REVIEW_LIFECYCLE_KINDS)[number];

export const REVIEW_VERSION_PUBLIC_STATES = ["published", "withdrawn", "tombstoned"] as const;
export type ReviewVersionPublicState = (typeof REVIEW_VERSION_PUBLIC_STATES)[number];

export const reviewLifecycleMutationSchema = z
  .object({
    reviewSlug: z.string().trim().min(1).max(200),
    reviewVersionId: z.string().trim().min(1).max(200),
    kind: z.enum(REVIEW_LIFECYCLE_KINDS),
    reason: z.string().trim().min(20).max(5000),
    expectedRevision: z.number().int().nonnegative(),
    supersedesVersionId: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((value, context) => {
    if (value.kind === "correction" && !value.supersedesVersionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supersedesVersionId"],
        message: "A correction must identify the prior version it supersedes.",
      });
    }
    if (value.kind !== "correction" && value.supersedesVersionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supersedesVersionId"],
        message: "Only correction events may supersede another version.",
      });
    }
    if (value.reviewVersionId === value.supersedesVersionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supersedesVersionId"],
        message: "A correction cannot supersede itself.",
      });
    }
  });
export type ReviewLifecycleMutation = z.infer<typeof reviewLifecycleMutationSchema>;

export interface PublicLifecycleEvent {
  id: string;
  kind: ReviewLifecycleKind;
  reviewVersionId: string;
  supersedesVersionId?: string;
  reason: string;
  actorLogin: string;
  revision: number;
  createdAt: string;
}
