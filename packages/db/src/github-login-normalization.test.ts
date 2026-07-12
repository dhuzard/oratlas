import { describe, expect, it } from "vitest";
import { planGithubLoginNormalization } from "./github-login-normalization.js";

describe("planGithubLoginNormalization", () => {
  it("backfills unique legacy logins without changing identity or role data", () => {
    const plan = planGithubLoginNormalization([
      { id: "u1", githubLogin: "Alice-Science", githubLoginNormalized: null },
      { id: "u2", githubLogin: "Bob", githubLoginNormalized: "bob" },
    ]);

    expect(plan).toEqual({
      updates: [{ id: "u1", githubLoginNormalized: "alice-science" }],
      conflicts: [],
    });
  });

  it("fails the whole plan closed when legacy rows collide by case", () => {
    const plan = planGithubLoginNormalization([
      { id: "editor", githubLogin: "Atlas-User", githubLoginNormalized: null },
      { id: "user", githubLogin: "ATLAS-USER", githubLoginNormalized: null },
    ]);

    expect(plan.updates).toEqual([]);
    expect(plan.conflicts).toEqual([
      {
        normalizedLogin: "atlas-user",
        userIds: ["editor", "user"],
        githubLogins: ["Atlas-User", "ATLAS-USER"],
        reason: "case-collision",
      },
    ]);
  });

  it("refuses to overwrite an inconsistent existing normalized value", () => {
    const plan = planGithubLoginNormalization([
      { id: "u1", githubLogin: "Alice", githubLoginNormalized: "mallory" },
    ]);

    expect(plan.updates).toEqual([]);
    expect(plan.conflicts[0]?.reason).toBe("inconsistent-value");
  });
});
