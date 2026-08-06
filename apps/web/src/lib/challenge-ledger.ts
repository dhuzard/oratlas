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
  userRoleSchema,
  type ChallengeStatus,
} from "@oratlas/contracts";
import { sha256 } from "./hash";
import { isReadablePublicState } from "./review-lifecycle";
import { readablePublicNodeVersionWhere } from "./public-snapshot-visibility";
import { ACTIVE_CHALLENGE_STATUSES, ChallengeError, type Db } from "./challenge-contract";

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

export function isPersistedCriterion(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return trustCriterionAssessmentSchema.safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
}

export function hashFiledContent(row: ChallengeContent): string {
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
export function assertChallengeLedger(
  row: LedgerChallenge,
  expectedActiveKey: string | null,
): void {
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

export function activeChallengerSubjectKey(
  challengerId: string,
  canonicalSubjectHash: string,
): string {
  return sha256(
    canonicalJson({
      schema: "oratlas/active-challenger-subject/1",
      challengerId,
      canonicalSubjectHash,
    }),
  );
}

export function isActiveChallengeStatus(status: string): boolean {
  return ACTIVE_CHALLENGE_STATUSES.includes(status as (typeof ACTIVE_CHALLENGE_STATUSES)[number]);
}

/**
 * Adopt the portable active key for the deterministic oldest active row.
 * E01 deployments may already contain duplicate active rows. They remain
 * visible and transitionable; only the oldest row owns the unique key until it
 * becomes terminal, after which the next oldest row is adopted lazily.
 */
export async function reconcileActiveChallengeGroup(
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

export function expectedActiveKeyForRow(
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

export function prismaErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export function isExactChallengeVersion(version: {
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

export function adjudicationChallengeBinding(adjudication: {
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

export async function publicNodeChallengeContainer(
  db: Db,
  nodeEdgeProposalId: string,
  nodeId?: string,
) {
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

export async function assertChallengeContainerReadable(
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

export function mapChallengeTransactionError(error: unknown): never {
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

export function hashChallengeResponse(input: {
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

export function assertChallengeResponseIntegrity(
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
