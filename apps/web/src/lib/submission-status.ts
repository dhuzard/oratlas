import "server-only";
import { prisma } from "./db";
import { isReadablePublicState } from "./review-lifecycle";

/** Submitter-only status projection; editorial notes and inspection capabilities stay private. */
export async function getOwnedSubmissionStatus(id: string, submitterId: string) {
  const submission = await prisma.submission.findFirst({
    where: { id, submitterId },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      sourceKind: true,
      releaseTag: true,
      snapshot: { select: { commitSha: true } },
      resultingReviewVersion: {
        select: { id: true, publicState: true, review: { select: { slug: true, status: true } } },
      },
    },
  });
  if (!submission) return null;
  const version = submission.resultingReviewVersion;
  return {
    id: submission.id,
    status: submission.status,
    submittedAt: submission.submittedAt?.toISOString(),
    sourceKind: submission.sourceKind,
    releaseTag: submission.releaseTag,
    commitSha: submission.snapshot?.commitSha,
    publicReviewHref:
      version && version.review.status === "published" && isReadablePublicState(version.publicState)
        ? `/reviews/${encodeURIComponent(version.review.slug)}/versions/${encodeURIComponent(version.id)}`
        : undefined,
  };
}
