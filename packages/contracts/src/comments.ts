import { z } from "zod";
import { isSafeRepoRelativePath } from "./paths.js";

/**
 * Review commentary contracts — the human scholarly-exchange layer on a
 * published review. Comments are typed (question, concern, …) so the exchange
 * stays legible as scientific discourse, may be anchored to a specific claim,
 * and thread one level deep. Bodies are plain text: the UI renders them
 * escaped, never as HTML (repository/user content is untrusted).
 */

/** The register of a contribution to the exchange. */
export const COMMENT_KINDS = [
  "comment",
  "question",
  "concern",
  "suggestion",
  "endorsement",
] as const;
export const commentKindSchema = z.enum(COMMENT_KINDS);
export type CommentKind = z.infer<typeof commentKindSchema>;

export const COMMENT_STATUSES = ["visible", "removed"] as const;
export const commentStatusSchema = z.enum(COMMENT_STATUSES);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

export const COMMENT_BODY_MAX = 5_000;

/** W3C text selectors count Unicode code points, not UTF-16 code units. */
export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length;
}

const selectorTextSchema = (maximum: number) =>
  z.string().refine((value) => unicodeCodePointLength(value) <= maximum, {
    message: `Text must contain at most ${maximum} Unicode code points.`,
  });

export const textQuoteSelectorSchema = z
  .object({
    type: z.literal("TextQuoteSelector"),
    exact: selectorTextSchema(2_000).refine((value) => unicodeCodePointLength(value) > 0, {
      message: "Exact text cannot be empty.",
    }),
    prefix: selectorTextSchema(256).optional(),
    suffix: selectorTextSchema(256).optional(),
  })
  .strict();

export const textPositionSelectorSchema = z
  .object({
    type: z.literal("TextPositionSelector"),
    start: z.number().int().nonnegative().max(10_000_000),
    end: z.number().int().positive().max(10_000_000),
  })
  .strict()
  .refine((selector) => selector.end > selector.start, {
    message: "Text position end must be greater than start.",
    path: ["end"],
  });

/** Immutable target for a selection in ORAtlas's rendered MyST representation. */
export const passageCommentAnchorSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    representation: z.literal("myst-rendered-text-v1"),
    documentPath: z
      .string()
      .min(1)
      .max(512)
      .refine(isSafeRepoRelativePath, "Document path must be repository-relative and safe."),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    astNodeId: z.string().min(1).max(240).optional(),
    textQuote: textQuoteSelectorSchema,
    textPosition: textPositionSelectorSchema,
  })
  .strict()
  .superRefine((anchor, context) => {
    if (
      anchor.textPosition.end - anchor.textPosition.start !==
      unicodeCodePointLength(anchor.textQuote.exact)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Text position length must match the exact selected quote.",
        path: ["textPosition", "end"],
      });
    }
  });
export type PassageCommentAnchor = z.infer<typeof passageCommentAnchorSchema>;

export const createCommentInputSchema = z
  .object({
    body: z.string().trim().min(1, "Comment cannot be empty.").max(COMMENT_BODY_MAX),
    kind: commentKindSchema.default("comment"),
    /** Local claim id (e.g. "claim-003") within the review's current version. */
    claimLocalId: z.string().trim().min(1).max(200).optional(),
    /** Exact selected passage in the immutable rendered review version. */
    anchor: passageCommentAnchorSchema.optional(),
    /** Id of the comment being replied to. */
    parentId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;

export const commentAuthorSchema = z.object({
  githubLogin: z.string(),
  displayName: z.string().nullable(),
  role: z.string(),
});
export type CommentAuthor = z.infer<typeof commentAuthorSchema>;

const commentBaseSchema = z.object({
  id: z.string(),
  reviewVersionId: z.string(),
  kind: commentKindSchema,
  status: commentStatusSchema,
  /** Empty when status is "removed" — the body is never served for those. */
  body: z.string(),
  author: commentAuthorSchema.nullable(),
  claimLocalId: z.string().optional(),
  claimAnchor: z.string().optional(),
  anchor: passageCommentAnchorSchema.optional(),
  createdAt: z.string(),
});

export const reviewCommentSchema = commentBaseSchema.extend({
  replies: z.array(commentBaseSchema),
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;

export const reviewCommentListSchema = z.object({
  reviewSlug: z.string(),
  reviewVersionId: z.string(),
  /** Visible comments + replies. */
  commentCount: z.number().int(),
  comments: z.array(reviewCommentSchema),
});
export type ReviewCommentList = z.infer<typeof reviewCommentListSchema>;
