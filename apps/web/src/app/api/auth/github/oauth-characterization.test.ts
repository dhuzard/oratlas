import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  jar: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  fetch: vi.fn(),
  resolve: vi.fn(),
  createSession: vi.fn(),
  audit: vi.fn(),
  bootstrap: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => mocks.jar }));
vi.mock("@oratlas/config", () => ({ getServerEnv: () => mocks.env }));
vi.mock("@/lib/auth", () => ({ createSession: mocks.createSession }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/github-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github-identity")>();
  return { ...actual, resolveGitHubIdentityWithRaceRecovery: mocks.resolve };
});
vi.mock("@/lib/admin-bootstrap", () => ({ bootstrapAdminForGithubIdentity: mocks.bootstrap }));

import { GET as start } from "./start/route";
import { GET as callback } from "./callback/route";

beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.jar.get.mockReset();
  mocks.jar.set.mockReset();
  mocks.jar.delete.mockReset();
  mocks.fetch.mockReset();
  mocks.resolve.mockReset();
  mocks.createSession.mockReset();
  mocks.audit.mockReset();
  mocks.bootstrap.mockReset();
});

const configured = () => {
  mocks.env = {
    githubOauthEnabled: true,
    isProduction: false,
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    NEXT_PUBLIC_BASE_URL: "https://atlas.example",
    adminGithubUserIds: [],
  };
};

describe("GitHub OAuth route characterization", () => {
  it("does not redirect or set state when OAuth is disabled", async () => {
    mocks.env = { githubOauthEnabled: false };
    const response = await start();
    expect(response.status).toBe(400);
    expect(mocks.jar.set).not.toHaveBeenCalled();
  });

  it("uses a secure state cookie in production", async () => {
    configured();
    mocks.env.isProduction = true;
    await start();
    expect(mocks.jar.set.mock.calls[0]?.[2]).toMatchObject({ secure: true });
  });

  it("starts configured OAuth with read:user and matching state cookie", async () => {
    configured();
    const response = await start();
    const location = new URL(response.headers.get("location")!);
    const cookie = mocks.jar.set.mock.calls[0]!;
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://atlas.example/api/auth/github/callback",
    );
    expect(location.searchParams.get("scope")).toBe("read:user");
    expect(location.searchParams.get("state")).toMatch(/^[a-f0-9]{32}$/);
    expect(cookie[0]).toBe("oratlas_oauth_state");
    expect(cookie[1]).toBe(location.searchParams.get("state"));
    expect(cookie[2]).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 600,
    });
  });

  it.each([
    ["missing state", "code=abc", undefined],
    ["mismatched state", "code=abc&state=bad", "expected"],
    ["missing code", "state=expected", "expected"],
  ])("rejects %s and consumes the state cookie", async (_label, query, cookieState) => {
    configured();
    mocks.jar.get.mockReturnValue(cookieState ? { value: cookieState } : undefined);
    const response = await callback(
      new Request(`https://atlas.example/api/auth/github/callback?${query}`),
    );
    expect(response.status).toBe(400);
    expect(mocks.jar.delete).toHaveBeenCalledWith("oratlas_oauth_state");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects callback while OAuth is disabled", async () => {
    mocks.env = { githubOauthEnabled: false };
    const response = await callback(
      new Request("https://atlas.example/api/auth/github/callback?code=abc&state=state"),
    );
    expect(response.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("returns upstream errors for token and profile failures", async () => {
    configured();
    mocks.jar.get.mockReturnValue({ value: "state" });
    mocks.fetch.mockResolvedValueOnce({ json: async () => ({}) });
    const tokenFailure = await callback(
      new Request("https://atlas.example/api/auth/github/callback?code=abc&state=state"),
    );
    expect(tokenFailure.status).toBe(502);
    mocks.jar.get.mockReturnValue({ value: "state" });
    mocks.fetch
      .mockResolvedValueOnce({ json: async () => ({ access_token: "token" }) })
      .mockResolvedValueOnce({ ok: false });
    const profileFailure = await callback(
      new Request("https://atlas.example/api/auth/github/callback?code=abc&state=state"),
    );
    expect(profileFailure.status).toBe(502);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("rejects malformed provider identity", async () => {
    configured();
    mocks.jar.get.mockReturnValue({ value: "state" });
    mocks.fetch
      .mockResolvedValueOnce({ json: async () => ({ access_token: "token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 0, login: "bad login" }) });
    const response = await callback(
      new Request("https://atlas.example/api/auth/github/callback?code=abc&state=state"),
    );
    expect(response.status).toBe(502);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("audits identity conflicts and stops before bootstrap or session creation", async () => {
    configured();
    mocks.jar.get.mockReturnValue({ value: "state" });
    mocks.fetch
      .mockResolvedValueOnce({ json: async () => ({ access_token: "token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 42, login: "octo" }) });
    const { GitHubIdentityConflictError } = await import("@/lib/github-identity");
    mocks.resolve.mockRejectedValue(new GitHubIdentityConflictError());
    const response = await callback(
      new Request("https://atlas.example/api/auth/github/callback?code=abc&state=state"),
    );
    expect(response.status).toBe(409);
    expect(mocks.audit).toHaveBeenCalledWith(null, "auth.github-identity-conflict", "auth", "42", {
      githubLogin: "octo",
    });
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("exchanges token, resolves minimal profile, bootstraps, sessions, audits, and redirects", async () => {
    configured();
    mocks.jar.get.mockReturnValue({ value: "state" });
    mocks.fetch
      .mockResolvedValueOnce({ json: async () => ({ access_token: "token" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 42,
          login: "octo",
          name: "Octo",
          avatar_url: "avatar",
          html_url: "profile",
          email: "private@example.test",
        }),
      });
    mocks.resolve.mockResolvedValue({ id: "user-1", role: "USER" });
    mocks.bootstrap.mockResolvedValue({ user: { id: "user-1", role: "USER" }, promoted: false });
    const response = await callback(
      new Request("https://atlas.example/api/auth/github/callback?code=abc&state=state"),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://atlas.example/submit");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.resolve).toHaveBeenCalledWith(
      {},
      {
        githubUserId: "42",
        githubLogin: "octo",
        displayName: "Octo",
        avatarUrl: "avatar",
        profileUrl: "profile",
      },
    );
    expect(mocks.bootstrap).toHaveBeenCalledWith({}, { id: "user-1", role: "USER" }, "42", []);
    expect(mocks.createSession).toHaveBeenCalledWith("user-1");
    expect(mocks.audit).toHaveBeenCalledWith("user-1", "auth.github-login", "auth", "user-1", {});
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});
