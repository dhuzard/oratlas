import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allowed: true,
  create: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireUser: () =>
    Promise.resolve({
      id: "commenter-1",
      githubLogin: "commenter",
      displayName: null,
      avatarUrl: null,
      profileUrl: null,
      role: "USER",
    }),
}));
vi.mock("@/lib/comments", () => ({
  CommentError: class CommentError extends Error {
    code = "bad-request" as const;
  },
  createReviewComment: state.create,
  listReviewComments: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  clientKey: (_headers: Headers, suffix: string) => `test:${suffix}`,
  rateLimit: (...args: unknown[]) => {
    state.rateLimit(...args);
    return { ok: state.allowed, remaining: state.allowed ? 9 : 0, resetAt: Date.now() + 60_000 };
  },
}));

import { MAX_BODY_BYTES } from "@/lib/api";
import { POST } from "./route";

const params = { params: Promise.resolve({ slug: "bounded-review" }) };

describe("POST /api/reviews/{slug}/comments abuse boundaries", () => {
  beforeEach(() => {
    state.allowed = true;
    state.create.mockReset().mockResolvedValue({ id: "comment-1" });
    state.rateLimit.mockReset();
  });

  it("preserves the existing ten-per-minute authenticated comment budget", async () => {
    state.allowed = false;
    const response = await POST(
      new Request("https://oratlas.test/api/reviews/bounded-review/comments", {
        method: "POST",
        body: JSON.stringify({ body: "A bounded comment." }),
      }),
      params,
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: { code: "rate-limited", message: "Too many comments. Try again shortly." },
    });
    expect(state.rateLimit).toHaveBeenCalledWith("test:comment:commenter-1", 10, 60_000);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized body before parsing or storage", async () => {
    const response = await POST(
      new Request("https://oratlas.test/api/reviews/bounded-review/comments", {
        method: "POST",
        headers: { "content-length": String(MAX_BODY_BYTES + 1) },
        body: "{}",
      }),
      params,
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "payload-too-large", message: "Request body too large." },
    });
    expect(state.create).not.toHaveBeenCalled();
  });
});
