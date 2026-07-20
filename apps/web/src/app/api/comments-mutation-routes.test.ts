import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createReviewComment: vi.fn(),
  removeReviewComment: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth", () => ({
  getServerEnv: () => ({ NEXT_PUBLIC_BASE_URL: "https://atlas.example" }),
  requireUser: mocks.requireUser,
  isEditor: () => false,
}));

vi.mock("@/lib/comments", () => ({
  CommentError: class CommentError extends Error {
    code = "bad-request" as const;
  },
  createReviewComment: mocks.createReviewComment,
  listReviewComments: vi.fn(),
  removeReviewComment: mocks.removeReviewComment,
}));

vi.mock("@/lib/rate-limit", () => ({
  clientKey: () => "test:comments",
  rateLimit: () => ({ ok: true }),
}));

import { DELETE } from "./comments/[id]/route";
import { POST } from "./reviews/[slug]/comments/route";

const user = {
  id: "user-1",
  githubLogin: "reader",
  displayName: null,
  avatarUrl: null,
  profileUrl: null,
  role: "USER" as const,
};

describe("comment mutation request integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(user);
    mocks.createReviewComment.mockResolvedValue({ id: "comment-1" });
    mocks.removeReviewComment.mockResolvedValue(undefined);
  });

  it("rejects a cross-origin comment POST before authentication or domain work", async () => {
    const response = await POST(
      new Request("https://atlas.example/api/reviews/review/comments", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ kind: "comment", body: "A valid comment body." }),
      }),
      { params: Promise.resolve({ slug: "review" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.createReviewComment).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin comment DELETE before authentication or domain work", async () => {
    const response = await DELETE(
      new Request("https://atlas.example/api/comments/comment-1", {
        method: "DELETE",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "cross-site",
        },
        body: "{}",
      }),
      { params: Promise.resolve({ id: "comment-1" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.removeReviewComment).not.toHaveBeenCalled();
  });

  it("allows the JSON DELETE shape emitted by CommentsSection", async () => {
    const response = await DELETE(
      new Request("https://atlas.example/api/comments/comment-1", {
        method: "DELETE",
        headers: {
          Origin: "https://atlas.example",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
        },
        body: "{}",
      }),
      { params: Promise.resolve({ id: "comment-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.removeReviewComment).toHaveBeenCalledWith("comment-1", user);
  });
});
