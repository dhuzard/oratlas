import "server-only";
import { prisma } from "./db";
import { isEditor, type SessionUser } from "./auth";
import type { Db } from "./challenge-contract";
import { publicNodeChallengeContainer } from "./challenge-ledger";

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

export async function contributorOfRecord(
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

export async function nodeContributorOfRecord(
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

export async function isNodeChallengeContributorOfRecord(
  nodeEdgeProposalIds: readonly string[],
  actor: SessionUser,
): Promise<boolean> {
  for (const id of nodeEdgeProposalIds) {
    if (await nodeContributorOfRecord(prisma, id, actor)) return true;
  }
  return false;
}
