import "server-only";
import {
  canonicalJson,
  isLegalChallengeTransition,
  type ChallengeStatus,
  type CreateChallengeInput,
  type CreateChallengeResponseInput,
  type ModerateChallengeContentInput,
  type TransitionChallengeInput,
} from "@oratlas/contracts";
import { prisma } from "./db";
import { isEditor, type SessionUser } from "./auth";
import {
  ACTIVE_CHALLENGE_STATUSES,
  CHALLENGE_TRANSACTION_ATTEMPTS,
  ChallengeError,
  MAX_ACTIVE_CHALLENGES_PER_SUBJECT,
} from "./challenge-contract";
import {
  contributorOfRecord,
  hasChallengeResolutionAuthority,
  nodeContributorOfRecord,
} from "./challenge-authorization";
import {
  activeChallengerSubjectKey,
  assertChallengeContainerReadable,
  assertChallengeLedger,
  assertChallengeResponseIntegrity,
  expectedActiveKeyForRow,
  hashChallengeResponse,
  hashFiledContent,
  isActiveChallengeStatus,
  isExactChallengeVersion,
  mapChallengeTransactionError,
  prismaErrorCode,
  publicNodeChallengeContainer,
  reconcileActiveChallengeGroup,
} from "./challenge-ledger";
import {
  assertChallengeSubjectIntegrity,
  resolveChallengeSubject,
  rowSubject,
} from "./challenge-subjects";

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
