import "server-only";
import {
  canonicalJson,
  challengeGroundsSchema,
  challengeStatusSchema,
  isExactCommitSha,
  isLegalChallengeTransition,
  trustCriterionAssessmentSchema,
  TRUST_CRITERIA,
  userRoleSchema,
} from "@oratlas/contracts";
import { createReviewedTrustSubject, trustSubjectInputFromDatabaseRows } from "@oratlas/trust";
import type {
  ChallengeList,
  ChallengeStatus,
  ChallengeSubjectInput,
  CreateChallengeInput,
  PublicChallenge,
  TransitionChallengeInput,
} from "@oratlas/contracts";
import type { Prisma } from "@oratlas/db";
import { prisma } from "./db";
import { sha256 } from "./hash";
import { isEditor, type SessionUser } from "./auth";
import { isReadablePublicState } from "./review-lifecycle";

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

type Db = Prisma.TransactionClient | typeof prisma;
type ResolvedSubject = {
  type: ChallengeSubjectInput["type"];
  reviewVersionId: string;
  claimId?: string;
  relationId?: string;
  assessmentId?: string;
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
  reviewVersionId: string,
  subject: ChallengeSubjectInput,
): Promise<ResolvedSubject> {
  if (subject.type === "claim") {
    const claim = await db.claim.findUnique({ where: { id: subject.claimId } });
    if (!claim || claim.reviewVersionId !== reviewVersionId)
      throw new ChallengeError("Challenge claim subject not found.", "not-found");
    return resolved(
      {
        type: subject.type,
        reviewVersionId,
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
  return null;
}

type ChallengeContent = {
  reviewVersionId: string;
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
      !userRoleSchema.safeParse(event.actorRoleSnapshot).success
    ) {
      throw new ChallengeError("Challenge lifecycle ledger is invalid.", "conflict");
    }
    if (index === 0) {
      if (
        event.fromStatus !== null ||
        event.toStatus !== "open" ||
        event.actorId !== row.challengerId ||
        event.rationale !== null
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
      if (to.data === "withdrawn" && event.actorId !== row.challengerId) {
        throw new ChallengeError("Challenge withdrawal evidence is invalid.", "conflict");
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
  const candidates = await db.challenge.findMany({
    where: {
      challengerId,
      canonicalSubjectHash,
      status: { in: [...ACTIVE_CHALLENGE_STATUSES] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, activeChallengerSubjectKey: true },
  });
  const winner = candidates[0];
  if (!winner) return null;
  const expectedKey = activeChallengerSubjectKey(challengerId, canonicalSubjectHash);
  if (
    candidates.some(
      (candidate) =>
        candidate.activeChallengerSubjectKey !== null &&
        candidate.activeChallengerSubjectKey !== expectedKey,
    )
  ) {
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
              criterion: subject.criterion,
              subjectRefJson: subject.refJson,
              canonicalSubjectHash: subject.hash,
              grounds: input.grounds,
              body: input.body,
              challengerId: actor.id,
              activeChallengerSubjectKey: activeKey,
              filedContentHash: hashFiledContent({
                reviewVersionId: version.id,
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

async function isContributorOfRecord(
  db: Db,
  versionId: string,
  actor: SessionUser,
): Promise<boolean> {
  const login = actor.githubLogin.normalize("NFKC").toLowerCase();
  const contributors = await db.reviewContributor.findMany({
    where: { reviewVersionId: versionId, person: { githubLogin: { not: null } } },
    select: { person: { select: { githubLogin: true } } },
  });
  return contributors.some(
    ({ person }) => person.githubLogin?.normalize("NFKC").toLowerCase() === login,
  );
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
            transitions: { include: { actor: true }, orderBy: { revision: "asc" } },
          },
        });
        if (!challenge) throw new ChallengeError("Challenge not found.", "not-found");
        if (!isExactChallengeVersion(challenge.reviewVersion)) {
          throw new ChallengeError("Challenges are closed on this review version.", "forbidden");
        }
        const activeWinnerId = isActiveChallengeStatus(challenge.status)
          ? await reconcileActiveChallengeGroup(
              tx,
              challenge.challengerId,
              challenge.canonicalSubjectHash,
            )
          : null;
        challenge.activeChallengerSubjectKey = expectedActiveKeyForRow(challenge, activeWinnerId);
        assertChallengeLedger(challenge, challenge.activeChallengerSubjectKey);
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
          if (!(await isContributorOfRecord(tx, challenge.reviewVersionId, actor)))
            throw new ChallengeError(
              "Only a contributor of record may mark an author response.",
              "forbidden",
            );
        } else if (!hasChallengeResolutionAuthority(actor)) {
          throw new ChallengeError("Editor resolution authority required.", "forbidden");
        }
        if (["resolved", "dismissed"].includes(input.toStatus) && !input.rationale)
          throw new ChallengeError("A rationale is required for an editorial outcome.");
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
      assertChallengeLedger(row, row.activeChallengerSubjectKey);
      challenges.push({
        id: row.id,
        reviewVersionId,
        subjectType: subject.type,
        subjectLabel: subject.label,
        subjectHref: `/reviews/${encodeURIComponent(slug)}/versions/${encodeURIComponent(reviewVersionId)}#${subject.hrefFragment}`,
        canonicalSubjectHash: row.canonicalSubjectHash,
        filedContentHash: row.filedContentHash,
        grounds: row.grounds as PublicChallenge["grounds"],
        body: row.body,
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
          actor: { githubLogin: event.actor.githubLogin, role: event.actor.role },
          actorRoleSnapshot: event.actorRoleSnapshot,
          rationale: event.rationale ?? undefined,
          revision: event.revision,
          createdAt: event.createdAt.toISOString(),
        })),
        createdAt: row.createdAt.toISOString(),
      });
    } catch (error) {
      if (!(error instanceof ChallengeError)) throw error;
    }
  }
  return { reviewSlug: slug, reviewVersionId, challenges };
}
