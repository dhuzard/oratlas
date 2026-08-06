import "server-only";
import {
  canonicalJson,
  challengeContentStatusSchema,
  conflictOfInterestStatusSchema,
  TRUST_CRITERIA,
  type ChallengeContentStatus,
  type ChallengeList,
  type ChallengeStatus,
  type ChallengeSubjectInput,
  type NodeChallengeList,
  type PublicChallenge,
} from "@oratlas/contracts";
import { prisma } from "./db";
import { readablePublicNodeVersionWhere } from "./public-snapshot-visibility";
import {
  ACTIVE_CHALLENGE_STATUSES,
  ChallengeError,
  type ChallengeQueueItem,
  type ChallengeQueuePage,
  type ChallengeSubjectOption,
  MAX_NODE_CHALLENGE_CONTAINERS,
  MAX_NODE_CHALLENGE_PAGE_SIZE,
} from "./challenge-contract";
import {
  adjudicationChallengeBinding,
  assertChallengeContainerReadable,
  assertChallengeLedger,
  assertChallengeResponseIntegrity,
  expectedActiveKeyForRow,
  hashChallengeResponse,
  isActiveChallengeStatus,
  isExactChallengeVersion,
  isPersistedCriterion,
  mapChallengeTransactionError,
  reconcileActiveChallengeGroup,
} from "./challenge-ledger";
import {
  assertChallengeSubjectIntegrity,
  resolveChallengeSubject,
  rowSubject,
} from "./challenge-subjects";

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
