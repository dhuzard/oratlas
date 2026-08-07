import "server-only";
import {
  canonicalJson,
  claimDomAnchor,
  isExactCommitSha,
  normalizeGitHubLogin,
  passageCommentAnchorSchema,
  preservedFilesSchema,
  type CommentKind,
  type CreateCommentInput,
  type PassageCommentAnchor,
  type ReviewComment,
  type ReviewCommentList,
} from "@oratlas/contracts";
import { parseJsonColumn, prisma } from "./db";
import { isEditor, type SessionUser } from "./auth";
import { isReadablePublicState, isTombstonedState } from "./review-lifecycle";
import { sha256 } from "./hash";
import { buildMystArticle } from "./article-reader";

export class CommentError extends Error {
  constructor(
    message: string,
    public readonly code: "not-found" | "bad-request" | "forbidden" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "CommentError";
  }
}

type CommentRow = {
  id: string;
  reviewVersionId: string | null;
  parentId: string | null;
  kind: string;
  status: string;
  body: string;
  targetDocumentPath: string | null;
  targetSelectorJson: string | null;
  targetSelectorHash: string | null;
  createdAt: Date;
  author: { githubLogin: string; displayName: string | null; role: string };
  claim: { localClaimId: string; anchor: string | null; reviewVersionId: string } | null;
};

const commentInclude = {
  author: { select: { githubLogin: true, displayName: true, role: true } },
  claim: { select: { localClaimId: true, anchor: true, reviewVersionId: true } },
} as const;

function passageMatchesRenderedText(text: string, anchor: PassageCommentAnchor): boolean {
  const content = Array.from(text);
  const exact = Array.from(anchor.textQuote.exact);
  const { start, end } = anchor.textPosition;
  if (end > content.length || end - start !== exact.length) return false;
  if (content.slice(start, end).join("") !== anchor.textQuote.exact) return false;
  if (anchor.textQuote.prefix) {
    const prefix = Array.from(anchor.textQuote.prefix);
    if (
      content.slice(Math.max(0, start - prefix.length), start).join("") !== anchor.textQuote.prefix
    )
      return false;
  }
  if (anchor.textQuote.suffix) {
    const suffix = Array.from(anchor.textQuote.suffix);
    if (content.slice(end, end + suffix.length).join("") !== anchor.textQuote.suffix) return false;
  }
  return true;
}

function toDto(row: CommentRow, selectedVersionId: string): Omit<ReviewComment, "replies"> {
  const removed = row.status !== "visible";
  const parsedAnchor = row.targetSelectorJson
    ? passageCommentAnchorSchema.safeParse(parseJsonColumn<unknown>(row.targetSelectorJson, null))
    : undefined;
  const anchor =
    parsedAnchor?.success &&
    parsedAnchor.data.documentPath === row.targetDocumentPath &&
    sha256(canonicalJson(parsedAnchor.data)) === row.targetSelectorHash
      ? parsedAnchor.data
      : undefined;
  return {
    id: row.id,
    reviewVersionId: row.reviewVersionId ?? row.claim?.reviewVersionId ?? selectedVersionId,
    kind: row.kind as CommentKind,
    status: removed ? "removed" : "visible",
    // Never serve the body of a removed comment.
    body: removed ? "" : row.body,
    author: removed ? null : row.author,
    claimLocalId: row.claim?.localClaimId,
    claimAnchor: row.claim
      ? claimDomAnchor(row.claim.reviewVersionId, row.claim.localClaimId)
      : undefined,
    anchor,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * All comments for a review, threaded one level deep and ordered oldest-first.
 * Removed comments are kept as placeholders only when they still hold visible
 * replies (so threads stay coherent); otherwise they are dropped.
 */
export async function listReviewComments(
  slug: string,
  requestedVersionId?: string,
): Promise<ReviewCommentList | null> {
  const review = await prisma.review.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      versions: {
        select: {
          id: true,
          publicState: true,
          snapshot: { select: { commitSha: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!review) return null;
  const selectedVersion = requestedVersionId
    ? review.versions.find((version) => version.id === requestedVersionId)
    : review.versions[0];
  if (!selectedVersion) return null;
  if (
    review.status !== "published" ||
    !selectedVersion.snapshot ||
    !isExactCommitSha(selectedVersion.snapshot.commitSha)
  ) {
    return null;
  }
  if (isTombstonedState(selectedVersion.publicState)) {
    return {
      reviewSlug: slug,
      reviewVersionId: selectedVersion.id,
      commentCount: 0,
      comments: [],
    };
  }
  const isCurrentVersion = selectedVersion.id === review.versions[0]?.id;

  const rows = await prisma.reviewComment.findMany({
    where: {
      reviewId: review.id,
      OR: [
        { reviewVersionId: selectedVersion.id },
        // Transitional support for old claim-anchored rows.
        { reviewVersionId: null, claim: { reviewVersionId: selectedVersion.id } },
        // An unscoped legacy comment can only be associated with the current version.
        ...(isCurrentVersion ? [{ reviewVersionId: null, claimId: null }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
    include: commentInclude,
  });

  const topLevel: ReviewComment[] = [];
  const byId = new Map<string, ReviewComment>();
  for (const row of rows) {
    if (row.parentId) continue;
    const node = {
      ...toDto(row, selectedVersion.id),
      replies: [] as ReviewComment["replies"],
    };
    topLevel.push(node);
    byId.set(row.id, node);
  }
  for (const row of rows) {
    if (!row.parentId || row.status !== "visible") continue;
    byId.get(row.parentId)?.replies.push(toDto(row, selectedVersion.id));
  }

  const comments = topLevel.filter((c) => c.status === "visible" || c.replies.length > 0);
  const commentCount = comments.reduce(
    (n, c) => n + (c.status === "visible" ? 1 : 0) + c.replies.length,
    0,
  );
  return { reviewSlug: slug, reviewVersionId: selectedVersion.id, commentCount, comments };
}

/** Create a comment (or a reply) on a published review. */
export async function createReviewComment(
  slug: string,
  author: SessionUser,
  input: CreateCommentInput,
): Promise<{ id: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({
        where: { slug },
        select: {
          id: true,
          status: true,
          lifecycleRevision: true,
          currentSnapshotId: true,
          versions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              publicState: true,
              publishedAt: true,
              snapshot: {
                select: {
                  commitSha: true,
                  preservedFilesJson: true,
                  repository: { select: { owner: true, name: true } },
                },
              },
              sourceSubmission: { select: { submitterId: true } },
              contributors: {
                select: { person: { select: { githubLogin: true } } },
              },
            },
          },
        },
      });
      if (!review) throw new CommentError("Review not found.", "not-found");
      if (review.status !== "published") {
        throw new CommentError("Comments are only open on published reviews.");
      }
      const currentVersion = review.versions[0];
      const reviewVersionId = currentVersion?.id;
      if (!currentVersion || !reviewVersionId) {
        throw new CommentError("Review has no published version.");
      }
      if (
        !isReadablePublicState(currentVersion.publicState) ||
        !currentVersion.publishedAt ||
        !currentVersion.snapshot ||
        !isExactCommitSha(currentVersion.snapshot.commitSha)
      ) {
        throw new CommentError("Comments are closed on this withheld review version.");
      }

      let passageAnchor: PassageCommentAnchor | undefined;
      let targetSelectorJson: string | undefined;
      let targetSelectorHash: string | undefined;
      if (input.anchor) {
        if (input.parentId) {
          throw new CommentError("Replies inherit the parent passage and cannot retarget it.");
        }
        const files = preservedFilesSchema.safeParse(
          parseJsonColumn<unknown>(currentVersion.snapshot?.preservedFilesJson, null),
        );
        const article = files.success
          ? buildMystArticle({
              files: files.data,
              repositoryOwner: currentVersion.snapshot.repository.owner,
              repositoryName: currentVersion.snapshot.repository.name,
              commitSha: currentVersion.snapshot.commitSha,
            })
          : null;
        const targetPage = article?.pages.find(
          (candidate) => candidate.path === input.anchor?.documentPath,
        );
        if (!targetPage) {
          throw new CommentError(
            "The selected document is not a preserved rendered MyST page for this version.",
          );
        }
        if (
          targetPage.sha256 !== input.anchor.sourceSha256 ||
          !passageMatchesRenderedText(targetPage.renderedText, input.anchor)
        ) {
          throw new CommentError(
            "The selected passage does not match the immutable rendered source version.",
            "conflict",
          );
        }
        passageAnchor = input.anchor;
        targetSelectorJson = canonicalJson(passageAnchor);
        targetSelectorHash = sha256(targetSelectorJson);
      }

      let claimId: string | undefined;
      if (input.claimLocalId) {
        const claim = await tx.claim.findUnique({
          where: {
            reviewVersionId_localClaimId: {
              reviewVersionId,
              localClaimId: input.claimLocalId,
            },
          },
          select: { id: true },
        });
        if (!claim) throw new CommentError("Unknown claim for this review.");
        claimId = claim.id;
      }

      let parentId: string | undefined;
      let repliedToAuthorId: string | undefined;
      if (input.parentId) {
        const parent = await tx.reviewComment.findUnique({
          where: { id: input.parentId },
          select: {
            id: true,
            parentId: true,
            reviewId: true,
            reviewVersionId: true,
            status: true,
            authorId: true,
            claim: { select: { reviewVersionId: true } },
          },
        });
        if (!parent || parent.reviewId !== review.id) {
          throw new CommentError("Unknown parent comment for this review.");
        }
        if (parent.status !== "visible") {
          throw new CommentError("Cannot reply to a removed comment.");
        }
        const parentVersionId = parent.reviewVersionId ?? parent.claim?.reviewVersionId;
        if (parentVersionId && parentVersionId !== reviewVersionId) {
          throw new CommentError("Cannot reply across review versions.");
        }
        // Threads stay one level deep: replying to a reply joins its thread.
        parentId = parent.parentId ?? parent.id;
        repliedToAuthorId = parent.authorId;
      }

      // Lock and compare both lifecycle epoch and current snapshot before the
      // insert. A concurrent tombstone/new accepted version either commits
      // first (count 0) or waits until this earlier comment transaction ends.
      const reviewClaim = await tx.review.updateMany({
        where: {
          id: review.id,
          status: "published",
          lifecycleRevision: review.lifecycleRevision,
          currentSnapshotId: review.currentSnapshotId,
        },
        data: { lifecycleRevision: review.lifecycleRevision },
      });
      const versionClaim = await tx.reviewVersion.updateMany({
        where: {
          id: reviewVersionId,
          publicState: currentVersion.publicState,
          publishedAt: { not: null },
        },
        data: { publicState: currentVersion.publicState },
      });
      if (reviewClaim.count !== 1 || versionClaim.count !== 1) {
        throw new CommentError(
          "Review lifecycle changed while the comment was being posted.",
          "conflict",
        );
      }

      const comment = await tx.reviewComment.create({
        data: {
          reviewId: review.id,
          reviewVersionId,
          authorId: author.id,
          parentId,
          claimId,
          targetDocumentPath: passageAnchor?.documentPath,
          targetSelectorJson,
          targetSelectorHash,
          kind: input.kind,
          body: input.body,
        },
      });
      const notificationRecipients = new Set<string>();
      if (currentVersion.sourceSubmission?.submitterId) {
        notificationRecipients.add(currentVersion.sourceSubmission.submitterId);
      }
      const contributorLogins = currentVersion.contributors.flatMap(({ person }) =>
        person.githubLogin ? [person.githubLogin] : [],
      );
      const normalizedContributorLogins = new Set(contributorLogins.map(normalizeGitHubLogin));
      if (normalizedContributorLogins.size > 0) {
        const contributorUsers = await tx.user.findMany({
          where: {
            OR: [
              { githubLoginNormalized: { in: [...normalizedContributorLogins] } },
              { githubLogin: { in: contributorLogins } },
            ],
          },
          select: { id: true, githubLogin: true },
        });
        for (const contributorUser of contributorUsers) {
          if (normalizedContributorLogins.has(normalizeGitHubLogin(contributorUser.githubLogin))) {
            notificationRecipients.add(contributorUser.id);
          }
        }
      }
      if (repliedToAuthorId) notificationRecipients.add(repliedToAuthorId);
      notificationRecipients.delete(author.id);
      if (notificationRecipients.size > 0) {
        await tx.notification.createMany({
          data: [...notificationRecipients].map((userId) => ({
            userId,
            kind: "review-comment-created",
            subjectType: "reviewComment",
            subjectId: comment.id,
            payloadJson: canonicalJson({
              reviewSlug: slug,
              reviewVersionId,
              documentPath: passageAnchor?.documentPath,
              parentId,
            }),
          })),
        });
      }
      await tx.auditEvent.create({
        data: {
          actorId: author.id,
          action: "comment.created",
          subjectType: "reviewComment",
          subjectId: comment.id,
          detailsJson: canonicalJson({
            reviewSlug: slug,
            kind: input.kind,
            parentId,
            claimId,
            targetDocumentPath: passageAnchor?.documentPath,
            targetSelectorHash,
          }),
        },
      });
      return { id: comment.id };
    });
  } catch (error) {
    if (error instanceof CommentError) throw error;
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (["P1008", "P2028", "P2034"].includes(code ?? "")) {
      throw new CommentError(
        "Review lifecycle changed while the comment was being posted.",
        "conflict",
      );
    }
    throw error;
  }
}

/** Remove a comment. Allowed for its author or an editor; the row is kept. */
export async function removeReviewComment(commentId: string, actor: SessionUser): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const comment = await tx.reviewComment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, status: true, review: { select: { slug: true } } },
    });
    if (!comment) throw new CommentError("Comment not found.", "not-found");
    if (comment.authorId !== actor.id && !isEditor(actor)) {
      throw new CommentError("Only the author or an editor can remove a comment.", "forbidden");
    }
    if (comment.status === "removed") return;

    const changed = await tx.reviewComment.updateMany({
      where: { id: comment.id, status: "visible" },
      data: { status: "removed", removedById: actor.id, removedAt: new Date() },
    });
    // A concurrent remover already committed the one attributable transition.
    if (changed.count !== 1) return;

    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "comment.removed",
        subjectType: "reviewComment",
        subjectId: comment.id,
        detailsJson: JSON.stringify({
          reviewSlug: comment.review.slug,
          removedBy: comment.authorId === actor.id ? "author" : "editor",
        }),
      },
    });
  });
}
