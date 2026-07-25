import { describe, expect, it, vi } from "vitest";
import { bootstrapAdminForGithubIdentity, type AdminBootstrapDatabase } from "./admin-bootstrap";

describe("bootstrapAdminForGithubIdentity", () => {
  it("promotes an allowlisted immutable GitHub identity", async () => {
    const update = vi.fn().mockResolvedValue({ id: "user-1", role: "ADMIN" });
    const result = await bootstrapAdminForGithubIdentity(
      { user: { update } } as AdminBootstrapDatabase,
      { id: "user-1", role: "USER" },
      "48721374",
      ["48721374"],
    );

    expect(result).toEqual({ user: { id: "user-1", role: "ADMIN" }, promoted: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "ADMIN" },
    });
  });

  it("does not promote a login-like or different identity", async () => {
    const update = vi.fn();
    const result = await bootstrapAdminForGithubIdentity(
      { user: { update } } as unknown as AdminBootstrapDatabase,
      { id: "user-1", role: "USER" },
      "48721374",
      ["dhuzard", "123"],
    );

    expect(result.promoted).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("does not rewrite an existing administrator", async () => {
    const update = vi.fn();
    const result = await bootstrapAdminForGithubIdentity(
      { user: { update } } as unknown as AdminBootstrapDatabase,
      { id: "user-1", role: "ADMIN" },
      "48721374",
      ["48721374"],
    );

    expect(result.promoted).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
