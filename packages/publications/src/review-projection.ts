import {
  PUBLICATION_BOUNDARY_SCHEMA_VERSION,
  publicationRecordSchema,
  type PublicationRecord,
  type PublicationType,
  type ReviewType,
} from "@oratlas/contracts";
import { publicationStableKey } from "./identity.js";

/**
 * Legacy review storage → generic publication projection.
 *
 * `Review` and `ReviewVersion` remain the authoritative store for everything
 * ORAtlas ingests from a GitHub repository. This module does not migrate them,
 * rename them, or write anything: it derives the generic publication identity
 * an existing review projects into, so a review and an independently hosted
 * article are addressable through one boundary.
 *
 * Deliberately partial. A `PublicationVersion` requires an exact
 * `sourcesSha256` over the publication's document set and an adapter binding,
 * and legacy review versions have neither. Projecting review *versions* needs
 * an `atlas-review` adapter variant with a defined version digest, which is
 * out of scope here; see `docs/external-publications.md`.
 */

/**
 * Exhaustive map from review type to publication type. Written as a total
 * record so that adding a review type upstream fails typecheck here rather
 * than silently defaulting a new scholarly kind to `review-article`.
 */
const PUBLICATION_TYPE_BY_REVIEW_TYPE: Record<ReviewType, PublicationType> = {
  "ai-synthesis": "review-article",
  "computational-literature-review": "review-article",
  "systematic-review": "review-article",
  "scoping-review": "review-article",
  "narrative-review": "review-article",
  "meta-analysis": "review-article",
  other: "other",
  "data-release": "other",
};

/**
 * A review with no declared type is still a review: `Review` records exist
 * only for reviews, so `review-article` is a fact about the store, not a guess
 * about the content.
 */
export function publicationTypeForReviewType(reviewType: ReviewType | null): PublicationType {
  if (reviewType === null) return "review-article";
  return PUBLICATION_TYPE_BY_REVIEW_TYPE[reviewType];
}

export interface ReviewProjectionInput {
  reviewId: string;
  reviewType: ReviewType | null;
}

/** Derive the generic publication identity one existing review projects into. */
export function projectReviewAsPublication(input: ReviewProjectionInput): PublicationRecord {
  const identityEvidence = { basis: "atlas-review" as const, reviewId: input.reviewId };
  return publicationRecordSchema.parse({
    schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
    stableKey: publicationStableKey(identityEvidence),
    publicationType: publicationTypeForReviewType(input.reviewType),
    recordSource: "atlas-review-projection",
    identityEvidence,
    reviewId: input.reviewId,
  });
}
