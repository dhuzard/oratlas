import { describe, expect, it } from "vitest";
import {
  GitHubIdentityConflictError,
  resolveGitHubIdentity,
  resolveGitHubIdentityWithRaceRecovery,
  type GitHubIdentityDatabase,
  type GitHubIdentityTransaction,
  type GitHubIdentityUser,
} from "./github-identity.js";

function fakeTransaction(
  initial: GitHubIdentityUser[] = [],
  options: { p2002OnCreateWith?: GitHubIdentityUser } = {},
) {
  const rows = initial.map((row) => ({ ...row }));
  const tx: GitHubIdentityTransaction = {
    user: {
      async findMany() {
        return rows;
      },
      async update({ where, data }) {
        const row = rows.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      async create({ data }) {
        if (options.p2002OnCreateWith) {
          rows.push({ ...options.p2002OnCreateWith });
          throw { code: "P2002" };
        }
        const row: GitHubIdentityUser = { id: `user-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      },
    },
  };
  return { tx, rows };
}

function fakeDatabase(
  initial: GitHubIdentityUser[] = [],
  options: { p2002OnCreateWith?: GitHubIdentityUser } = {},
) {
  const { tx, rows } = fakeTransaction(initial, options);
  const db: GitHubIdentityDatabase = {
    user: {
      async findFirst({ where }) {
        return rows.find((row) => row.githubUserId === where.githubUserId) ?? null;
      },
    },
    async $transaction(work) {
      return work(tx);
    },
  };
  return { db, rows };
}

const profile = {
  githubUserId: "42",
  githubLogin: "New-Login",
  displayName: "New Login",
  profileUrl: "https://github.com/New-Login",
};

describe("resolveGitHubIdentity", () => {
  it("updates a renamed login by immutable id without changing its role", async () => {
    const { tx } = fakeTransaction([
      {
        id: "editor-1",
        githubUserId: "42",
        githubLogin: "old-login",
        githubLoginNormalized: "old-login",
        role: "EDITOR",
      },
    ]);

    const result = await resolveGitHubIdentity(tx, profile);

    expect(result.id).toBe("editor-1");
    expect(result.githubLogin).toBe("New-Login");
    expect(result.githubLoginNormalized).toBe("new-login");
    expect(result.role).toBe("EDITOR");
  });

  it("creates an unseen immutable identity with the least-privileged role", async () => {
    const { tx } = fakeTransaction();
    const result = await resolveGitHubIdentity(tx, profile);
    expect(result.githubUserId).toBe("42");
    expect(result.role).toBe("USER");
  });

  it("rejects a login owned by a different immutable identity", async () => {
    const { tx } = fakeTransaction([
      {
        id: "admin-1",
        githubUserId: "7",
        githubLogin: "new-login",
        githubLoginNormalized: "new-login",
        role: "ADMIN",
      },
    ]);

    await expect(resolveGitHubIdentity(tx, profile)).rejects.toBeInstanceOf(
      GitHubIdentityConflictError,
    );
  });

  it("does not claim a legacy privileged account that lacks an immutable id", async () => {
    const { tx } = fakeTransaction([
      {
        id: "legacy-editor",
        githubUserId: null,
        githubLogin: "NEW-LOGIN",
        githubLoginNormalized: null,
        role: "EDITOR",
      },
    ]);

    await expect(resolveGitHubIdentity(tx, profile)).rejects.toBeInstanceOf(
      GitHubIdentityConflictError,
    );
  });

  it("fails closed when case-colliding legacy users have not been backfilled", async () => {
    const initial = [
      {
        id: "legacy-editor",
        githubUserId: null,
        githubLogin: "New-Login",
        githubLoginNormalized: null,
        role: "EDITOR",
      },
      {
        id: "legacy-user",
        githubUserId: null,
        githubLogin: "NEW-LOGIN",
        githubLoginNormalized: null,
        role: "USER",
      },
    ];
    const { tx, rows } = fakeTransaction(initial);

    await expect(resolveGitHubIdentity(tx, profile)).rejects.toBeInstanceOf(
      GitHubIdentityConflictError,
    );
    expect(rows.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: "legacy-editor", role: "EDITOR" },
      { id: "legacy-user", role: "USER" },
    ]);
  });

  it("backfills the transitional column only for the matching immutable identity", async () => {
    const { tx } = fakeTransaction([
      {
        id: "editor-1",
        githubUserId: "42",
        githubLogin: "New-Login",
        githubLoginNormalized: null,
        role: "EDITOR",
      },
    ]);

    const result = await resolveGitHubIdentity(tx, profile);
    expect(result.githubLoginNormalized).toBe("new-login");
    expect(result.role).toBe("EDITOR");
  });
});

describe("resolveGitHubIdentityWithRaceRecovery", () => {
  it("accepts a concurrent winner only for the same immutable id and normalized login", async () => {
    const concurrent: GitHubIdentityUser = {
      id: "concurrent-user",
      githubUserId: "42",
      githubLogin: "NEW-LOGIN",
      githubLoginNormalized: "new-login",
      role: "USER",
    };
    const { db } = fakeDatabase([], { p2002OnCreateWith: concurrent });

    const result = await resolveGitHubIdentityWithRaceRecovery(db, profile);
    expect(result).toEqual(concurrent);
  });

  it("rejects a P2002 winner whose normalized login does not match", async () => {
    const { db } = fakeDatabase([], {
      p2002OnCreateWith: {
        id: "concurrent-user",
        githubUserId: "42",
        githubLogin: "other-login",
        githubLoginNormalized: "other-login",
        role: "USER",
      },
    });

    await expect(resolveGitHubIdentityWithRaceRecovery(db, profile)).rejects.toBeInstanceOf(
      GitHubIdentityConflictError,
    );
  });
});
