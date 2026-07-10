import {
  type AssessmentReviewStatus,
  type ClaimEvidenceRelationType,
} from "@oratlas/contracts";

/**
 * Denormalized, framework-free views the knowledge layer operates on. The web
 * app maps Prisma rows into these; tests construct them directly. This keeps
 * the search/discussion/link logic free of any database dependency.
 */

export interface IndexedReview {
  reviewSlug: string;
  reviewId: string;
  reviewVersionId: string;
  title: string;
  abstract?: string;
  keywords: string[];
  domains: string[];
  reviewType?: string;
  authors: string[];
  acceptedAt?: string;
  updatedAt?: string;
  publicationYear?: number;
  commitSha?: string;
  versionDoi?: string;
  conceptDoi?: string;
  hasDoi: boolean;
  hasTrustData: boolean;
  hasEvidenceData: boolean;
  hasHumanReviewedTrust: boolean;
  compatibilityLevel?: string;
  status: string;
}

export interface IndexedCitation {
  citationId: string;
  doi?: string;
  title?: string;
  year?: number;
  source?: string;
}

export interface IndexedTrust {
  reviewStatus: AssessmentReviewStatus;
  aggregateScore?: number;
  aggregateMethod?: string;
  notableCriteria: string[];
}

export interface IndexedRelation {
  citationId: string;
  relationType: ClaimEvidenceRelationType;
  trust?: IndexedTrust;
}

export interface IndexedClaim {
  claimId: string;
  reviewSlug: string;
  reviewId: string;
  reviewVersionId: string;
  reviewTitle: string;
  text: string;
  section?: string;
  anchor?: string;
  claimType?: string;
  commitSha?: string;
  versionDoi?: string;
  relations: IndexedRelation[];
}

export interface KnowledgeIndexData {
  reviews: IndexedReview[];
  claims: IndexedClaim[];
  citations: IndexedCitation[];
}
