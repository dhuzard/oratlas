import "server-only";
import {
  canonicalJson,
  trustCriterionAssessmentSchema,
  TRUST_CRITERIA,
  type ChallengeSubjectInput,
} from "@oratlas/contracts";
import { createReviewedTrustSubject, trustSubjectInputFromDatabaseRows } from "@oratlas/trust";
import { assertExactTrustAdjudicationValid } from "./trust-adjudication";
import { sha256 } from "./hash";
import { ChallengeError, type Db, type ResolvedSubject } from "./challenge-contract";
import { adjudicationChallengeBinding } from "./challenge-ledger";

function resolved(
  value: Omit<ResolvedSubject, "refJson" | "hash">,
  canonical: unknown,
): ResolvedSubject {
  const refJson = canonicalJson(canonical);
  return { ...value, refJson, hash: sha256(refJson) };
}

function exactClaimSubject(claim: {
  id: string;
  reviewVersionId: string;
  localClaimId: string;
  text: string;
  normalizedText: string;
  section: string | null;
  anchor: string | null;
  claimType: string | null;
  qualification: string | null;
  scopeJson: string | null;
}) {
  return {
    id: claim.id,
    reviewVersionId: claim.reviewVersionId,
    localClaimId: claim.localClaimId,
    text: claim.text,
    normalizedText: claim.normalizedText,
    section: claim.section,
    anchor: claim.anchor,
    claimType: claim.claimType,
    qualification: claim.qualification,
    scopeJson: claim.scopeJson,
  };
}

function exactCitationSubject(citation: {
  id: string;
  reviewVersionId: string;
  localCitationId: string;
  doi: string | null;
  pmid: string | null;
  openAlexId: string | null;
  title: string | null;
  authorsJson: string;
  year: number | null;
  source: string | null;
  url: string | null;
  datasetIdsJson: string;
  derivedFromJson: string;
  rawCitationJson: string | null;
}) {
  return {
    id: citation.id,
    reviewVersionId: citation.reviewVersionId,
    localCitationId: citation.localCitationId,
    doi: citation.doi,
    pmid: citation.pmid,
    openAlexId: citation.openAlexId,
    title: citation.title,
    authorsJson: citation.authorsJson,
    year: citation.year,
    source: citation.source,
    url: citation.url,
    datasetIdsJson: citation.datasetIdsJson,
    derivedFromJson: citation.derivedFromJson,
    rawCitationJson: citation.rawCitationJson,
  };
}

function exactRelationSubject(relation: {
  id: string;
  claimId: string;
  citationId: string;
  relationType: string;
  supportDirection: string | null;
  sourceLocation: string | null;
  extractionMethod: string | null;
  extractionConfidence: number | null;
  humanReviewed: boolean;
  claim: Parameters<typeof exactClaimSubject>[0];
  citation: Parameters<typeof exactCitationSubject>[0];
}) {
  if (relation.claim.reviewVersionId !== relation.citation.reviewVersionId) {
    throw new ChallengeError("Challenge relation endpoints cross review versions.", "conflict");
  }
  return {
    reviewVersionId: relation.claim.reviewVersionId,
    id: relation.id,
    claimId: relation.claimId,
    citationId: relation.citationId,
    relationType: relation.relationType,
    supportDirection: relation.supportDirection,
    sourceLocation: relation.sourceLocation,
    extractionMethod: relation.extractionMethod,
    extractionConfidence: relation.extractionConfidence,
    humanReviewed: relation.humanReviewed,
    claim: exactClaimSubject(relation.claim),
    citation: exactCitationSubject(relation.citation),
  };
}

/** Resolve only through exact foreign keys and include immutable target bytes in the digest. */
export async function resolveChallengeSubject(
  db: Db,
  reviewVersionId: string | null,
  subject: ChallengeSubjectInput,
  nodeEdgeProposalId: string | null = null,
): Promise<ResolvedSubject> {
  if (subject.type !== "adjudication" && (!reviewVersionId || nodeEdgeProposalId)) {
    throw new ChallengeError("This challenge subject requires a review-version container.");
  }
  if (subject.type === "claim") {
    const claim = await db.claim.findUnique({ where: { id: subject.claimId } });
    if (!claim || claim.reviewVersionId !== reviewVersionId)
      throw new ChallengeError("Challenge claim subject not found.", "not-found");
    return resolved(
      {
        type: subject.type,
        reviewVersionId,
        nodeEdgeProposalId: null,
        claimId: claim.id,
        label: `Claim ${claim.localClaimId}`,
        hrefFragment: `claim-subject-${claim.id}`,
      },
      {
        schema: "oratlas/challenge-subject/2",
        type: subject.type,
        claim: exactClaimSubject(claim),
      },
    );
  }
  if (subject.type === "relation") {
    const relation = await db.claimEvidenceRelation.findUnique({
      where: { id: subject.relationId },
      include: { claim: true, citation: true },
    });
    if (
      !relation ||
      relation.claim.reviewVersionId !== reviewVersionId ||
      relation.citation.reviewVersionId !== reviewVersionId
    )
      throw new ChallengeError("Challenge relation subject not found.", "not-found");
    return resolved(
      {
        type: subject.type,
        reviewVersionId,
        nodeEdgeProposalId: null,
        relationId: relation.id,
        label: `Relation ${relation.claim.localClaimId} → ${relation.citation.localCitationId}`,
        hrefFragment: `relation-subject-${relation.id}`,
      },
      {
        schema: "oratlas/challenge-subject/2",
        type: subject.type,
        relation: exactRelationSubject(relation),
      },
    );
  }

  if (subject.type === "adjudication") {
    const adjudication = await db.trustAdjudication.findUnique({
      where: { id: subject.adjudicationId },
      include: {
        references: { orderBy: { position: "asc" } },
        claimEvidenceRelation: { include: { claim: true, citation: true } },
        nodeEdgeProposal: {
          include: {
            sourceNodeVersion: { select: { knowledgeNodeId: true } },
            targetNode: { select: { id: true } },
          },
        },
      },
    });
    const reviewMatch = Boolean(
      reviewVersionId &&
      !nodeEdgeProposalId &&
      adjudication?.subjectType === "claim-citation" &&
      adjudication.claimEvidenceRelation?.claim.reviewVersionId === reviewVersionId &&
      adjudication.claimEvidenceRelation.citation.reviewVersionId === reviewVersionId,
    );
    const nodeMatch = Boolean(
      !reviewVersionId &&
      nodeEdgeProposalId &&
      adjudication?.subjectType === "node-relation" &&
      adjudication.nodeEdgeProposalId === nodeEdgeProposalId &&
      adjudication.nodeEdgeProposal,
    );
    if (!adjudication || (!reviewMatch && !nodeMatch)) {
      throw new ChallengeError("Challenge adjudication subject not found.", "not-found");
    }
    try {
      await assertExactTrustAdjudicationValid(db, adjudication.id);
    } catch {
      throw new ChallengeError("Challenge adjudication integrity check failed.", "conflict");
    }
    return {
      type: subject.type,
      reviewVersionId,
      nodeEdgeProposalId,
      adjudicationId: adjudication.id,
      label: `Adjudication ${adjudication.id}`,
      hrefFragment: `adjudication-${adjudication.id}`,
      ...adjudicationChallengeBinding(adjudication),
    };
  }

  if (!TRUST_CRITERIA.includes(subject.criterion as (typeof TRUST_CRITERIA)[number])) {
    throw new ChallengeError("Unknown TRUST criterion.");
  }
  const assessment = await db.trustAssessment.findUnique({
    where: { id: subject.assessmentId },
    include: {
      relation: {
        include: {
          claim: true,
          citation: true,
        },
      },
    },
  });
  if (
    !assessment ||
    assessment.relation.claim.reviewVersionId !== reviewVersionId ||
    assessment.relation.citation.reviewVersionId !== reviewVersionId
  )
    throw new ChallengeError("Challenge assessment subject not found.", "not-found");
  const criterionValue = assessment[subject.criterion as keyof typeof assessment];
  if (typeof criterionValue !== "string") {
    throw new ChallengeError("Challenge assessment criterion is not persisted.", "not-found");
  }
  let parsedCriterion: unknown;
  try {
    parsedCriterion = JSON.parse(criterionValue);
  } catch {
    throw new ChallengeError("Challenge assessment criterion is invalid.", "conflict");
  }
  const validCriterion = trustCriterionAssessmentSchema.safeParse(parsedCriterion);
  if (!validCriterion.success) {
    throw new ChallengeError("Challenge assessment criterion is invalid.", "conflict");
  }
  const trustSubject = trustSubjectInputFromDatabaseRows({
    assessment,
    relation: assessment.relation,
    claim: assessment.relation.claim,
    citation: assessment.relation.citation,
  });
  return resolved(
    {
      type: subject.type,
      reviewVersionId,
      nodeEdgeProposalId: null,
      assessmentId: assessment.id,
      criterion: subject.criterion,
      label: `Assessment ${assessment.id} · ${subject.criterion}`,
      hrefFragment: `assessment-subject-${assessment.id}-${subject.criterion}`,
    },
    {
      schema: "oratlas/challenge-subject/2",
      type: subject.type,
      reviewVersionId,
      relation: exactRelationSubject(assessment.relation),
      trustSubject: createReviewedTrustSubject(trustSubject),
      criterion: { name: subject.criterion, value: validCriterion.data },
    },
  );
}

export function rowSubject(row: {
  subjectType: string;
  claimId: string | null;
  claimEvidenceRelationId: string | null;
  trustAssessmentId: string | null;
  trustAdjudicationId: string | null;
  criterion: string | null;
}): ChallengeSubjectInput | null {
  if (row.subjectType === "claim" && row.claimId) return { type: "claim", claimId: row.claimId };
  if (row.subjectType === "relation" && row.claimEvidenceRelationId)
    return { type: "relation", relationId: row.claimEvidenceRelationId };
  if (row.subjectType === "assessment-criterion" && row.trustAssessmentId && row.criterion) {
    return {
      type: "assessment-criterion",
      assessmentId: row.trustAssessmentId,
      criterion: row.criterion,
    };
  }
  if (row.subjectType === "adjudication" && row.trustAdjudicationId) {
    return { type: "adjudication", adjudicationId: row.trustAdjudicationId };
  }
  return null;
}

export async function assertChallengeSubjectIntegrity(
  db: Db,
  row: Parameters<typeof rowSubject>[0] & {
    reviewVersionId: string | null;
    nodeEdgeProposalId: string | null;
    canonicalSubjectHash: string;
    subjectRefJson: string;
  },
): Promise<void> {
  const input = rowSubject(row);
  if (!input) throw new ChallengeError("Challenge subject binding is invalid.", "conflict");
  const current = await resolveChallengeSubject(
    db,
    row.reviewVersionId,
    input,
    row.nodeEdgeProposalId,
  );
  if (current.hash !== row.canonicalSubjectHash || current.refJson !== row.subjectRefJson) {
    throw new ChallengeError("Challenge subject integrity check failed.", "conflict");
  }
}
