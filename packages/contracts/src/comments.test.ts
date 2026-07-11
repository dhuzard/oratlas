import { describe, expect, it } from "vitest";
import {
  COMMENT_BODY_MAX,
  COMMENT_KINDS,
  createCommentInputSchema,
  reviewCommentListSchema,
} from "./comments.js";

describe("createCommentInputSchema", () => {
  it("accepts a minimal comment and defaults the kind", () => {
    const parsed = createCommentInputSchema.parse({ body: "Interesting result." });
    expect(parsed.kind).toBe("comment");
    expect(parsed.claimLocalId).toBeUndefined();
    expect(parsed.parentId).toBeUndefined();
  });

  it("trims the body and rejects whitespace-only bodies", () => {
    expect(createCommentInputSchema.parse({ body: "  ok  " }).body).toBe("ok");
    expect(createCommentInputSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(createCommentInputSchema.safeParse({ body: "" }).success).toBe(false);
  });

  it("bounds the body length", () => {
    expect(createCommentInputSchema.safeParse({ body: "x".repeat(COMMENT_BODY_MAX) }).success).toBe(
      true,
    );
    expect(
      createCommentInputSchema.safeParse({ body: "x".repeat(COMMENT_BODY_MAX + 1) }).success,
    ).toBe(false);
  });

  it("accepts every documented kind and rejects unknown kinds", () => {
    for (const kind of COMMENT_KINDS) {
      expect(createCommentInputSchema.safeParse({ body: "b", kind }).success).toBe(true);
    }
    expect(createCommentInputSchema.safeParse({ body: "b", kind: "rant" }).success).toBe(false);
  });

  it("accepts claim anchoring and replies", () => {
    const parsed = createCommentInputSchema.parse({
      body: "Anchored reply",
      kind: "concern",
      claimLocalId: "claim-002",
      parentId: "cmt_123",
    });
    expect(parsed.claimLocalId).toBe("claim-002");
    expect(parsed.parentId).toBe("cmt_123");
  });
});

describe("reviewCommentListSchema", () => {
  it("validates a threaded list payload", () => {
    const payload = {
      reviewSlug: "some-review",
      commentCount: 2,
      comments: [
        {
          id: "c1",
          kind: "question",
          status: "visible",
          body: "How was the baseline chosen?",
          author: { githubLogin: "alice", displayName: "Alice", role: "USER" },
          claimLocalId: "claim-001",
          claimAnchor: "replay-claim-1",
          createdAt: "2026-07-01T00:00:00.000Z",
          replies: [
            {
              id: "c2",
              kind: "comment",
              status: "visible",
              body: "See section 3.",
              author: { githubLogin: "bob", displayName: null, role: "EDITOR" },
              createdAt: "2026-07-02T00:00:00.000Z",
            },
          ],
        },
      ],
    };
    expect(reviewCommentListSchema.safeParse(payload).success).toBe(true);
  });
});
