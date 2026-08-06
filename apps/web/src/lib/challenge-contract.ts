import type {
  ChallengeContentStatus,
  ChallengeSubjectInput,
  PublicChallenge,
} from "@oratlas/contracts";
import type { Prisma } from "@oratlas/db";
import type { prisma } from "./db";

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
export const ACTIVE_CHALLENGE_STATUSES = ["open", "author-responded"] as const;
export const CHALLENGE_TRANSACTION_ATTEMPTS = 3;
export const MAX_NODE_CHALLENGE_CONTAINERS = 200;
export const MAX_NODE_CHALLENGE_PAGE_SIZE = 100;

export type Db = Prisma.TransactionClient | typeof prisma;

export type ResolvedSubject = {
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
