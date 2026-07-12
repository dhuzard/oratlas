import { normalizeGitHubLogin } from "@oratlas/contracts";

export interface LoginNormalizationRow {
  id: string;
  githubLogin: string;
  githubLoginNormalized: string | null;
}

export interface LoginNormalizationConflict {
  normalizedLogin: string;
  userIds: string[];
  githubLogins: string[];
  reason: "case-collision" | "inconsistent-value";
}

export interface LoginNormalizationPlan {
  updates: Array<{ id: string; githubLoginNormalized: string }>;
  conflicts: LoginNormalizationConflict[];
}

/**
 * Plan a no-loss backfill for the transitional normalized-login column.
 * No updates are returned when any collision or inconsistent stored value is
 * present, allowing callers to apply the plan atomically or fail closed.
 */
export function planGithubLoginNormalization(
  users: LoginNormalizationRow[],
): LoginNormalizationPlan {
  const groups = new Map<string, LoginNormalizationRow[]>();
  for (const user of users) {
    const normalized = normalizeGitHubLogin(user.githubLogin);
    const group = groups.get(normalized) ?? [];
    group.push(user);
    groups.set(normalized, group);
  }

  const conflicts: LoginNormalizationConflict[] = [];
  const usersInCollision = new Set<string>();
  for (const [normalizedLogin, group] of groups) {
    if (group.length < 2) continue;
    group.forEach((user) => usersInCollision.add(user.id));
    conflicts.push({
      normalizedLogin,
      userIds: group.map((user) => user.id),
      githubLogins: group.map((user) => user.githubLogin),
      reason: "case-collision",
    });
  }

  for (const user of users) {
    const expected = normalizeGitHubLogin(user.githubLogin);
    if (
      !usersInCollision.has(user.id) &&
      user.githubLoginNormalized !== null &&
      user.githubLoginNormalized !== expected
    ) {
      conflicts.push({
        normalizedLogin: expected,
        userIds: [user.id],
        githubLogins: [user.githubLogin],
        reason: "inconsistent-value",
      });
    }
  }

  if (conflicts.length > 0) return { updates: [], conflicts };
  return {
    updates: users
      .filter((user) => user.githubLoginNormalized === null)
      .map((user) => ({
        id: user.id,
        githubLoginNormalized: normalizeGitHubLogin(user.githubLogin),
      })),
    conflicts: [],
  };
}
