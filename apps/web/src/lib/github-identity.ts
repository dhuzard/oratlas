import { normalizeGitHubLogin } from "@oratlas/contracts";

export interface GitHubIdentityProfile {
  githubUserId: string;
  githubLogin: string;
  displayName: string;
  avatarUrl?: string;
  profileUrl?: string;
}

export interface GitHubIdentityUser {
  id: string;
  githubUserId: string | null;
  githubLogin: string;
  githubLoginNormalized: string | null;
  role: string;
}

type ImmutableIdentityWhere = { githubUserId: string };

type IdentityUpdateData = {
  githubLogin?: string;
  githubLoginNormalized?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
};

export interface GitHubIdentityTransaction {
  user: {
    findMany(): Promise<GitHubIdentityUser[]>;
    update(args: { where: { id: string }; data: IdentityUpdateData }): Promise<GitHubIdentityUser>;
    create(args: {
      data: {
        githubUserId: string;
        githubLogin: string;
        githubLoginNormalized: string;
        displayName: string;
        avatarUrl?: string;
        profileUrl?: string;
        role: "USER";
      };
    }): Promise<GitHubIdentityUser>;
  };
}

export interface GitHubIdentityDatabase {
  user: {
    findFirst(args: { where: ImmutableIdentityWhere }): Promise<GitHubIdentityUser | null>;
  };
  $transaction<T>(work: (tx: GitHubIdentityTransaction) => Promise<T>): Promise<T>;
}

export class GitHubIdentityConflictError extends Error {
  constructor() {
    super("GitHub login is already associated with another local account.");
    this.name = "GitHubIdentityConflictError";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Resolve OAuth identity only through GitHub's immutable numeric user id.
 * A mutable login may be refreshed for the same id, but it can never attach a
 * new GitHub identity to an existing local account (and inherit its role).
 */
export async function resolveGitHubIdentity(
  tx: GitHubIdentityTransaction,
  profile: GitHubIdentityProfile,
): Promise<GitHubIdentityUser> {
  const githubLoginNormalized = normalizeGitHubLogin(profile.githubLogin);
  const users = await tx.user.findMany();
  const byId = users.find((user) => user.githubUserId === profile.githubUserId) ?? null;
  // During the nullable upgrade window, compute the comparison key from every
  // legacy login. Never rely on a possibly-unpopulated transitional column.
  const loginOwners = users.filter(
    (user) =>
      normalizeGitHubLogin(user.githubLogin) === githubLoginNormalized ||
      user.githubLoginNormalized === githubLoginNormalized,
  );

  if (loginOwners.some((owner) => owner.id !== byId?.id)) {
    throw new GitHubIdentityConflictError();
  }

  const commonData = {
    githubLogin: profile.githubLogin,
    githubLoginNormalized,
    displayName: profile.displayName,
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    ...(profile.profileUrl ? { profileUrl: profile.profileUrl } : {}),
  };

  if (byId) {
    return tx.user.update({ where: { id: byId.id }, data: commonData });
  }
  return tx.user.create({
    data: {
      githubUserId: profile.githubUserId,
      ...commonData,
      role: "USER",
    },
  });
}

/**
 * Run identity resolution transactionally. If a concurrent callback wins a
 * unique-key race, reconcile outside the failed transaction (required by
 * PostgreSQL) and accept only the same immutable id with the exact normalized
 * login. Every other race fails closed.
 */
export async function resolveGitHubIdentityWithRaceRecovery(
  db: GitHubIdentityDatabase,
  profile: GitHubIdentityProfile,
): Promise<GitHubIdentityUser> {
  try {
    return await db.$transaction((tx) => resolveGitHubIdentity(tx, profile));
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const raced = await db.user.findFirst({
      where: { githubUserId: profile.githubUserId },
    });
    const expectedLogin = normalizeGitHubLogin(profile.githubLogin);
    if (
      raced &&
      raced.githubLoginNormalized === expectedLogin &&
      normalizeGitHubLogin(raced.githubLogin) === expectedLogin
    ) {
      return raced;
    }
    throw new GitHubIdentityConflictError();
  }
}
