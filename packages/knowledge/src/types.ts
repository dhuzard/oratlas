import {
  type AssessmentReviewStatus,
  type CanonicalWorkAlias,
  type ClaimEvidenceRelationType,
  type TrustVerificationState,
  type WorkIdentityAssertion,
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
  commitSha: string;
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
  localCitationId: string;
  reviewVersionId: string;
  workId: string;
  canonicalWorkAliases: CanonicalWorkAlias[];
  doi?: string;
  pmid?: string;
  openAlexId?: string;
  title?: string;
  year?: number;
  source?: string;
}

export interface IndexedTrust {
  assessmentId: string;
  protocolVersion: string;
  assessorType: string;
  assessorId?: string;
  assessedAt?: string;
  reviewStatus: AssessmentReviewStatus;
  verificationState: TrustVerificationState;
  aggregateScore?: number;
  aggregateMethod?: string;
  notableCriteria: string[];
}

export interface IndexedRelation {
  citationId: string;
  relationType: ClaimEvidenceRelationType;
  /** Legacy in-memory fixtures; new database indexes use trustAssessments. */
  trust?: IndexedTrust;
  trustAssessments?: IndexedTrust[];
}

export interface IndexedClaim {
  claimId: string;
  localClaimId: string;
  reviewSlug: string;
  reviewId: string;
  reviewVersionId: string;
  reviewTitle: string;
  text: string;
  section?: string;
  /** Atlas-owned durable DOM anchor. */
  anchor: string;
  /** Repository-provided anchor retained only as untrusted metadata. */
  sourceAnchor?: string;
  claimType?: string;
  commitSha: string;
  versionDoi?: string;
  relations: IndexedRelation[];
}

export interface IndexedNode {
  nodeId: string;
  localNodeId: string;
  kind: string;
  title: string;
  abstract?: string;
  repositoryOwner: string;
  repositoryName: string;
}

export interface KnowledgeIndexData {
  reviews: IndexedReview[];
  claims: IndexedClaim[];
  citations: IndexedCitation[];
  identifierConflicts: WorkIdentityAssertion[];
  /** Public, strictly validated node versions. Omitted by legacy review-only callers. */
  nodes?: IndexedNode[];
}
