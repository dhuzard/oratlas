import { describe, expect, it } from "vitest";
import { reviewLifecycleMutationSchema } from "./lifecycle.js";
import { commitShaSchema, isExactCommitSha } from "./identifiers.js";

describe("review lifecycle contracts", () => {
  it("requires exact non-zero commit object ids", () => {
    expect(isExactCommitSha("a".repeat(40))).toBe(true);
    expect(isExactCommitSha("b".repeat(64))).toBe(true);
    expect(commitShaSchema.safeParse("0".repeat(40)).success).toBe(false);
    expect(isExactCommitSha("main")).toBe(false);
  });

  it("requires correction supersession and rejects it for other events", () => {
    const base = {
      reviewSlug: "review",
      reviewVersionId: "v2",
      reason: "A sufficiently specific public lifecycle reason.",
      expectedRevision: 0,
    };
    expect(
      reviewLifecycleMutationSchema.safeParse({
        ...base,
        kind: "correction",
        supersedesVersionId: "v1",
      }).success,
    ).toBe(true);
    expect(reviewLifecycleMutationSchema.safeParse({ ...base, kind: "correction" }).success).toBe(
      false,
    );
    expect(
      reviewLifecycleMutationSchema.safeParse({
        ...base,
        kind: "tombstone",
        supersedesVersionId: "v1",
      }).success,
    ).toBe(false);
  });
});
