import { z } from "zod";

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

export const createCommentInputSchema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty.").max(COMMENT_BODY_MAX),
  kind: commentKindSchema.default("comment"),
  /** Local claim id (e.g. "claim-003") within the review's current version. */
  claimLocalId: z.string().trim().min(1).max(200).optional(),
  /** Id of the comment being replied to. */
  parentId: z.string().trim().min(1).max(200).optional(),
});
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
