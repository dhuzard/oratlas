import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const tx = {
    review: { findUnique: vi.fn(), updateMany: vi.fn() },
    reviewVersion: { updateMany: vi.fn() },
    user: { findMany: vi.fn() },
    claim: { findUnique: vi.fn() },
    reviewComment: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    notification: { createMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  return {
    tx,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("./db", () => ({
  prisma: { $transaction: mocks.transaction },
  parseJsonColumn: (value: string | null, fallback: unknown) =>
    value === null ? fallback : JSON.parse(value),
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
        snapshot: {
          commitSha: "a".repeat(40),
          preservedFilesJson: JSON.stringify({
            "review.md": { size: 9, truncated: false, content: "# Review\n" },
            "notes.md": { size: 13, truncated: false, content: "# Private note" },
          }),
          repository: { owner: "lab", name: "review" },
        },
        sourceSubmission: { submitterId: "user-2" },
        contributors: [{ person: { githubLogin: "review-author" } }],
      },
    ],
  });
  mocks.tx.review.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.reviewVersion.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.reviewComment.create.mockResolvedValue({ id: "comment-1" });
  mocks.tx.reviewComment.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.auditEvent.create.mockResolvedValue({ id: "audit-1" });
  mocks.tx.notification.createMany.mockResolvedValue({ count: 1 });
  mocks.tx.user.findMany.mockResolvedValue([{ id: "user-3", githubLogin: "review-author" }]);
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

  it("stores a source-bound passage selector and notifies the depositor and linked author", async () => {
    const anchor = {
      schemaVersion: "1.0.0" as const,
      representation: "myst-rendered-text-v1" as const,
      documentPath: "review.md",
      sourceSha256: "60390e262951c11c87fb37a0bba58ec02f73889fe444964faf0037e3adce528a",
      textQuote: { type: "TextQuoteSelector" as const, exact: "Review" },
      textPosition: { type: "TextPositionSelector" as const, start: 0, end: 6 },
    };

    await expect(
      createReviewComment("review", actor, { kind: "question", body: "Why?", anchor }),
    ).resolves.toEqual({ id: "comment-1" });
    expect(mocks.tx.reviewComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetDocumentPath: "review.md",
        targetSelectorJson: expect.stringContaining('"TextQuoteSelector"'),
        targetSelectorHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
    expect(mocks.tx.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ userId: "user-2", kind: "review-comment-created" }),
        expect.objectContaining({ userId: "user-3", kind: "review-comment-created" }),
      ]),
    });
  });

  it("rejects a passage selector from a different source version", async () => {
    await expect(
      createReviewComment("review", actor, {
        kind: "concern",
        body: "This points elsewhere.",
        anchor: {
          schemaVersion: "1.0.0",
          representation: "myst-rendered-text-v1",
          documentPath: "review.md",
          sourceSha256: "f".repeat(64),
          textQuote: { type: "TextQuoteSelector", exact: "Review" },
          textPosition: { type: "TextPositionSelector", start: 0, end: 6 },
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.tx.reviewComment.create).not.toHaveBeenCalled();
  });

  it("rejects a selector whose quote is not in the canonical rendered page", async () => {
    await expect(
      createReviewComment("review", actor, {
        kind: "concern",
        body: "This quote was invented.",
        anchor: {
          schemaVersion: "1.0.0",
          representation: "myst-rendered-text-v1",
          documentPath: "review.md",
          sourceSha256: "60390e262951c11c87fb37a0bba58ec02f73889fe444964faf0037e3adce528a",
          textQuote: { type: "TextQuoteSelector", exact: "Fabric" },
          textPosition: { type: "TextPositionSelector", start: 0, end: 6 },
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.tx.reviewComment.create).not.toHaveBeenCalled();
  });

  it("rejects a preserved file that is not a rendered article page", async () => {
    await expect(
      createReviewComment("review", actor, {
        kind: "concern",
        body: "This file is outside the reader.",
        anchor: {
          schemaVersion: "1.0.0",
          representation: "myst-rendered-text-v1",
          documentPath: "notes.md",
          sourceSha256: "f".repeat(64),
          textQuote: { type: "TextQuoteSelector", exact: "Private" },
          textPosition: { type: "TextPositionSelector", start: 0, end: 7 },
        },
      }),
    ).rejects.toThrow("not a preserved rendered MyST page");
    expect(mocks.tx.reviewComment.create).not.toHaveBeenCalled();
  });
});
