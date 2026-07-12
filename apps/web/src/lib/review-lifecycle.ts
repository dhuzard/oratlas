import "server-only";
import {
  isExactCommitSha,
  type PublicLifecycleEvent,
  type ReviewLifecycleKind,
  type ReviewLifecycleMutation,
  type ReviewVersionPublicState,
} from "@oratlas/contracts";
import { prisma } from "./db";

export class LifecycleError extends Error {
  constructor(
    message: string,
    public readonly code: "not-found" | "bad-request" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "LifecycleError";
  }
}

export interface ReviewLifecycleView {
  revision: number;
  events: PublicLifecycleEvent[];
}

export function isTombstonedState(state: string): boolean {
  // Unknown states are withheld rather than accidentally disclosed.
  return state !== "published" && state !== "withdrawn";
}

export function isReadablePublicState(
  state: string,
): state is Exclude<ReviewVersionPublicState, "tombstoned"> {
  return state === "published" || state === "withdrawn";
}

export function lifecycleEventDto(event: {
  id: string;
  kind: string;
  reviewVersionId: string;
  supersedesVersionId: string | null;
  reason: string;
  revision: number;
  createdAt: Date;
  actor: { githubLogin: string };
}): PublicLifecycleEvent {
  return {
    id: event.id,
    kind: event.kind as ReviewLifecycleKind,
    reviewVersionId: event.reviewVersionId,
    supersedesVersionId: event.supersedesVersionId ?? undefined,
    reason: event.reason,
    actorLogin: event.actor.githubLogin,
    revision: event.revision,
    createdAt: event.createdAt.toISOString(),
  };
}

export async function getReviewLifecycle(slug: string): Promise<ReviewLifecycleView | null> {
  const review = await prisma.review.findUnique({
    where: { slug },
    select: {
      lifecycleRevision: true,
      lifecycleEvents: { include: { actor: true }, orderBy: { revision: "asc" } },
    },
  });
  if (!review) return null;
  return {
    revision: review.lifecycleRevision,
    events: review.lifecycleEvents.map(lifecycleEventDto),
  };
}

/**
 * Append one attributable lifecycle event using review-scoped optimistic
 * concurrency. Same-review constraints, state update, event and audit record
 * are committed atomically.
 */
export async function recordReviewLifecycleEvent(
  input: ReviewLifecycleMutation,
  actorId: string,
): Promise<{ event: PublicLifecycleEvent; revision: number }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({
        where: { slug: input.reviewSlug },
        select: {
          id: true,
          status: true,
          currentSnapshotId: true,
          lifecycleRevision: true,
          versions: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              snapshotId: true,
              publicState: true,
              publishedAt: true,
              createdAt: true,
              snapshot: { select: { commitSha: true } },
            },
          },
        },
      });
      if (!review) throw new LifecycleError("Review not found.", "not-found");
      if (review.status !== "published") {
        throw new LifecycleError("Lifecycle events require a published review.", "bad-request");
      }
      if (review.lifecycleRevision !== input.expectedRevision) {
        throw new LifecycleError(
          `Lifecycle changed; reload and retry at revision ${review.lifecycleRevision}.`,
          "conflict",
        );
      }
      const target = review.versions.find((version) => version.id === input.reviewVersionId);
      if (!target) {
        throw new LifecycleError("Target version does not belong to this review.", "bad-request");
      }
      if (!target.publishedAt || target.publicState !== "published") {
        throw new LifecycleError(
          "Lifecycle events require a currently published target version.",
          "bad-request",
        );
      }
      if (!isExactCommitSha(target.snapshot.commitSha)) {
        throw new LifecycleError("Target version is not bound to an exact commit.", "bad-request");
      }
      if (input.kind === "correction") {
        const current = review.versions[0];
        if (
          !current ||
          current.id !== target.id ||
          !review.currentSnapshotId ||
          target.snapshotId !== review.currentSnapshotId
        ) {
          throw new LifecycleError(
            "A correction must target the current published version.",
            "bad-request",
          );
        }
        const superseded = review.versions.find(
          (version) => version.id === input.supersedesVersionId,
        );
        if (!superseded) {
          throw new LifecycleError(
            "The superseded version must belong to the same review.",
            "bad-request",
          );
        }
        if (!isExactCommitSha(superseded.snapshot.commitSha)) {
          throw new LifecycleError("Superseded version lacks an exact commit.", "bad-request");
        }
        if (
          !superseded.publishedAt ||
          !isReadablePublicState(superseded.publicState) ||
          superseded.createdAt.getTime() >= target.createdAt.getTime()
        ) {
          throw new LifecycleError(
            "A correction must supersede a readable, chronologically prior version.",
            "bad-request",
          );
        }
      }

      const nextRevision = review.lifecycleRevision + 1;
      const claimed = await tx.review.updateMany({
        where: {
          id: review.id,
          lifecycleRevision: input.expectedRevision,
          currentSnapshotId: review.currentSnapshotId,
        },
        data: { lifecycleRevision: nextRevision },
      });
      if (claimed.count !== 1) {
        throw new LifecycleError("Lifecycle changed concurrently; reload and retry.", "conflict");
      }

      if (input.kind === "withdrawal" || input.kind === "tombstone") {
        await tx.reviewVersion.update({
          where: { id: target.id },
          data: { publicState: input.kind === "withdrawal" ? "withdrawn" : "tombstoned" },
        });
      }

      const event = await tx.reviewLifecycleEvent.create({
        data: {
          reviewId: review.id,
          reviewVersionId: target.id,
          actorId,
          kind: input.kind,
          reason: input.reason,
          supersedesVersionId: input.kind === "correction" ? input.supersedesVersionId : undefined,
          revision: nextRevision,
        },
        include: { actor: true },
      });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: `review.${input.kind}`,
          subjectType: "reviewVersion",
          subjectId: target.id,
          idempotencyKey: `review-lifecycle:${review.id}:${nextRevision}`,
          detailsJson: JSON.stringify({
            reviewSlug: input.reviewSlug,
            reviewVersionId: target.id,
            supersedesVersionId: event.supersedesVersionId,
            reason: input.reason,
            lifecycleRevision: nextRevision,
          }),
        },
      });
      return { event: lifecycleEventDto(event), revision: nextRevision };
    });
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (["P1008", "P2002", "P2028", "P2034"].includes(code ?? "")) {
      throw new LifecycleError("Lifecycle changed concurrently; reload and retry.", "conflict");
    }
    throw error;
  }
}
