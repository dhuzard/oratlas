import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const tx = {
    review: { findUnique: vi.fn(), updateMany: vi.fn() },
    reviewVersion: { update: vi.fn() },
    reviewLifecycleEvent: { findUnique: vi.fn(), create: vi.fn() },
    idempotencyKey: { findUnique: vi.fn(), create: vi.fn() },
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

import { recordReviewLifecycleEvent } from "./review-lifecycle";

const targetSnapshotId = "snapshot-current";
const targetVersionId = "version-current";
const priorVersionId = "version-prior";
const correction = {
  reviewSlug: "review",
  reviewVersionId: targetVersionId,
  supersedesVersionId: priorVersionId,
  kind: "correction" as const,
  reason: "The current accepted version corrects the prior scholarly record.",
  expectedRevision: 7,
};

function reviewRow(currentSnapshotId = targetSnapshotId) {
  return {
    id: "review-1",
    status: "published",
    currentSnapshotId,
    lifecycleRevision: 7,
    versions: [
      {
        id: targetVersionId,
        snapshotId: targetSnapshotId,
        publicState: "published",
        publishedAt: new Date("2026-07-02T00:00:00.000Z"),
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
        snapshot: { commitSha: "a".repeat(40) },
      },
      {
        id: priorVersionId,
        snapshotId: "snapshot-prior",
        publicState: "published",
        publishedAt: new Date("2026-07-01T00:00:00.000Z"),
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        snapshot: { commitSha: "b".repeat(40) },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.review.findUnique.mockResolvedValue(reviewRow());
  mocks.tx.review.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.idempotencyKey.findUnique.mockResolvedValue(null);
});

describe("lifecycle/current-version races", () => {
  it("rejects a correction whose target is no longer the current snapshot", async () => {
    mocks.tx.review.findUnique.mockResolvedValue(reviewRow("newly-accepted-snapshot"));

    await expect(recordReviewLifecycleEvent(correction, "editor-1")).rejects.toMatchObject({
      code: "bad-request",
    });

    expect(mocks.tx.review.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.reviewLifecycleEvent.create).not.toHaveBeenCalled();
    expect(mocks.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it("loses the CAS cleanly when acceptance changes the current snapshot after the read", async () => {
    mocks.tx.review.updateMany.mockResolvedValue({ count: 0 });

    await expect(recordReviewLifecycleEvent(correction, "editor-1")).rejects.toMatchObject({
      code: "conflict",
    });

    expect(mocks.tx.review.updateMany).toHaveBeenCalledWith({
      where: {
        id: "review-1",
        lifecycleRevision: 7,
        currentSnapshotId: targetSnapshotId,
      },
      data: { lifecycleRevision: 8 },
    });
    expect(mocks.tx.reviewLifecycleEvent.create).not.toHaveBeenCalled();
    expect(mocks.tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
