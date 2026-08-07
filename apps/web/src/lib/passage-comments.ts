import type { ReviewCommentList } from "@oratlas/contracts";

type CommentNode = ReviewCommentList["comments"][number];

/** Keep an anchored thread visible while it still contains a public contribution. */
export function passageThreadsForPage(
  comments: ReviewCommentList["comments"],
  documentPath?: string,
): CommentNode[] {
  return comments.filter(
    (comment) =>
      comment.anchor?.documentPath === documentPath &&
      (comment.status === "visible" || comment.replies.some((reply) => reply.status === "visible")),
  );
}

export function visiblePassageContributionCount(comment: CommentNode): number {
  return (
    (comment.status === "visible" ? 1 : 0) +
    comment.replies.filter((reply) => reply.status === "visible").length
  );
}
