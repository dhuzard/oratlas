import { describe, expect, it } from "vitest";
import {
  CHALLENGE_BODY_MAX,
  createChallengeInputSchema,
  isLegalChallengeTransition,
} from "./challenges.js";

describe("challenge contracts", () => {
  const valid = {
    reviewVersionId: "version-1",
    subject: { type: "claim" as const, claimId: "claim-1" },
    canonicalSubjectHash: "a".repeat(64),
    grounds: "entailment" as const,
    body: "The cited evidence does not entail this claim.",
  };

  it("accepts typed immutable subject inputs and bounded plain text", () => {
    expect(createChallengeInputSchema.parse(valid)).toEqual(valid);
    expect(
      createChallengeInputSchema.safeParse({ ...valid, body: "x".repeat(CHALLENGE_BODY_MAX + 1) })
        .success,
    ).toBe(false);
    expect(
      createChallengeInputSchema.safeParse({ ...valid, canonicalSubjectHash: "not-a-hash" })
        .success,
    ).toBe(false);
    expect(createChallengeInputSchema.safeParse({ ...valid, grounds: "truth" }).success).toBe(
      false,
    );
  });

  it("permits only the closed append-only lifecycle graph", () => {
    expect(isLegalChallengeTransition("open", "author-responded")).toBe(true);
    expect(isLegalChallengeTransition("author-responded", "resolved")).toBe(true);
    expect(isLegalChallengeTransition("open", "resolved")).toBe(false);
    expect(isLegalChallengeTransition("resolved", "withdrawn")).toBe(false);
    expect(isLegalChallengeTransition("open", "open")).toBe(false);
  });
});
