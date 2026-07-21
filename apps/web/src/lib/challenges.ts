import "server-only";
import {
  canonicalJson,
  isExactCommitSha,
  isLegalChallengeTransition,
  TRUST_CRITERIA,
} from "@oratlas/contracts";
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
    public readonly code: "not-found" | "bad-request" | "forbidden" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "ChallengeError";
  }
}

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

/** Resolve only through exact foreign keys and include immutable target bytes in the digest. */
export async function resolveChallengeSubject(
  db: Db,
  reviewVersionId: string,
  subject: ChallengeSubjectInput,
): Promise<ResolvedSubject> {
  if (subject.type === "claim") {
    const claim = await db.claim.findFirst({
      where: { id: subject.claimId, reviewVersionId },
      select: {
        id: true,
        reviewVersionId: true,
        localClaimId: true,
        text: true,
        normalizedText: true,
        claimType: true,
        qualification: true,
      },
    });
    if (!claim) throw new ChallengeError("Challenge claim subject not found.", "not-found");
    return resolved(
      {
        type: subject.type,
        reviewVersionId,
        claimId: claim.id,
        label: `Claim ${claim.localClaimId}`,
        hrefFragment: `claim-subject-${claim.id}`,
      },
      { schema: "oratlas/challenge-subject/1", type: subject.type, ...claim },
    );
  }
  if (subject.type === "relation") {
    const relation = await db.claimEvidenceRelation.findFirst({
      where: { id: subject.relationId, claim: { reviewVersionId } },
      select: {
        id: true,
        claimId: true,
        citationId: true,
        relationType: true,
        supportDirection: true,
        sourceLocation: true,
        extractionMethod: true,
        extractionConfidence: true,
        humanReviewed: true,
        claim: { select: { reviewVersionId: true, localClaimId: true } },
        citation: { select: { localCitationId: true } },
      },
    });
    if (!relation) throw new ChallengeError("Challenge relation subject not found.", "not-found");
    return resolved(
      {
        type: subject.type,
        reviewVersionId,
        relationId: relation.id,
        label: `Relation ${relation.claim.localClaimId} → ${relation.citation.localCitationId}`,
        hrefFragment: `relation-subject-${relation.id}`,
      },
      { schema: "oratlas/challenge-subject/1", type: subject.type, ...relation },
    );
  }

  if (!TRUST_CRITERIA.includes(subject.criterion as (typeof TRUST_CRITERIA)[number])) {
    throw new ChallengeError("Unknown TRUST criterion.");
  }
  const assessment = await db.trustAssessment.findFirst({
    where: { id: subject.assessmentId, relation: { claim: { reviewVersionId } } },
    include: {
      relation: {
        include: {
          claim: { select: { reviewVersionId: true, localClaimId: true } },
          citation: { select: { localCitationId: true } },
        },
      },
    },
  });
  if (!assessment) throw new ChallengeError("Challenge assessment subject not found.", "not-found");
  const criterionValue = assessment[subject.criterion as keyof typeof assessment];
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
      schema: "oratlas/challenge-subject/1",
      type: subject.type,
      reviewVersionId,
      assessmentId: assessment.id,
      relationId: assessment.claimEvidenceRelationId,
      protocolVersion: assessment.protocolVersion,
      assessorType: assessment.assessorType,
      assessorId: assessment.assessorId,
      assessedAt: assessment.assessedAt,
      criterion: subject.criterion,
      criterionValue,
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

export async function createChallenge(
  slug: string,
  actor: SessionUser,
  input: CreateChallengeInput,
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const version = await tx.reviewVersion.findFirst({
      where: { id: input.reviewVersionId, review: { slug, status: "published" } },
      include: { snapshot: { select: { commitSha: true } } },
    });
    if (!version) throw new ChallengeError("Review version not found.", "not-found");
    if (
      !isReadablePublicState(version.publicState) ||
      !version.publishedAt ||
      !version.snapshot ||
      !isExactCommitSha(version.snapshot.commitSha)
    ) {
      throw new ChallengeError("Challenges are closed on this review version.", "forbidden");
    }
    const subject = await resolveChallengeSubject(tx, version.id, input.subject);
    if (subject.hash !== input.canonicalSubjectHash) {
      throw new ChallengeError(
        "Challenge subject changed or its canonical hash is invalid.",
        "conflict",
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
      },
    });
    await tx.challengeTransition.create({
      data: {
        challengeId: challenge.id,
        fromStatus: null,
        toStatus: "open",
        actorId: actor.id,
        actorRoleSnapshot: actor.role,
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
          grounds: input.grounds,
          reviewVersionId: version.id,
          subjectType: subject.type,
        }),
      },
    });
    return { id: challenge.id };
  });
}

export async function listChallengeSubjectOptions(
  reviewVersionId: string,
): Promise<ChallengeSubjectOption[]> {
  const version = await prisma.reviewVersion.findUnique({
    where: { id: reviewVersionId },
    select: {
      publicState: true,
      claims: {
        orderBy: { localClaimId: "asc" },
        select: {
          id: true,
          evidenceRelations: {
            orderBy: { id: "asc" },
            select: {
              id: true,
              trustAssessments: { orderBy: { id: "asc" }, select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!version || !isReadablePublicState(version.publicState)) return [];
  const inputs: ChallengeSubjectInput[] = [];
  for (const claim of version.claims) {
    inputs.push({ type: "claim", claimId: claim.id });
    for (const relation of claim.evidenceRelations) {
      inputs.push({ type: "relation", relationId: relation.id });
      for (const assessment of relation.trustAssessments) {
        for (const criterion of TRUST_CRITERIA) {
          inputs.push({ type: "assessment-criterion", assessmentId: assessment.id, criterion });
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
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.challenge.findUnique({ where: { id: challengeId } });
    if (!challenge) throw new ChallengeError("Challenge not found.", "not-found");
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
        throw new ChallengeError("Only the challenger may withdraw this challenge.", "forbidden");
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
      data: { status: input.toStatus, revision },
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
          rationale: input.rationale,
          revision,
          toStatus: input.toStatus,
        }),
      },
    });
    return { revision, status: input.toStatus };
  });
}

export async function listChallenges(
  slug: string,
  reviewVersionId: string,
): Promise<ChallengeList | null> {
  const version = await prisma.reviewVersion.findFirst({
    where: { id: reviewVersionId, review: { slug, status: "published" } },
    select: { id: true, publicState: true },
  });
  if (!version || !isReadablePublicState(version.publicState)) return null;
  const rows = await prisma.challenge.findMany({
    where: { reviewVersionId },
    orderBy: { createdAt: "asc" },
    include: {
      challenger: true,
      transitions: { include: { actor: true }, orderBy: { revision: "asc" } },
    },
  });
  const challenges: PublicChallenge[] = [];
  for (const row of rows) {
    const input = rowSubject(row);
    if (!input) continue;
    try {
      const subject = await resolveChallengeSubject(prisma, reviewVersionId, input);
      if (subject.hash !== row.canonicalSubjectHash || subject.refJson !== row.subjectRefJson)
        continue;
      challenges.push({
        id: row.id,
        reviewVersionId,
        subjectType: subject.type,
        subjectLabel: subject.label,
        subjectHref: `/reviews/${encodeURIComponent(slug)}/versions/${encodeURIComponent(reviewVersionId)}#${subject.hrefFragment}`,
        canonicalSubjectHash: row.canonicalSubjectHash,
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
