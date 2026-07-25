export interface AdminBootstrapUser {
  id: string;
  role: string;
}

export interface AdminBootstrapDatabase {
  user: {
    update(args: { where: { id: string }; data: { role: "ADMIN" } }): Promise<AdminBootstrapUser>;
  };
}

/**
 * Promote an OAuth user only when GitHub's verified immutable numeric ID is
 * explicitly configured. Existing administrators are never demoted.
 */
export async function bootstrapAdminForGithubIdentity(
  db: AdminBootstrapDatabase,
  user: AdminBootstrapUser,
  githubUserId: string,
  allowedGithubUserIds: readonly string[],
): Promise<{ user: AdminBootstrapUser; promoted: boolean }> {
  if (user.role === "ADMIN" || !allowedGithubUserIds.includes(githubUserId)) {
    return { user, promoted: false };
  }

  return {
    user: await db.user.update({
      where: { id: user.id },
      data: { role: "ADMIN" },
    }),
    promoted: true,
  };
}
