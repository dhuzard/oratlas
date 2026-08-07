import type { PassageCommentAnchor, ReviewCommentList } from "@oratlas/contracts";

type CommentNode = ReviewCommentList["comments"][number];
type ReplyNode = CommentNode["replies"][number];

function annotationTarget(
  reviewUrl: string,
  anchor?: PassageCommentAnchor,
  claimAnchor?: string,
): Record<string, unknown> | string {
  if (anchor) {
    return {
      type: "SpecificResource",
      source: reviewUrl,
      selector: [anchor.textQuote, anchor.textPosition],
      "oratlas:documentPath": anchor.documentPath,
      "oratlas:sourceSha256": anchor.sourceSha256,
      "oratlas:representation": anchor.representation,
      ...(anchor.astNodeId ? { "oratlas:astNodeId": anchor.astNodeId } : {}),
    };
  }
  return claimAnchor ? `${reviewUrl}#${claimAnchor}` : reviewUrl;
}

function annotationItem(
  reviewUrl: string,
  comment: CommentNode | ReplyNode,
  inheritedAnchor?: PassageCommentAnchor,
  inheritedClaimAnchor?: string,
) {
  const anchor = comment.anchor ?? inheritedAnchor;
  const claimAnchor = comment.claimAnchor ?? inheritedClaimAnchor;
  return {
    id: `${reviewUrl}#comment-${comment.id}`,
    type: "Annotation",
    motivation: "commenting",
    created: comment.createdAt,
    creator: comment.author
      ? {
          type: "Person",
          name: comment.author.displayName ?? comment.author.githubLogin,
          nickname: comment.author.githubLogin,
        }
      : undefined,
    body: {
      type: "TextualBody",
      value: comment.body,
      format: "text/plain",
      purpose: comment.kind === "comment" ? "commenting" : `oratlas:${comment.kind}`,
    },
    target: annotationTarget(reviewUrl, anchor, claimAnchor),
  };
}

/** Build an interoperable, public annotation page without exposing removed comment bodies. */
export function buildCommentAnnotationPage(
  requestUrl: string,
  comments: ReviewCommentList,
): Record<string, unknown> {
  const endpoint = new URL(requestUrl);
  const reviewUrl = new URL(
    `/reviews/${encodeURIComponent(comments.reviewSlug)}/versions/${encodeURIComponent(comments.reviewVersionId)}`,
    endpoint,
  ).toString();
  const items = comments.comments.flatMap((comment) => {
    const visible = comment.status === "visible" ? [annotationItem(reviewUrl, comment)] : [];
    return [
      ...visible,
      ...comment.replies.map((reply) =>
        annotationItem(reviewUrl, reply, comment.anchor, comment.claimAnchor),
      ),
    ];
  });

  return {
    "@context": ["http://www.w3.org/ns/anno.jsonld", { oratlas: "https://oratlas.org/ns#" }],
    id: endpoint.toString(),
    type: "AnnotationPage",
    partOf: reviewUrl,
    items,
  };
}
