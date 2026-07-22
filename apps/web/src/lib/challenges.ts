import "server-only";
import {
  canonicalJson,
  challengeContentStatusSchema,
  challengeGroundsSchema,
  challengeStatusSchema,
  conflictOfInterestStatusSchema,
  isExactCommitSha,
  isLegalChallengeTransition,
  trustCriterionAssessmentSchema,
  TRUST_CRITERIA,
  userRoleSchema,
} from "@oratlas/contracts";
import { createReviewedTrustSubject, trustSubjectInputFromDatabaseRows } from "@oratlas/trust";
import type {
  ChallengeList,
  NodeChallengeList,
  ChallengeContentStatus,
  ChallengeStatus,
  ChallengeSubjectInput,
  CreateChallengeInput,
  CreateChallengeResponseInput,
  ModerateChallengeContentInput,
  PublicChallenge,
  TransitionChallengeInput,
} from "@oratlas/contracts";
import type { Prisma } from "@oratlas/db";
import { prisma } from "./db";
import { sha256 } from "./hash";
import { isEditor, type SessionUser } from "./auth";
import { isReadablePublicState } from "./review-lifecycle";
import { readablePublicNodeVersionWhere } from "./public-snapshot-visibility";
import { assertExactTrustAdjudicationValid } from "./trust-adjudication";

export class ChallengeError extends Error {
  constructor(
    message: string,
    public readonly code:
      "not-found" | "bad-request" | "forbidden" | "conflict" | "rate-limited" = "bad-request",
  ) {
    super(message);
    this.name = "ChallengeError";
  }
}

export const MAX_ACTIVE_CHALLENGES_PER_SUBJECT = 10;
const ACTIVE_CHALLENGE_STATUSES = ["open", "author-responded"] as const;
const CHALLENGE_TRANSACTION_ATTEMPTS = 3;
export const MAX_NODE_CHALLENGE_CONTAINERS = 200;
export const MAX_NODE_CHALLENGE_PAGE_SIZE = 100;

type Db = Prisma.TransactionClient | typeof prisma;
type ResolvedSubject = {
  type: ChallengeSubjectInput["type"];
  reviewVersionId: string | null;
  nodeEdgeProposalId: string | null;
  claimId?: string;
  relationId?: string;
  assessmentId?: string;
  adjudicationId?: string;
  criterion?: string;
  refJson: string;
  hash: string;
  label: string;
  hrefFragment: string;
};

export type ChallengeSubjectOption = {
  subject: ChallengeSubjectInput;
  canonicalSubjectHash: string;
  label: string;
  nodeEdgeProposalId?: string;
  adjudication?: {
    id: string;
    outcome: string;
    disagreementHash: string;
    outcomeHash: string;
    adjudicatorGithubLogin: string;
    createdAt: string;
  };
  canonicalSubjectRefJson?: string;
};

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

function rowSubject(row: {
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

async function assertChallengeSubjectIntegrity(
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

type ChallengeContent = {
  reviewVersionId: string | null;
  nodeEdgeProposalId: string | null;
  subjectType: string;
  subjectRefJson: string;
  canonicalSubjectHash: string;
  grounds: string;
  body: string;
  challengerId: string;
};

function isPersistedCriterion(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return trustCriterionAssessmentSchema.safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
}

function hashFiledContent(row: ChallengeContent): string {
  if (row.reviewVersionId && !row.nodeEdgeProposalId) {
    // Preserve byte-for-byte E01 replay compatibility for already filed rows.
    return sha256(
      canonicalJson({
        schema: "oratlas/challenge-filed-content/1",
        reviewVersionId: row.reviewVersionId,
        subjectType: row.subjectType,
        subjectRefJson: row.subjectRefJson,
        canonicalSubjectHash: row.canonicalSubjectHash,
        grounds: row.grounds,
        body: row.body,
        challengerId: row.challengerId,
      }),
    );
  }
  return sha256(
    canonicalJson({
      schema: "oratlas/challenge-filed-content/2",
      reviewVersionId: row.reviewVersionId,
      nodeEdgeProposalId: row.nodeEdgeProposalId,
      subjectType: row.subjectType,
      subjectRefJson: row.subjectRefJson,
      canonicalSubjectHash: row.canonicalSubjectHash,
      grounds: row.grounds,
      body: row.body,
      challengerId: row.challengerId,
    }),
  );
}

type LedgerChallenge = ChallengeContent & {
  status: string;
  revision: number;
  filedContentHash: string;
  activeChallengerSubjectKey: string | null;
  transitions: Array<{
    actorId: string;
    actorRoleSnapshot: string;
    filedContentHash: string;
    fromStatus: string | null;
    toStatus: string;
    rationale: string | null;
    responseContentHash: string | null;
    conflictOfInterestStatus: string | null;
    administratorOverride: boolean;
    administratorOverrideById: string | null;
    administratorOverrideGithubLoginSnapshot: string | null;
    administratorOverrideAt: Date | null;
    revision: number;
    actor: { id: string; githubLogin: string; role: string };
  }>;
};

/** Validate the append-only ledger before projecting or advancing mutable state. */
function assertChallengeLedger(row: LedgerChallenge, expectedActiveKey: string | null): void {
  const projected = challengeStatusSchema.safeParse(row.status);
  if (!projected.success || !challengeGroundsSchema.safeParse(row.grounds).success) {
    throw new ChallengeError("Challenge projection contains invalid enums.", "conflict");
  }
  const contentHash = hashFiledContent(row);
  if (row.filedContentHash !== contentHash || row.transitions.length !== row.revision + 1) {
    throw new ChallengeError("Challenge immutable content or ledger is invalid.", "conflict");
  }
  if (row.activeChallengerSubjectKey !== expectedActiveKey) {
    throw new ChallengeError("Challenge abuse-control projection is invalid.", "conflict");
  }
  let previous: ChallengeStatus | null = null;
  for (let index = 0; index < row.transitions.length; index += 1) {
    const event = row.transitions[index]!;
    const from =
      event.fromStatus === null ? null : challengeStatusSchema.safeParse(event.fromStatus);
    const to = challengeStatusSchema.safeParse(event.toStatus);
    if (
      event.revision !== index ||
      event.filedContentHash !== contentHash ||
      !to.success ||
      (from !== null && !from.success) ||
      !event.actorId ||
      event.actor.id !== event.actorId ||
      !event.actor.githubLogin ||
      !userRoleSchema.safeParse(event.actor.role).success ||
      !userRoleSchema.safeParse(event.actorRoleSnapshot).success ||
      (event.conflictOfInterestStatus !== null &&
        !conflictOfInterestStatusSchema.safeParse(event.conflictOfInterestStatus).success)
    ) {
      throw new ChallengeError("Challenge lifecycle ledger is invalid.", "conflict");
    }
    if (index === 0) {
      if (
        event.fromStatus !== null ||
        event.toStatus !== "open" ||
        event.actorId !== row.challengerId ||
        event.rationale !== null ||
        event.responseContentHash !== null ||
        event.conflictOfInterestStatus !== null ||
        event.administratorOverride
      ) {
        throw new ChallengeError("Challenge filing event is invalid.", "conflict");
      }
    } else {
      if (event.fromStatus !== previous || !isLegalChallengeTransition(previous!, to.data)) {
        throw new ChallengeError("Challenge lifecycle transition is invalid.", "conflict");
      }
      if (
        (to.data === "resolved" || to.data === "dismissed") &&
        (!event.rationale || !["EDITOR", "ADMIN"].includes(event.actorRoleSnapshot))
      ) {
        throw new ChallengeError("Challenge editorial outcome evidence is invalid.", "conflict");
      }
      const isOutcome = to.data === "resolved" || to.data === "dismissed";
      if (!isOutcome && (event.conflictOfInterestStatus !== null || event.administratorOverride)) {
        throw new ChallengeError(
          "Challenge COI evidence is attached to a non-outcome.",
          "conflict",
        );
      }
      const overrideFields = [
        event.administratorOverrideById,
        event.administratorOverrideGithubLoginSnapshot,
        event.administratorOverrideAt,
      ];
      if (
        event.administratorOverride
          ? event.actorRoleSnapshot !== "ADMIN" ||
            event.administratorOverrideById !== event.actorId ||
            !event.administratorOverrideGithubLoginSnapshot ||
            !event.administratorOverrideAt ||
            event.conflictOfInterestStatus !== "conflict-declared"
          : overrideFields.some((value) => value !== null)
      ) {
        throw new ChallengeError(
          "Challenge administrator override evidence is invalid.",
          "conflict",
        );
      }
      if (to.data === "withdrawn" && event.actorId !== row.challengerId) {
        throw new ChallengeError("Challenge withdrawal evidence is invalid.", "conflict");
      }
      if (to.data !== "author-responded" && event.responseContentHash !== null) {
        throw new ChallengeError("Challenge response binding is invalid.", "conflict");
      }
    }
    previous = to.data;
  }
  if (previous !== projected.data || row.revision !== row.transitions.at(-1)?.revision) {
    throw new ChallengeError(
      "Challenge projection does not match its lifecycle ledger.",
      "conflict",
    );
  }
}

function activeChallengerSubjectKey(challengerId: string, canonicalSubjectHash: string): string {
  return sha256(
    canonicalJson({
      schema: "oratlas/active-challenger-subject/1",
      challengerId,
      canonicalSubjectHash,
    }),
  );
}

function isActiveChallengeStatus(status: string): boolean {
  return ACTIVE_CHALLENGE_STATUSES.includes(status as (typeof ACTIVE_CHALLENGE_STATUSES)[number]);
}

/**
 * Adopt the portable active key for the deterministic oldest active row.
 * E01 deployments may already contain duplicate active rows. They remain
 * visible and transitionable; only the oldest row owns the unique key until it
 * becomes terminal, after which the next oldest row is adopted lazily.
 */
async function reconcileActiveChallengeGroup(
  db: Db,
  challengerId: string,
  canonicalSubjectHash: string,
): Promise<string | null> {
  const winner = await db.challenge.findFirst({
    where: {
      challengerId,
      canonicalSubjectHash,
      status: { in: [...ACTIVE_CHALLENGE_STATUSES] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, activeChallengerSubjectKey: true },
  });
  if (!winner) return null;
  const expectedKey = activeChallengerSubjectKey(challengerId, canonicalSubjectHash);
  const malformed = await db.challenge.findFirst({
    where: {
      challengerId,
      canonicalSubjectHash,
      status: { in: [...ACTIVE_CHALLENGE_STATUSES] },
      activeChallengerSubjectKey: { not: null, notIn: [expectedKey] },
    },
    select: { id: true },
  });
  if (malformed) {
    throw new ChallengeError("Challenge abuse-control projection is invalid.", "conflict");
  }

  await db.challenge.updateMany({
    where: {
      id: { not: winner.id },
      activeChallengerSubjectKey: expectedKey,
    },
    data: { activeChallengerSubjectKey: null },
  });
  if (winner.activeChallengerSubjectKey === null) {
    await db.challenge.updateMany({
      where: {
        id: winner.id,
        status: { in: [...ACTIVE_CHALLENGE_STATUSES] },
        activeChallengerSubjectKey: null,
      },
      data: { activeChallengerSubjectKey: expectedKey },
    });
  }
  return winner.id;
}

function expectedActiveKeyForRow(
  row: {
    id: string;
    status: string;
    challengerId: string;
    canonicalSubjectHash: string;
  },
  winnerId: string | null,
): string | null {
  return isActiveChallengeStatus(row.status) && row.id === winnerId
    ? activeChallengerSubjectKey(row.challengerId, row.canonicalSubjectHash)
    : null;
}

function prismaErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function isExactChallengeVersion(version: {
  publicState: string;
  publishedAt: Date | null;
  snapshot: { commitSha: string } | null;
}): boolean {
  return (
    isReadablePublicState(version.publicState) &&
    Boolean(version.publishedAt) &&
    Boolean(version.snapshot && isExactCommitSha(version.snapshot.commitSha))
  );
}

function adjudicationChallengeBinding(adjudication: {
  id: string;
  disagreementHash: string;
  outcomeHash: string;
}) {
  const refJson = canonicalJson({
    schema: "oratlas/challenge-subject/2",
    type: "adjudication",
    adjudication: {
      id: adjudication.id,
      disagreementHash: adjudication.disagreementHash,
      outcomeHash: adjudication.outcomeHash,
    },
  });
  return { refJson, hash: sha256(refJson) };
}

async function publicNodeChallengeContainer(db: Db, nodeEdgeProposalId: string, nodeId?: string) {
  return db.nodeEdgeProposal.findFirst({
    where: {
      id: nodeEdgeProposalId,
      status: "confirmed",
      sourceNodeVersion: {
        ...readablePublicNodeVersionWhere,
        ...(nodeId ? { knowledgeNodeId: nodeId } : {}),
      },
      targetNodeVersion: readablePublicNodeVersionWhere,
    },
    select: {
      id: true,
      sourceNodeVersion: {
        select: {
          knowledgeNodeId: true,
          sourceSubmission: {
            select: {
              submitter: {
                select: { id: true, githubLogin: true, displayName: true },
              },
            },
          },
        },
      },
    },
  });
}

async function assertChallengeContainerReadable(
  db: Db,
  row: { reviewVersionId: string | null; nodeEdgeProposalId: string | null },
): Promise<void> {
  if (row.reviewVersionId && !row.nodeEdgeProposalId) {
    const version = await db.reviewVersion.findUnique({
      where: { id: row.reviewVersionId },
      select: {
        publicState: true,
        publishedAt: true,
        snapshot: { select: { commitSha: true } },
      },
    });
    if (version && isExactChallengeVersion(version)) return;
  } else if (!row.reviewVersionId && row.nodeEdgeProposalId) {
    if (await publicNodeChallengeContainer(db, row.nodeEdgeProposalId)) return;
  }
  throw new ChallengeError("Challenges are closed on this public container.", "forbidden");
}

function mapChallengeTransactionError(error: unknown): never {
  if (error instanceof ChallengeError) throw error;
  const code = prismaErrorCode(error);
  if (["P1008", "P2002", "P2028", "P2034"].includes(code ?? "")) {
    throw new ChallengeError(
      "Challenge lifecycle changed concurrently. Refresh and retry.",
      "conflict",
    );
  }
  throw error;
}

export async function createChallenge(
  slug: string,
  actor: SessionUser,
  input: CreateChallengeInput,
): Promise<{ id: string }> {
  const activeKey = activeChallengerSubjectKey(actor.id, input.canonicalSubjectHash);
  for (let attempt = 1; attempt <= CHALLENGE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const version = await tx.reviewVersion.findFirst({
            where: { id: input.reviewVersionId, review: { slug, status: "published" } },
            include: { snapshot: { select: { commitSha: true } } },
          });
          if (!version) throw new ChallengeError("Review version not found.", "not-found");
          if (!isExactChallengeVersion(version)) {
            throw new ChallengeError("Challenges are closed on this review version.", "forbidden");
          }
          const subject = await resolveChallengeSubject(tx, version.id, input.subject);
          if (subject.hash !== input.canonicalSubjectHash) {
            throw new ChallengeError(
              "Challenge subject changed or its canonical hash is invalid.",
              "conflict",
            );
          }
          const duplicateId = await reconcileActiveChallengeGroup(tx, actor.id, subject.hash);
          if (duplicateId) {
            throw new ChallengeError(
              "You already have an active challenge for this exact subject.",
              "conflict",
            );
          }
          const activeCount = await tx.challenge.count({
            where: {
              canonicalSubjectHash: subject.hash,
              status: { in: [...ACTIVE_CHALLENGE_STATUSES] },
            },
          });
          if (activeCount >= MAX_ACTIVE_CHALLENGES_PER_SUBJECT) {
            throw new ChallengeError(
              "This exact subject already has the maximum number of active challenges.",
              "rate-limited",
            );
          }
          const challenge = await tx.challenge.create({
            data: {
              reviewVersionId: version.id,
              subjectType: subject.type,
              claimId: subject.claimId,
              claimEvidenceRelationId: subject.relationId,
              trustAssessmentId: subject.assessmentId,
              trustAdjudicationId: subject.adjudicationId,
              criterion: subject.criterion,
              subjectRefJson: subject.refJson,
              canonicalSubjectHash: subject.hash,
              grounds: input.grounds,
              body: input.body,
              challengerId: actor.id,
              activeChallengerSubjectKey: activeKey,
              filedContentHash: hashFiledContent({
                reviewVersionId: version.id,
                nodeEdgeProposalId: null,
                subjectType: subject.type,
                subjectRefJson: subject.refJson,
                canonicalSubjectHash: subject.hash,
                grounds: input.grounds,
                body: input.body,
                challengerId: actor.id,
              }),
            },
          });
          await tx.challengeTransition.create({
            data: {
              challengeId: challenge.id,
              fromStatus: null,
              toStatus: "open",
              actorId: actor.id,
              actorRoleSnapshot: actor.role,
              filedContentHash: challenge.filedContentHash,
              revision: 0,
            },
          });
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: "challenge.filed",
              subjectType: "challenge",
              subjectId: challenge.id,
              detailsJson: canonicalJson({
                canonicalSubjectHash: subject.hash,
                filedContentHash: challenge.filedContentHash,
                grounds: input.grounds,
                reviewVersionId: version.id,
                subjectType: subject.type,
              }),
            },
          });
          return { id: challenge.id };
        },
        { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof ChallengeError) throw error;
      const code = prismaErrorCode(error);
      if (code === "P2002") {
        const duplicate = await prisma.challenge.findUnique({
          where: { activeChallengerSubjectKey: activeKey },
          select: { id: true },
        });
        if (duplicate) {
          throw new ChallengeError(
            "You already have an active challenge for this exact subject.",
            "conflict",
          );
        }
      }
      if (
        attempt < CHALLENGE_TRANSACTION_ATTEMPTS &&
        ["P1008", "P2028", "P2034"].includes(code ?? "")
      ) {
        continue;
      }
      return mapChallengeTransactionError(error);
    }
  }
  throw new ChallengeError(
    "Challenge filing could not be serialized. Refresh and retry.",
    "conflict",
  );
}

/** File against a node adjudication without inventing a ReviewVersion container. */
export async function createNodeChallenge(
  nodeId: string,
  actor: SessionUser,
  input: CreateChallengeInput,
): Promise<{ id: string }> {
  if (
    input.containerType !== "node-relation" ||
    !("nodeEdgeProposalId" in input) ||
    !input.nodeEdgeProposalId ||
    input.subject.type !== "adjudication"
  ) {
    throw new ChallengeError("A node challenge requires an exact adjudication and proposal.");
  }
  const activeKey = activeChallengerSubjectKey(actor.id, input.canonicalSubjectHash);
  for (let attempt = 1; attempt <= CHALLENGE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const container = await publicNodeChallengeContainer(
            tx,
            input.nodeEdgeProposalId,
            nodeId,
          );
          if (!container) {
            throw new ChallengeError("Public node-relation container not found.", "not-found");
          }
          const subject = await resolveChallengeSubject(tx, null, input.subject, container.id);
          if (subject.hash !== input.canonicalSubjectHash) {
            throw new ChallengeError(
              "Challenge subject changed or its canonical hash is invalid.",
              "conflict",
            );
          }
          const duplicateId = await reconcileActiveChallengeGroup(tx, actor.id, subject.hash);
          if (duplicateId) {
            throw new ChallengeError(
              "You already have an active challenge for this exact subject.",
              "conflict",
            );
          }
          const activeCount = await tx.challenge.count({
            where: {
              canonicalSubjectHash: subject.hash,
              status: { in: [...ACTIVE_CHALLENGE_STATUSES] },
            },
          });
          if (activeCount >= MAX_ACTIVE_CHALLENGES_PER_SUBJECT) {
            throw new ChallengeError(
              "This exact subject already has the maximum number of active challenges.",
              "rate-limited",
            );
          }
          const filedContentHash = hashFiledContent({
            reviewVersionId: null,
            nodeEdgeProposalId: container.id,
            subjectType: subject.type,
            subjectRefJson: subject.refJson,
            canonicalSubjectHash: subject.hash,
            grounds: input.grounds,
            body: input.body,
            challengerId: actor.id,
          });
          const challenge = await tx.challenge.create({
            data: {
              reviewVersionId: null,
              nodeEdgeProposalId: container.id,
              subjectType: subject.type,
              trustAdjudicationId: subject.adjudicationId,
              subjectRefJson: subject.refJson,
              canonicalSubjectHash: subject.hash,
              grounds: input.grounds,
              body: input.body,
              challengerId: actor.id,
              activeChallengerSubjectKey: activeKey,
              filedContentHash,
            },
          });
          await tx.challengeTransition.create({
            data: {
              challengeId: challenge.id,
              fromStatus: null,
              toStatus: "open",
              actorId: actor.id,
              actorRoleSnapshot: actor.role,
              filedContentHash,
              revision: 0,
            },
          });
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: "challenge.filed",
              subjectType: "challenge",
              subjectId: challenge.id,
              detailsJson: canonicalJson({
                canonicalSubjectHash: subject.hash,
                filedContentHash,
                grounds: input.grounds,
                nodeEdgeProposalId: container.id,
                subjectType: subject.type,
              }),
            },
          });
          return { id: challenge.id };
        },
        { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof ChallengeError) throw error;
      const code = prismaErrorCode(error);
      if (code === "P2002") {
        const duplicate = await prisma.challenge.findUnique({
          where: { activeChallengerSubjectKey: activeKey },
          select: { id: true },
        });
        if (duplicate) {
          throw new ChallengeError(
            "You already have an active challenge for this exact subject.",
            "conflict",
          );
        }
      }
      if (
        attempt < CHALLENGE_TRANSACTION_ATTEMPTS &&
        ["P1008", "P2028", "P2034"].includes(code ?? "")
      ) {
        continue;
      }
      return mapChallengeTransactionError(error);
    }
  }
  throw new ChallengeError(
    "Challenge filing could not be serialized. Refresh and retry.",
    "conflict",
  );
}

export async function listNodeChallengeSubjectOptions(
  nodeId: string,
): Promise<ChallengeSubjectOption[]> {
  const adjudications = await prisma.trustAdjudication.findMany({
    where: {
      subjectType: "node-relation",
      nodeEdgeProposal: {
        status: "confirmed",
        sourceNodeVersion: {
          ...readablePublicNodeVersionWhere,
          knowledgeNodeId: nodeId,
        },
        targetNodeVersion: readablePublicNodeVersionWhere,
      },
    },
    orderBy: { id: "asc" },
    take: MAX_NODE_CHALLENGE_CONTAINERS,
    select: { id: true, nodeEdgeProposalId: true },
  });
  return nodeAdjudicationOptions(adjudications);
}

async function nodeAdjudicationOptions(
  adjudications: Array<{ id: string; nodeEdgeProposalId: string | null }>,
): Promise<ChallengeSubjectOption[]> {
  const { listTrustDisagreementQueue } = await import("./trust-adjudication");
  const publicQueue = await listTrustDisagreementQueue({
    nodeEdgeProposalIds: [...new Set(adjudications.flatMap((row) => row.nodeEdgeProposalId ?? []))],
  });
  const publicById = new Map(
    publicQueue
      .flatMap((item) => item.adjudications)
      .filter((item) => item.valid)
      .map((item) => [item.id, item] as const),
  );
  return adjudications.flatMap(({ id, nodeEdgeProposalId }) => {
    if (!nodeEdgeProposalId) throw new ChallengeError("Node adjudication container is invalid.");
    const subject: ChallengeSubjectInput = { type: "adjudication", adjudicationId: id };
    const publicAdjudication = publicById.get(id);
    if (!publicAdjudication) return [];
    const binding = adjudicationChallengeBinding(publicAdjudication);
    return [
      {
        subject,
        canonicalSubjectHash: binding.hash,
        canonicalSubjectRefJson: binding.refJson,
        label: `Adjudication ${id}`,
        nodeEdgeProposalId,
        adjudication: {
          id,
          outcome: publicAdjudication.outcome,
          disagreementHash: publicAdjudication.disagreementHash,
          outcomeHash: publicAdjudication.outcomeHash,
          adjudicatorGithubLogin: publicAdjudication.adjudicator.githubLogin,
          createdAt: publicAdjudication.createdAt,
        },
      },
    ];
  });
}

export async function listChallengeSubjectOptions(
  reviewVersionId: string,
): Promise<ChallengeSubjectOption[]> {
  const version = await prisma.reviewVersion.findUnique({
    where: { id: reviewVersionId },
    select: {
      publicState: true,
      publishedAt: true,
      snapshot: { select: { commitSha: true } },
      claims: {
        orderBy: { localClaimId: "asc" },
        select: {
          id: true,
          evidenceRelations: {
            orderBy: { id: "asc" },
            select: {
              id: true,
              trustAssessments: {
                orderBy: { id: "asc" },
                select: {
                  id: true,
                  identityIntegrity: true,
                  entailment: true,
                  sourceAccess: true,
                  populationRelevance: true,
                  interventionExposureRelevance: true,
                  outcomeRelevance: true,
                  methodologicalSafeguards: true,
                  statisticalSafeguards: true,
                  replicationConvergence: true,
                  conflictDependency: true,
                },
              },
              adjudications: {
                where: { subjectType: "claim-citation" },
                orderBy: { id: "asc" },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });
  if (!version || !isExactChallengeVersion(version)) return [];
  const inputs: ChallengeSubjectInput[] = [];
  for (const claim of version.claims) {
    inputs.push({ type: "claim", claimId: claim.id });
    for (const relation of claim.evidenceRelations) {
      inputs.push({ type: "relation", relationId: relation.id });
      for (const assessment of relation.trustAssessments) {
        for (const criterion of TRUST_CRITERIA) {
          if (isPersistedCriterion(assessment[criterion])) {
            inputs.push({ type: "assessment-criterion", assessmentId: assessment.id, criterion });
          }
        }
      }
      for (const adjudication of relation.adjudications) {
        inputs.push({ type: "adjudication", adjudicationId: adjudication.id });
      }
    }
  }
  return Promise.all(
    inputs.map(async (subject) => {
      const result = await resolveChallengeSubject(prisma, reviewVersionId, subject);
      return { subject, canonicalSubjectHash: result.hash, label: result.label };
    }),
  );
}

/** Interim §5 default, deliberately isolated so governance can replace it. */
export function hasChallengeResolutionAuthority(actor: SessionUser): boolean {
  return isEditor(actor);
}

type ContributorSnapshot = {
  personId: string | null;
  nodeContributorUserId: string | null;
  githubLogin: string;
  displayName: string;
  rolesJson: string;
};

async function contributorOfRecord(
  db: Db,
  versionId: string,
  actor: SessionUser,
): Promise<ContributorSnapshot | null> {
  const login = actor.githubLogin.normalize("NFKC").toLowerCase();
  const contributors = await db.reviewContributor.findMany({
    where: { reviewVersionId: versionId, person: { githubLogin: { not: null } } },
    orderBy: [{ position: "asc" }, { personId: "asc" }],
    select: {
      personId: true,
      rolesJson: true,
      person: { select: { githubLogin: true, displayName: true } },
    },
  });
  const matched = contributors.find(
    ({ person }) => person.githubLogin?.normalize("NFKC").toLowerCase() === login,
  );
  return matched?.person.githubLogin
    ? {
        personId: matched.personId,
        nodeContributorUserId: null,
        githubLogin: matched.person.githubLogin,
        displayName: matched.person.displayName,
        rolesJson: matched.rolesJson,
      }
    : null;
}

async function nodeContributorOfRecord(
  db: Db,
  nodeEdgeProposalId: string,
  actor: SessionUser,
): Promise<ContributorSnapshot | null> {
  const proposal = await publicNodeChallengeContainer(db, nodeEdgeProposalId);
  // Match D02 recusal provenance exactly: the immutable source node
  // version's accepted submission, never the proposal's optional submission.
  const submitter = proposal?.sourceNodeVersion.sourceSubmission?.submitter;
  if (!submitter || submitter.id !== actor.id) return null;
  return {
    personId: null,
    nodeContributorUserId: submitter.id,
    githubLogin: submitter.githubLogin,
    displayName: submitter.displayName ?? submitter.githubLogin,
    rolesJson: '["node-submitter"]',
  };
}

export async function isChallengeContributorOfRecord(
  versionId: string,
  actor: SessionUser,
): Promise<boolean> {
  return Boolean(await contributorOfRecord(prisma, versionId, actor));
}

export async function transitionChallenge(
  challengeId: string,
  actor: SessionUser,
  input: TransitionChallengeInput,
): Promise<{ revision: number; status: ChallengeStatus }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const challenge = await tx.challenge.findUnique({
          where: { id: challengeId },
          include: {
            reviewVersion: {
              select: {
                publicState: true,
                publishedAt: true,
                snapshot: { select: { commitSha: true } },
              },
            },
            response: true,
            assessment: { include: { verification: true } },
            adjudication: {
              select: {
                adjudicatorId: true,
                references: {
                  select: {
                    trustAssessment: {
                      select: {
                        assessorId: true,
                        verification: { select: { reviewerId: true } },
                      },
                    },
                    nodeRelationTrustAssessment: {
                      select: {
                        assessorId: true,
                        verification: { select: { reviewerId: true } },
                      },
                    },
                  },
                },
              },
            },
            transitions: { include: { actor: true }, orderBy: { revision: "asc" } },
          },
        });
        if (!challenge) throw new ChallengeError("Challenge not found.", "not-found");
        await assertChallengeContainerReadable(tx, challenge);
        const activeWinnerId = isActiveChallengeStatus(challenge.status)
          ? await reconcileActiveChallengeGroup(
              tx,
              challenge.challengerId,
              challenge.canonicalSubjectHash,
            )
          : null;
        challenge.activeChallengerSubjectKey = expectedActiveKeyForRow(challenge, activeWinnerId);
        assertChallengeLedger(challenge, challenge.activeChallengerSubjectKey);
        assertChallengeResponseIntegrity(challenge, challenge.response);
        const from = challenge.status as ChallengeStatus;
        if (challenge.revision !== input.expectedRevision)
          throw new ChallengeError("Challenge lifecycle changed. Refresh and retry.", "conflict");
        if (!isLegalChallengeTransition(from, input.toStatus))
          throw new ChallengeError(
            `Illegal challenge transition: ${from} → ${input.toStatus}.`,
            "conflict",
          );
        const subjectInput = rowSubject(challenge);
        if (!subjectInput)
          throw new ChallengeError("Challenge subject binding is invalid.", "conflict");
        const currentSubject = await resolveChallengeSubject(
          tx,
          challenge.reviewVersionId,
          subjectInput,
          challenge.nodeEdgeProposalId,
        );
        if (
          currentSubject.hash !== challenge.canonicalSubjectHash ||
          currentSubject.refJson !== challenge.subjectRefJson
        ) {
          throw new ChallengeError("Challenge subject integrity check failed.", "conflict");
        }
        if (input.toStatus === "withdrawn") {
          if (challenge.challengerId !== actor.id)
            throw new ChallengeError(
              "Only the challenger may withdraw this challenge.",
              "forbidden",
            );
        } else if (input.toStatus === "author-responded") {
          throw new ChallengeError(
            "Create an attributed response to mark this challenge author-responded.",
            "bad-request",
          );
        } else if (!hasChallengeResolutionAuthority(actor)) {
          throw new ChallengeError("Editor resolution authority required.", "forbidden");
        }
        if (["resolved", "dismissed"].includes(input.toStatus) && !input.rationale)
          throw new ChallengeError("A rationale is required for an editorial outcome.");
        const isOutcome = input.toStatus === "resolved" || input.toStatus === "dismissed";
        const conflictOfInterestStatus = isOutcome
          ? (input.conflictOfInterest?.status ?? "not-provided")
          : null;
        const contributor = isOutcome
          ? challenge.reviewVersionId
            ? await contributorOfRecord(tx, challenge.reviewVersionId, actor)
            : challenge.nodeEdgeProposalId
              ? await nodeContributorOfRecord(tx, challenge.nodeEdgeProposalId, actor)
              : null
          : null;
        const actorLogin = actor.githubLogin.normalize("NFKC").toLowerCase();
        const assessmentAssessor = challenge.assessment?.assessorId
          ?.normalize("NFKC")
          .toLowerCase();
        const referencedAssessmentInvolvement = challenge.adjudication?.references.some(
          (reference) => {
            const assessment = reference.trustAssessment ?? reference.nodeRelationTrustAssessment;
            return (
              assessment?.assessorId?.normalize("NFKC").toLowerCase() === actorLogin ||
              assessment?.verification?.reviewerId === actor.id
            );
          },
        );
        const directlyInvolved = Boolean(
          isOutcome &&
          (challenge.challengerId === actor.id ||
            challenge.response?.responderId === actor.id ||
            contributor ||
            assessmentAssessor === actorLogin ||
            challenge.assessment?.verification?.reviewerId === actor.id ||
            challenge.adjudication?.adjudicatorId === actor.id ||
            referencedAssessmentInvolvement),
        );
        if (directlyInvolved && !input.administratorOverride) {
          throw new ChallengeError(
            "Direct self-involvement requires recusal or an explicit administrator override.",
            "forbidden",
          );
        }
        if (input.administratorOverride) {
          if (!directlyInvolved)
            throw new ChallengeError(
              "An administrator override is valid only for direct self-involvement.",
            );
          if (actor.role !== "ADMIN")
            throw new ChallengeError(
              "Administrator role required for a recusal override.",
              "forbidden",
            );
          if (conflictOfInterestStatus !== "conflict-declared")
            throw new ChallengeError(
              "An administrator override requires a conflict-declared snapshot.",
            );
        }
        const outcomeAt = new Date();
        const revision = challenge.revision + 1;
        const claimed = await tx.challenge.updateMany({
          where: { id: challenge.id, revision: input.expectedRevision, status: from },
          data: {
            status: input.toStatus,
            revision,
            activeChallengerSubjectKey: ACTIVE_CHALLENGE_STATUSES.includes(
              input.toStatus as (typeof ACTIVE_CHALLENGE_STATUSES)[number],
            )
              ? challenge.activeChallengerSubjectKey
              : null,
          },
        });
        if (claimed.count !== 1)
          throw new ChallengeError("Challenge lifecycle changed. Refresh and retry.", "conflict");
        await tx.challengeTransition.create({
          data: {
            challengeId,
            fromStatus: from,
            toStatus: input.toStatus,
            actorId: actor.id,
            actorRoleSnapshot: actor.role,
            filedContentHash: challenge.filedContentHash,
            rationale: input.rationale,
            conflictOfInterestStatus,
            administratorOverride: input.administratorOverride ?? false,
            administratorOverrideById: input.administratorOverride ? actor.id : null,
            administratorOverrideGithubLoginSnapshot: input.administratorOverride
              ? actor.githubLogin
              : null,
            administratorOverrideAt: input.administratorOverride ? outcomeAt : null,
            createdAt: outcomeAt,
            revision,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "challenge.transitioned",
            subjectType: "challenge",
            subjectId: challengeId,
            detailsJson: canonicalJson({
              fromStatus: from,
              filedContentHash: challenge.filedContentHash,
              rationale: input.rationale,
              conflictOfInterestStatus,
              administratorOverride: input.administratorOverride ?? false,
              revision,
              toStatus: input.toStatus,
            }),
          },
        });
        return { revision, status: input.toStatus };
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    );
  } catch (error) {
    return mapChallengeTransactionError(error);
  }
}

export async function listChallenges(
  slug: string,
  reviewVersionId: string,
): Promise<ChallengeList | null> {
  const version = await prisma.reviewVersion.findFirst({
    where: { id: reviewVersionId, review: { slug, status: "published" } },
    select: {
      id: true,
      publicState: true,
      publishedAt: true,
      snapshot: { select: { commitSha: true } },
    },
  });
  if (!version || !isExactChallengeVersion(version)) return null;
  const rows = await (async () => {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const loaded = await tx.challenge.findMany({
            where: { reviewVersionId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: {
              challenger: true,
              response: true,
              transitions: { include: { actor: true }, orderBy: { revision: "asc" } },
            },
          });
          const winners = new Map<string, string | null>();
          for (const row of loaded) {
            if (!isActiveChallengeStatus(row.status)) continue;
            const group = canonicalJson([row.challengerId, row.canonicalSubjectHash]);
            if (!winners.has(group)) {
              winners.set(
                group,
                await reconcileActiveChallengeGroup(tx, row.challengerId, row.canonicalSubjectHash),
              );
            }
            row.activeChallengerSubjectKey = expectedActiveKeyForRow(row, winners.get(group)!);
          }
          return loaded;
        },
        { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
      );
    } catch (error) {
      return mapChallengeTransactionError(error);
    }
  })();
  const challenges: PublicChallenge[] = [];
  for (const row of rows) {
    const input = rowSubject(row);
    if (!input) continue;
    try {
      const subject = await resolveChallengeSubject(prisma, reviewVersionId, input);
      if (subject.hash !== row.canonicalSubjectHash || subject.refJson !== row.subjectRefJson)
        continue;
      assertChallengeLedger(
        row,
        isActiveChallengeStatus(row.status) ? row.activeChallengerSubjectKey : null,
      );
      assertChallengeResponseIntegrity(row, row.response);
      if (
        !challengeContentStatusSchema.safeParse(row.contentStatus).success ||
        (row.response &&
          (!challengeContentStatusSchema.safeParse(row.response.contentStatus).success ||
            row.response.contentHash !==
              hashChallengeResponse({
                challengeId: row.response.challengeId,
                responderId: row.response.responderId,
                responderRoleSnapshot: row.response.responderRoleSnapshot,
                responderGithubLoginSnapshot: row.response.responderGithubLoginSnapshot,
                responderDisplayNameSnapshot: row.response.responderDisplayNameSnapshot,
                contributorPersonId: row.response.contributorPersonId,
                nodeContributorUserId: row.response.nodeContributorUserId,
                contributorGithubLoginSnapshot: row.response.contributorGithubLoginSnapshot,
                contributorDisplayNameSnapshot: row.response.contributorDisplayNameSnapshot,
                contributorRolesJsonSnapshot: row.response.contributorRolesJsonSnapshot,
                body: row.response.body,
              })))
      ) {
        throw new ChallengeError(
          "Challenge content projection integrity check failed.",
          "conflict",
        );
      }
      challenges.push({
        id: row.id,
        containerType: "review-version",
        reviewVersionId,
        nodeEdgeProposalId: null,
        subjectType: subject.type,
        subjectLabel: subject.label,
        subjectHref: `/reviews/${encodeURIComponent(slug)}/versions/${encodeURIComponent(reviewVersionId)}#${subject.hrefFragment}`,
        canonicalSubjectHash: row.canonicalSubjectHash,
        filedContentHash: row.filedContentHash,
        grounds: row.grounds as PublicChallenge["grounds"],
        body: row.contentStatus === "visible" ? row.body : "",
        contentStatus: row.contentStatus as ChallengeContentStatus,
        contentRevision: row.contentRevision,
        status: row.status as ChallengeStatus,
        revision: row.revision,
        challenger: {
          githubLogin: row.challenger.githubLogin,
          displayName: row.challenger.displayName,
        },
        transitions: row.transitions.map((event) => ({
          id: event.id,
          fromStatus: event.fromStatus as ChallengeStatus | null,
          toStatus: event.toStatus as ChallengeStatus,
          actor: { githubLogin: event.actor.githubLogin },
          conflictOfInterest: {
            status: conflictOfInterestStatusSchema.parse(
              event.conflictOfInterestStatus ?? "not-provided",
            ),
          },
          administratorOverride: event.administratorOverride
            ? {
                administrator: {
                  githubLogin: event.administratorOverrideGithubLoginSnapshot!,
                },
                exercisedAt: event.administratorOverrideAt!.toISOString(),
              }
            : undefined,
          revision: event.revision,
          createdAt: event.createdAt.toISOString(),
        })),
        response: row.response
          ? {
              id: row.response.id,
              body: row.response.contentStatus === "visible" ? row.response.body : "",
              contentHash: row.response.contentHash,
              contentStatus: row.response.contentStatus as ChallengeContentStatus,
              contentRevision: row.response.contentRevision,
              responder: {
                githubLogin: row.response.responderGithubLoginSnapshot,
                displayName: row.response.responderDisplayNameSnapshot,
              },
              createdAt: row.response.createdAt.toISOString(),
            }
          : null,
        createdAt: row.createdAt.toISOString(),
      });
    } catch (error) {
      if (!(error instanceof ChallengeError)) throw error;
    }
  }
  return { reviewSlug: slug, reviewVersionId, challenges };
}

export async function isNodeChallengeContributorOfRecord(
  nodeEdgeProposalIds: readonly string[],
  actor: SessionUser,
): Promise<boolean> {
  for (const id of nodeEdgeProposalIds) {
    if (await nodeContributorOfRecord(prisma, id, actor)) return true;
  }
  return false;
}

/** Public node register/export for exact node-relation adjudication challenges. */
export async function listNodeChallenges(
  nodeId: string,
  cursor?: string,
  requestedLimit = 50,
): Promise<NodeChallengeList | null> {
  const limit = Math.max(1, Math.min(MAX_NODE_CHALLENGE_PAGE_SIZE, Math.trunc(requestedLimit)));
  const node = await prisma.knowledgeNode.findFirst({
    where: { id: nodeId, versions: { some: readablePublicNodeVersionWhere } },
    select: { id: true },
  });
  if (!node) return null;
  const rows = await prisma.$transaction(
    async (tx) => {
      const cursorRow = cursor
        ? await tx.challenge.findFirst({
            where: {
              id: cursor,
              nodeContainer: { sourceNodeVersion: { knowledgeNodeId: nodeId } },
            },
            select: { id: true },
          })
        : null;
      if (cursor && !cursorRow) throw new ChallengeError("Invalid node challenge cursor.");
      const loaded = await tx.challenge.findMany({
        where: {
          reviewVersionId: null,
          nodeEdgeProposalId: { not: null },
          nodeContainer: {
            status: "confirmed",
            sourceNodeVersion: {
              ...readablePublicNodeVersionWhere,
              knowledgeNodeId: nodeId,
            },
            targetNodeVersion: readablePublicNodeVersionWhere,
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        ...(cursorRow ? { cursor: { id: cursorRow.id }, skip: 1 } : {}),
        take: limit + 1,
        include: {
          challenger: true,
          response: true,
          transitions: { include: { actor: true }, orderBy: { revision: "asc" } },
        },
      });
      const winners = new Map<string, string | null>();
      for (const row of loaded) {
        if (!isActiveChallengeStatus(row.status)) continue;
        const group = canonicalJson([row.challengerId, row.canonicalSubjectHash]);
        if (!winners.has(group)) {
          winners.set(
            group,
            await reconcileActiveChallengeGroup(tx, row.challengerId, row.canonicalSubjectHash),
          );
        }
        row.activeChallengerSubjectKey = expectedActiveKeyForRow(row, winners.get(group)!);
      }
      return loaded;
    },
    { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
  );
  const pageRows = rows.slice(0, limit);
  const subjectOptions = await nodeAdjudicationOptions(
    pageRows.flatMap((row) =>
      row.trustAdjudicationId
        ? [{ id: row.trustAdjudicationId, nodeEdgeProposalId: row.nodeEdgeProposalId }]
        : [],
    ),
  );
  const optionByAdjudicationId = new Map(
    subjectOptions.flatMap((option) =>
      option.subject.type === "adjudication"
        ? [[option.subject.adjudicationId, option] as const]
        : [],
    ),
  );
  const challenges: PublicChallenge[] = [];
  for (const row of pageRows) {
    const input = rowSubject(row);
    if (input?.type !== "adjudication" || !row.nodeEdgeProposalId || !row.trustAdjudicationId)
      continue;
    try {
      await assertChallengeContainerReadable(prisma, row);
      const option = optionByAdjudicationId.get(row.trustAdjudicationId);
      if (
        !option ||
        option.nodeEdgeProposalId !== row.nodeEdgeProposalId ||
        option.canonicalSubjectHash !== row.canonicalSubjectHash ||
        option.canonicalSubjectRefJson !== row.subjectRefJson
      )
        continue;
      assertChallengeLedger(
        row,
        isActiveChallengeStatus(row.status) ? row.activeChallengerSubjectKey : null,
      );
      assertChallengeResponseIntegrity(row, row.response);
      if (
        !challengeContentStatusSchema.safeParse(row.contentStatus).success ||
        (row.response &&
          (!challengeContentStatusSchema.safeParse(row.response.contentStatus).success ||
            row.response.contentHash !==
              hashChallengeResponse({
                challengeId: row.response.challengeId,
                responderId: row.response.responderId,
                responderRoleSnapshot: row.response.responderRoleSnapshot,
                responderGithubLoginSnapshot: row.response.responderGithubLoginSnapshot,
                responderDisplayNameSnapshot: row.response.responderDisplayNameSnapshot,
                contributorPersonId: row.response.contributorPersonId,
                nodeContributorUserId: row.response.nodeContributorUserId,
                contributorGithubLoginSnapshot: row.response.contributorGithubLoginSnapshot,
                contributorDisplayNameSnapshot: row.response.contributorDisplayNameSnapshot,
                contributorRolesJsonSnapshot: row.response.contributorRolesJsonSnapshot,
                body: row.response.body,
              })))
      ) {
        throw new ChallengeError(
          "Challenge content projection integrity check failed.",
          "conflict",
        );
      }
      challenges.push({
        id: row.id,
        containerType: "node-relation",
        reviewVersionId: null,
        nodeEdgeProposalId: row.nodeEdgeProposalId,
        subjectType: "adjudication",
        subjectLabel: option.label,
        subjectHref: `/nodes/${encodeURIComponent(nodeId)}#adjudication-${encodeURIComponent(row.trustAdjudicationId)}`,
        canonicalSubjectHash: row.canonicalSubjectHash,
        filedContentHash: row.filedContentHash,
        grounds: row.grounds as PublicChallenge["grounds"],
        body: row.contentStatus === "visible" ? row.body : "",
        contentStatus: row.contentStatus as ChallengeContentStatus,
        contentRevision: row.contentRevision,
        status: row.status as ChallengeStatus,
        revision: row.revision,
        challenger: {
          githubLogin: row.challenger.githubLogin,
          displayName: row.challenger.displayName,
        },
        transitions: row.transitions.map((event) => ({
          id: event.id,
          fromStatus: event.fromStatus as ChallengeStatus | null,
          toStatus: event.toStatus as ChallengeStatus,
          actor: { githubLogin: event.actor.githubLogin },
          conflictOfInterest: {
            status: conflictOfInterestStatusSchema.parse(
              event.conflictOfInterestStatus ?? "not-provided",
            ),
          },
          administratorOverride: event.administratorOverride
            ? {
                administrator: {
                  githubLogin: event.administratorOverrideGithubLoginSnapshot!,
                },
                exercisedAt: event.administratorOverrideAt!.toISOString(),
              }
            : undefined,
          revision: event.revision,
          createdAt: event.createdAt.toISOString(),
        })),
        response: row.response
          ? {
              id: row.response.id,
              body: row.response.contentStatus === "visible" ? row.response.body : "",
              contentHash: row.response.contentHash,
              contentStatus: row.response.contentStatus as ChallengeContentStatus,
              contentRevision: row.response.contentRevision,
              responder: {
                githubLogin: row.response.responderGithubLoginSnapshot,
                displayName: row.response.responderDisplayNameSnapshot,
              },
              createdAt: row.response.createdAt.toISOString(),
            }
          : null,
        createdAt: row.createdAt.toISOString(),
      });
    } catch (error) {
      if (!(error instanceof ChallengeError)) throw error;
    }
  }
  return {
    nodeId,
    nodeEdgeProposalIds: [...new Set(challenges.flatMap((row) => row.nodeEdgeProposalId ?? []))],
    challenges,
    nextCursor: rows.length > limit ? (pageRows.at(-1)?.id ?? null) : null,
  };
}

function hashChallengeResponse(input: {
  challengeId: string;
  responderId: string;
  responderRoleSnapshot: string;
  responderGithubLoginSnapshot: string;
  responderDisplayNameSnapshot: string | null;
  contributorPersonId: string | null;
  nodeContributorUserId: string | null;
  contributorGithubLoginSnapshot: string;
  contributorDisplayNameSnapshot: string;
  contributorRolesJsonSnapshot: string;
  body: string;
}): string {
  if (input.contributorPersonId && !input.nodeContributorUserId) {
    const { nodeContributorUserId: _nodeContributorUserId, ...legacy } = input;
    return sha256(canonicalJson({ schema: "oratlas/challenge-response/1", ...legacy }));
  }
  return sha256(canonicalJson({ schema: "oratlas/challenge-response/2", ...input }));
}

type ResponseIntegrityRecord = Parameters<typeof hashChallengeResponse>[0] & {
  id: string;
  contentHash: string;
  contentStatus: string;
};

function assertChallengeResponseIntegrity(
  challenge: {
    id: string;
    reviewVersionId: string | null;
    nodeEdgeProposalId: string | null;
    status: string;
    transitions: Array<{
      fromStatus: string | null;
      toStatus: string;
      actorId: string;
      actorRoleSnapshot: string;
      responseContentHash: string | null;
      revision: number;
    }>;
  },
  response: ResponseIntegrityRecord | null,
): void {
  const responseEvent = challenge.transitions.find(
    (transition) => transition.toStatus === "author-responded",
  );
  if (Boolean(responseEvent) !== Boolean(response)) {
    throw new ChallengeError("Challenge response ledger binding is incomplete.", "conflict");
  }
  if (!responseEvent || !response) return;
  const contentHash = hashChallengeResponse({
    challengeId: response.challengeId,
    responderId: response.responderId,
    responderRoleSnapshot: response.responderRoleSnapshot,
    responderGithubLoginSnapshot: response.responderGithubLoginSnapshot,
    responderDisplayNameSnapshot: response.responderDisplayNameSnapshot,
    contributorPersonId: response.contributorPersonId,
    nodeContributorUserId: response.nodeContributorUserId,
    contributorGithubLoginSnapshot: response.contributorGithubLoginSnapshot,
    contributorDisplayNameSnapshot: response.contributorDisplayNameSnapshot,
    contributorRolesJsonSnapshot: response.contributorRolesJsonSnapshot,
    body: response.body,
  });
  if (
    challenge.status === "open" ||
    (challenge.reviewVersionId !== null) !== (response.contributorPersonId !== null) ||
    (challenge.nodeEdgeProposalId !== null) !== (response.nodeContributorUserId !== null) ||
    response.challengeId !== challenge.id ||
    responseEvent.fromStatus !== "open" ||
    responseEvent.revision !== 1 ||
    responseEvent.actorId !== response.responderId ||
    responseEvent.actorRoleSnapshot !== response.responderRoleSnapshot ||
    responseEvent.responseContentHash !== response.contentHash ||
    response.contentHash !== contentHash ||
    !challengeContentStatusSchema.safeParse(response.contentStatus).success
  ) {
    throw new ChallengeError("Challenge response ledger binding is invalid.", "conflict");
  }
}

export async function createChallengeResponse(
  challengeId: string,
  actor: SessionUser,
  input: CreateChallengeResponseInput,
): Promise<{ id: string; revision: number; status: "author-responded" }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const challenge = await tx.challenge.findUnique({
          where: { id: challengeId },
          include: {
            response: true,
            reviewVersion: {
              select: {
                publicState: true,
                publishedAt: true,
                snapshot: { select: { commitSha: true } },
              },
            },
            transitions: { include: { actor: true }, orderBy: { revision: "asc" } },
          },
        });
        if (!challenge) throw new ChallengeError("Challenge not found.", "not-found");
        await assertChallengeContainerReadable(tx, challenge);
        const activeWinnerId = await reconcileActiveChallengeGroup(
          tx,
          challenge.challengerId,
          challenge.canonicalSubjectHash,
        );
        challenge.activeChallengerSubjectKey = expectedActiveKeyForRow(challenge, activeWinnerId);
        assertChallengeLedger(challenge, challenge.activeChallengerSubjectKey);
        assertChallengeResponseIntegrity(challenge, challenge.response);
        if (challenge.status !== "open" || challenge.revision !== input.expectedRevision)
          throw new ChallengeError("Challenge lifecycle changed. Refresh and retry.", "conflict");
        if (challenge.response)
          throw new ChallengeError("This challenge already has a response.", "conflict");
        const subjectInput = rowSubject(challenge);
        if (!subjectInput)
          throw new ChallengeError("Challenge subject binding is invalid.", "conflict");
        const currentSubject = await resolveChallengeSubject(
          tx,
          challenge.reviewVersionId,
          subjectInput,
          challenge.nodeEdgeProposalId,
        );
        if (
          currentSubject.hash !== challenge.canonicalSubjectHash ||
          currentSubject.refJson !== challenge.subjectRefJson
        ) {
          throw new ChallengeError("Challenge subject integrity check failed.", "conflict");
        }
        const contributor = challenge.reviewVersionId
          ? await contributorOfRecord(tx, challenge.reviewVersionId, actor)
          : challenge.nodeEdgeProposalId
            ? await nodeContributorOfRecord(tx, challenge.nodeEdgeProposalId, actor)
            : null;
        if (!contributor)
          throw new ChallengeError("Only a contributor of record may respond.", "forbidden");
        const responseContent = {
          challengeId,
          responderId: actor.id,
          responderRoleSnapshot: actor.role,
          responderGithubLoginSnapshot: actor.githubLogin,
          responderDisplayNameSnapshot: actor.displayName,
          contributorPersonId: contributor.personId,
          nodeContributorUserId: contributor.nodeContributorUserId,
          contributorGithubLoginSnapshot: contributor.githubLogin,
          contributorDisplayNameSnapshot: contributor.displayName,
          contributorRolesJsonSnapshot: contributor.rolesJson,
          body: input.body,
        };
        const contentHash = hashChallengeResponse(responseContent);
        const revision = input.expectedRevision + 1;
        const claimed = await tx.challenge.updateMany({
          where: { id: challengeId, status: "open", revision: input.expectedRevision },
          data: { status: "author-responded", revision },
        });
        if (claimed.count !== 1)
          throw new ChallengeError("Challenge lifecycle changed. Refresh and retry.", "conflict");
        const response = await tx.challengeResponse.create({
          data: { ...responseContent, contentHash },
        });
        await tx.challengeTransition.create({
          data: {
            challengeId,
            fromStatus: "open",
            toStatus: "author-responded",
            actorId: actor.id,
            actorRoleSnapshot: actor.role,
            responseContentHash: contentHash,
            filedContentHash: challenge.filedContentHash,
            revision,
          },
        });
        await tx.auditEvent.createMany({
          data: [
            {
              actorId: actor.id,
              action: "challenge.response-created",
              subjectType: "challengeResponse",
              subjectId: response.id,
              detailsJson: canonicalJson({ challengeId, contentHash, revision }),
            },
            {
              actorId: actor.id,
              action: "challenge.transitioned",
              subjectType: "challenge",
              subjectId: challengeId,
              detailsJson: canonicalJson({
                fromStatus: "open",
                filedContentHash: challenge.filedContentHash,
                revision,
                toStatus: "author-responded",
              }),
            },
          ],
        });
        return { id: response.id, revision, status: "author-responded" as const };
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    );
  } catch (error) {
    return mapChallengeTransactionError(error);
  }
}

export async function removeChallengeContent(
  challengeId: string,
  actor: SessionUser,
  input: ModerateChallengeContentInput,
): Promise<{ contentRevision: number; contentStatus: "removed" }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const challenge = await tx.challenge.findUnique({
        where: { id: challengeId },
        include: {
          reviewVersion: {
            select: {
              publicState: true,
              publishedAt: true,
              snapshot: { select: { commitSha: true } },
            },
          },
          response: true,
          transitions: { include: { actor: true }, orderBy: { revision: "asc" } },
        },
      });
      if (!challenge) throw new ChallengeError("Challenge not found.", "not-found");
      await assertChallengeContainerReadable(tx, challenge);
      const activeWinnerId = isActiveChallengeStatus(challenge.status)
        ? await reconcileActiveChallengeGroup(
            tx,
            challenge.challengerId,
            challenge.canonicalSubjectHash,
          )
        : null;
      challenge.activeChallengerSubjectKey = expectedActiveKeyForRow(challenge, activeWinnerId);
      assertChallengeLedger(challenge, challenge.activeChallengerSubjectKey);
      assertChallengeResponseIntegrity(challenge, challenge.response);
      await assertChallengeSubjectIntegrity(tx, challenge);
      if (challenge.challengerId !== actor.id && !isEditor(actor))
        throw new ChallengeError(
          "Only the filer or an editor may remove this challenge text.",
          "forbidden",
        );
      if (
        challenge.contentStatus !== "visible" ||
        challenge.contentRevision !== input.expectedContentRevision
      )
        throw new ChallengeError("Challenge content changed. Refresh and retry.", "conflict");
      const contentRevision = challenge.contentRevision + 1;
      const claimed = await tx.challenge.updateMany({
        where: {
          id: challengeId,
          contentStatus: "visible",
          contentRevision: input.expectedContentRevision,
        },
        data: {
          contentStatus: "removed",
          contentRevision,
          removedAt: new Date(),
          removedById: actor.id,
          removedByRoleSnapshot: actor.role,
        },
      });
      if (claimed.count !== 1)
        throw new ChallengeError("Challenge content changed. Refresh and retry.", "conflict");
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "challenge.content-removed",
          subjectType: "challenge",
          subjectId: challengeId,
          detailsJson: canonicalJson({ contentHash: challenge.filedContentHash, contentRevision }),
        },
      });
      return { contentRevision, contentStatus: "removed" as const };
    });
  } catch (error) {
    return mapChallengeTransactionError(error);
  }
}

export async function removeChallengeResponseContent(
  responseId: string,
  actor: SessionUser,
  input: ModerateChallengeContentInput,
): Promise<{ contentRevision: number; contentStatus: "removed" }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const response = await tx.challengeResponse.findUnique({
        where: { id: responseId },
        include: {
          challenge: {
            include: {
              reviewVersion: {
                select: {
                  publicState: true,
                  publishedAt: true,
                  snapshot: { select: { commitSha: true } },
                },
              },
              response: true,
              transitions: { include: { actor: true }, orderBy: { revision: "asc" } },
            },
          },
        },
      });
      if (!response) throw new ChallengeError("Challenge response not found.", "not-found");
      await assertChallengeContainerReadable(tx, response.challenge);
      const challenge = response.challenge;
      const activeWinnerId = isActiveChallengeStatus(challenge.status)
        ? await reconcileActiveChallengeGroup(
            tx,
            challenge.challengerId,
            challenge.canonicalSubjectHash,
          )
        : null;
      challenge.activeChallengerSubjectKey = expectedActiveKeyForRow(challenge, activeWinnerId);
      assertChallengeLedger(challenge, challenge.activeChallengerSubjectKey);
      assertChallengeResponseIntegrity(challenge, response);
      await assertChallengeSubjectIntegrity(tx, challenge);
      if (
        response.contentHash !==
        hashChallengeResponse({
          challengeId: response.challengeId,
          responderId: response.responderId,
          responderRoleSnapshot: response.responderRoleSnapshot,
          responderGithubLoginSnapshot: response.responderGithubLoginSnapshot,
          responderDisplayNameSnapshot: response.responderDisplayNameSnapshot,
          contributorPersonId: response.contributorPersonId,
          nodeContributorUserId: response.nodeContributorUserId,
          contributorGithubLoginSnapshot: response.contributorGithubLoginSnapshot,
          contributorDisplayNameSnapshot: response.contributorDisplayNameSnapshot,
          contributorRolesJsonSnapshot: response.contributorRolesJsonSnapshot,
          body: response.body,
        })
      )
        throw new ChallengeError("Challenge response integrity check failed.", "conflict");
      if (response.responderId !== actor.id && !isEditor(actor))
        throw new ChallengeError(
          "Only the responder or an editor may remove this response.",
          "forbidden",
        );
      if (
        response.contentStatus !== "visible" ||
        response.contentRevision !== input.expectedContentRevision
      )
        throw new ChallengeError("Response content changed. Refresh and retry.", "conflict");
      const contentRevision = response.contentRevision + 1;
      const claimed = await tx.challengeResponse.updateMany({
        where: {
          id: responseId,
          contentStatus: "visible",
          contentRevision: input.expectedContentRevision,
        },
        data: {
          contentStatus: "removed",
          contentRevision,
          removedAt: new Date(),
          removedById: actor.id,
          removedByRoleSnapshot: actor.role,
        },
      });
      if (claimed.count !== 1)
        throw new ChallengeError("Response content changed. Refresh and retry.", "conflict");
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "challenge.response-removed",
          subjectType: "challengeResponse",
          subjectId: responseId,
          detailsJson: canonicalJson({
            challengeId: response.challengeId,
            contentHash: response.contentHash,
            contentRevision,
          }),
        },
      });
      return { contentRevision, contentStatus: "removed" as const };
    });
  } catch (error) {
    return mapChallengeTransactionError(error);
  }
}

export type ChallengeQueueItem = {
  id: string;
  status: "open" | "author-responded";
  revision: number;
  contentStatus: ChallengeContentStatus;
  contentRevision: number;
  response: PublicChallenge["response"];
  subjectLabel: string;
  challengeHref: string;
  createdAt: string;
};

export type ChallengeQueuePage = {
  items: ChallengeQueueItem[];
  nextCursor: string | null;
};

/** Deterministic, bounded editorial page over active challenge records. */
export async function listOpenChallengePage(
  cursor?: string,
  requestedLimit = 25,
): Promise<ChallengeQueuePage> {
  const limit = Math.max(1, Math.min(100, Math.trunc(requestedLimit)));
  const rows = await prisma.$transaction(
    async (tx) => {
      const cursorRow = cursor
        ? await tx.challenge.findUnique({ where: { id: cursor }, select: { id: true } })
        : null;
      if (cursor && !cursorRow) throw new ChallengeError("Invalid challenge queue cursor.");
      const loaded = await tx.challenge.findMany({
        where: {
          status: { in: [...ACTIVE_CHALLENGE_STATUSES] },
          OR: [
            {
              reviewVersion: {
                publicState: { in: ["published", "withdrawn"] },
                publishedAt: { not: null },
                review: { status: "published" },
              },
            },
            {
              nodeContainer: {
                status: "confirmed",
                sourceNodeVersion: readablePublicNodeVersionWhere,
                targetNodeVersion: readablePublicNodeVersionWhere,
              },
            },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        ...(cursorRow ? { cursor: { id: cursorRow.id }, skip: 1 } : {}),
        take: limit + 1,
        include: {
          response: true,
          transitions: { include: { actor: true }, orderBy: { revision: "asc" } },
          reviewVersion: {
            select: {
              publicState: true,
              publishedAt: true,
              snapshot: { select: { commitSha: true } },
              review: { select: { slug: true } },
            },
          },
          nodeContainer: {
            select: { sourceNodeVersion: { select: { knowledgeNodeId: true } } },
          },
        },
      });
      const winners = new Map<string, string | null>();
      for (const row of loaded) {
        const group = canonicalJson([row.challengerId, row.canonicalSubjectHash]);
        if (!winners.has(group)) {
          winners.set(
            group,
            await reconcileActiveChallengeGroup(tx, row.challengerId, row.canonicalSubjectHash),
          );
        }
        row.activeChallengerSubjectKey = expectedActiveKeyForRow(row, winners.get(group)!);
      }
      return loaded;
    },
    { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
  );
  const pageRows = rows.slice(0, limit);
  const items: ChallengeQueueItem[] = [];
  for (const row of pageRows) {
    try {
      await assertChallengeContainerReadable(prisma, row);
      assertChallengeLedger(row, row.activeChallengerSubjectKey);
      assertChallengeResponseIntegrity(row, row.response);
      await assertChallengeSubjectIntegrity(prisma, row);
      if (!challengeContentStatusSchema.safeParse(row.contentStatus).success) continue;
      const subject = await resolveChallengeSubject(
        prisma,
        row.reviewVersionId,
        rowSubject(row)!,
        row.nodeEdgeProposalId,
      );
      items.push({
        id: row.id,
        status: row.status as "open" | "author-responded",
        revision: row.revision,
        contentStatus: row.contentStatus as ChallengeContentStatus,
        contentRevision: row.contentRevision,
        response: row.response
          ? {
              id: row.response.id,
              body: row.response.contentStatus === "visible" ? row.response.body : "",
              contentHash: row.response.contentHash,
              contentStatus: row.response.contentStatus as ChallengeContentStatus,
              contentRevision: row.response.contentRevision,
              responder: {
                githubLogin: row.response.responderGithubLoginSnapshot,
                displayName: row.response.responderDisplayNameSnapshot,
              },
              createdAt: row.response.createdAt.toISOString(),
            }
          : null,
        subjectLabel: subject.label,
        challengeHref:
          row.reviewVersionId && row.reviewVersion
            ? `/reviews/${encodeURIComponent(row.reviewVersion.review.slug)}/versions/${encodeURIComponent(row.reviewVersionId)}#challenge-${encodeURIComponent(row.id)}`
            : row.nodeContainer
              ? `/nodes/${encodeURIComponent(row.nodeContainer.sourceNodeVersion.knowledgeNodeId)}#challenge-${encodeURIComponent(row.id)}`
              : "",
        createdAt: row.createdAt.toISOString(),
      });
    } catch (error) {
      if (!(error instanceof ChallengeError)) throw error;
    }
  }
  return {
    items,
    nextCursor: rows.length > limit ? (pageRows.at(-1)?.id ?? null) : null,
  };
}
