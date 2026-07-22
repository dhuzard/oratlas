import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const tx = {
    review: { findUnique: vi.fn(), updateMany: vi.fn() },
    reviewVersion: { updateMany: vi.fn() },
    claim: { findUnique: vi.fn() },
    reviewComment: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  return {
    tx,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("./db", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { createReviewComment, removeReviewComment } from "./comments";

const actor = {
  id: "user-1",
  githubLogin: "reader",
  displayName: null,
  avatarUrl: null,
  profileUrl: null,
  role: "USER" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.review.findUnique.mockResolvedValue({
    id: "review-1",
    status: "published",
    lifecycleRevision: 7,
    currentSnapshotId: "snapshot-1",
    versions: [
      {
        id: "version-1",
        publicState: "published",
        publishedAt: new Date("2026-07-01T00:00:00.000Z"),
        snapshot: { commitSha: "a".repeat(40) },
      },
    ],
  });
  mocks.tx.review.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.reviewVersion.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.reviewComment.create.mockResolvedValue({ id: "comment-1" });
  mocks.tx.reviewComment.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.auditEvent.create.mockResolvedValue({ id: "audit-1" });
});

describe("comment removal race", () => {
  beforeEach(() => {
    mocks.tx.reviewComment.findUnique.mockResolvedValue({
      id: "comment-1",
      authorId: actor.id,
      status: "visible",
      review: { slug: "review" },
    });
  });

  it("commits the visible-status CAS and audit in one transaction", async () => {
    await expect(removeReviewComment("comment-1", actor)).resolves.toBeUndefined();

    expect(mocks.tx.reviewComment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "comment-1", status: "visible" } }),
    );
    expect(mocks.tx.auditEvent.create).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("emits only one audit when concurrent removers race", async () => {
    mocks.tx.reviewComment.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await Promise.all([
      removeReviewComment("comment-1", actor),
      removeReviewComment("comment-1", actor),
    ]);

    expect(mocks.tx.reviewComment.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.tx.auditEvent.create).toHaveBeenCalledOnce();
  });
});

describe("comment/lifecycle race", () => {
  it("rejects instead of inserting when a tombstone changes the lifecycle after the read", async () => {
    mocks.tx.review.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      createReviewComment("review", actor, {
        kind: "comment",
        body: "This comment raced with a tombstone.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.tx.reviewComment.create).not.toHaveBeenCalled();
    expect(mocks.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it("commits the state claims, comment and audit in one transaction", async () => {
    await expect(
      createReviewComment("review", actor, {
        kind: "comment",
        body: "This comment holds a valid lifecycle state claim.",
      }),
    ).resolves.toEqual({ id: "comment-1" });
    expect(mocks.tx.review.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lifecycleRevision: 7 }),
      }),
    );
    expect(mocks.tx.reviewVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ publicState: "published" }),
      }),
    );
    expect(mocks.tx.reviewComment.create).toHaveBeenCalledOnce();
    expect(mocks.tx.auditEvent.create).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
});
