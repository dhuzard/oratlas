import {
  canonicalJson,
  type PublicChallenge,
  type ConflictOfInterestSnapshot,
  type PublicTrustAdjudication,
  type SourceAssessmentDocument,
  type TrustCriterion,
  type TrustCriterionAssessment,
  type TrustVerificationState,
  type TrustDisagreementReport,
} from "@oratlas/contracts";
import type { VersionExportInput } from "./types.js";

export interface ScholarlyTrustAssessmentInput {
  id: string;
  url: string;
  relation: {
    id: string;
    claim: { localId: string; url: string };
    citation: { localId: string; title?: string };
    relationType: string;
  };
  protocolVersion: string;
  assessor: { type: string; identifier?: string };
  assessedAt?: string;
  conflictOfInterest: ConflictOfInterestSnapshot;
  criteria: Partial<Record<TrustCriterion, TrustCriterionAssessment>>;
  limitations: string[];
  evidence?: Record<string, unknown>;
  verification: {
    state: TrustVerificationState;
    effectiveReviewStatus: string;
    sourceAssertion?: {
      reviewStatus?: string;
      assessorType?: string;
      assessorId?: string;
      assessedAt?: string;
      relationHumanReviewed?: boolean;
    };
    platformAssertion?: { status: string; reviewerLogin: string; reviewedAt: string };
  };
  supersedesAssessmentId?: string;
}

export interface ScholarlyTrustDisagreementInput {
  id: string;
  url: string;
  relationId: string;
  protocolVersion: string;
  assessmentIds: string[];
  report: TrustDisagreementReport;
  current: boolean;
  open: boolean;
}

export interface ScholarlyTrustAdjudicationInput extends PublicTrustAdjudication {
  url: string;
}

export interface ScholarlySourceDocumentInput extends SourceAssessmentDocument {
  downloadUrl?: string;
}

export interface ScholarlyJsonInput {
  version: VersionExportInput;
  assessments: ScholarlyTrustAssessmentInput[];
  disagreements: ScholarlyTrustDisagreementInput[];
  adjudications: ScholarlyTrustAdjudicationInput[];
  challenges: PublicChallenge[];
  sourceDocuments: ScholarlySourceDocumentInput[];
}

export interface ScholarlyJsonDocument {
  schemaVersion: "1.1.0";
  platformVersion: string;
  review: {
    id: string;
    slug: string;
    versionId: string;
    title: string;
    repositoryUrl: string;
    commitSha: string;
    treeSha?: string;
  };
  assessments: ScholarlyTrustAssessmentInput[];
  disagreements: ScholarlyTrustDisagreementInput[];
  adjudications: ScholarlyTrustAdjudicationInput[];
  challenges: ReturnType<typeof publicChallenge>[];
  sourceDocuments: ScholarlySourceDocumentInput[];
}

function publicChallenge(challenge: PublicChallenge, canonicalVersionUrl: string) {
  const subjectUrl = new URL(challenge.subjectHref, canonicalVersionUrl).href;
  return {
    id: challenge.id,
    url: `${canonicalVersionUrl}#challenge-${encodeURIComponent(challenge.id)}`,
    containerType: challenge.containerType,
    reviewVersionId: challenge.reviewVersionId,
    nodeEdgeProposalId: challenge.nodeEdgeProposalId,
    subject: {
      type: challenge.subjectType,
      label: challenge.subjectLabel,
      url: subjectUrl,
      canonicalHash: challenge.canonicalSubjectHash,
    },
    filedContentHash: challenge.filedContentHash,
    grounds: challenge.grounds,
    body: challenge.body,
    contentStatus: challenge.contentStatus,
    contentRevision: challenge.contentRevision,
    status: challenge.status,
    revision: challenge.revision,
    challenger: {
      githubLogin: challenge.challenger.githubLogin,
      displayName: challenge.challenger.displayName,
    },
    transitions: challenge.transitions.map((transition) => ({
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      actor: { githubLogin: transition.actor.githubLogin },
      conflictOfInterest: transition.conflictOfInterest,
      ...(transition.administratorOverride
        ? { administratorOverride: transition.administratorOverride }
        : {}),
      revision: transition.revision,
      createdAt: transition.createdAt,
    })),
    response: challenge.response
      ? {
          id: challenge.response.id,
          body: challenge.response.body,
          contentHash: challenge.response.contentHash,
          contentStatus: challenge.response.contentStatus,
          contentRevision: challenge.response.contentRevision,
          responder: challenge.response.responder,
          createdAt: challenge.response.createdAt,
        }
      : null,
    createdAt: challenge.createdAt,
  };
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareAssessments(
  left: ScholarlyTrustAssessmentInput,
  right: ScholarlyTrustAssessmentInput,
): number {
  const time = compareCodeUnits(left.assessedAt ?? "", right.assessedAt ?? "");
  if (time !== 0) return time;
  const type = compareCodeUnits(left.assessor.type, right.assessor.type);
  if (type !== 0) return type;
  const assessor = compareCodeUnits(
    left.assessor.identifier ?? "",
    right.assessor.identifier ?? "",
  );
  if (assessor !== 0) return assessor;
  const protocol = compareCodeUnits(left.protocolVersion, right.protocolVersion);
  if (protocol !== 0) return protocol;
  return compareCodeUnits(left.id, right.id);
}

/** Build the complete public, per-record scholarly projection with deterministic ordering. */
export function scholarlyJsonDocument(input: ScholarlyJsonInput): ScholarlyJsonDocument {
  return {
    schemaVersion: "1.1.0",
    platformVersion: input.version.platformVersion,
    review: {
      id: input.version.canonicalUrl,
      slug: input.version.slug,
      versionId: input.version.versionId,
      title: input.version.title,
      repositoryUrl: input.version.repositoryUrl,
      commitSha: input.version.commitSha,
      treeSha: input.version.treeSha,
    },
    assessments: [...input.assessments].sort(compareAssessments),
    disagreements: [...input.disagreements].sort((left, right) =>
      compareCodeUnits(left.id, right.id),
    ),
    adjudications: [...input.adjudications].sort((left, right) =>
      compareCodeUnits(left.id, right.id),
    ),
    challenges: [...input.challenges]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((challenge) => publicChallenge(challenge, input.version.canonicalUrl)),
    sourceDocuments: [...input.sourceDocuments].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
}

/** Canonical JSON makes byte-for-byte regeneration independent of database row order. */
export function scholarlyJson(input: ScholarlyJsonInput): string {
  return `${canonicalJson(scholarlyJsonDocument(input))}\n`;
}
