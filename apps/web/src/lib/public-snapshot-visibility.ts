import "server-only";
import { type Prisma } from "@oratlas/db";

/**
 * Repository-derived content is public only while at least one published
 * review exposes the exact backing snapshot. Withdrawn versions remain
 * readable lifecycle records; tombstoned and unknown states fail closed.
 */
export const readablePublishedSnapshotWhere = {
  reviewVersions: {
    some: {
      publicState: { in: ["published", "withdrawn"] },
      review: { is: { status: "published" } },
    },
  },
} satisfies Prisma.RepositorySnapshotWhereInput;

/**
 * A node-only acceptance has no ReviewVersion by design, so its exact
 * materialized KnowledgeNodeVersion carries publication authority through the
 * accepted source submission instead. Review-backed submissions must use the
 * snapshot branch above and therefore cannot bypass a later tombstone.
 */
export const readablePublicNodeVersionWhere = {
  OR: [
    { snapshot: readablePublishedSnapshotWhere },
    {
      sourceSubmission: {
        is: { status: "accepted", resultingReviewVersionId: null },
      },
    },
  ],
} satisfies Prisma.KnowledgeNodeVersionWhereInput;

const readablePublishedReviewVersionWhere = {
  publicState: { in: ["published", "withdrawn"] },
  review: { is: { status: "published" } },
} satisfies Prisma.ReviewVersionWhereInput;

/**
 * Canonical graph records may be repository-backed or exact relational source
 * records. Every branch independently proves public visibility; absent or
 * mismatched source bindings fail closed.
 */
export const readableCanonicalNodeVersionWhere = {
  OR: [
    ...readablePublicNodeVersionWhere.OR,
    { sourceReviewVersion: { is: readablePublishedReviewVersionWhere } },
    { sourceClaim: { is: { reviewVersion: { is: readablePublishedReviewVersionWhere } } } },
    { sourceCitation: { is: { reviewVersion: { is: readablePublishedReviewVersionWhere } } } },
  ],
} satisfies Prisma.KnowledgeNodeVersionWhereInput;
