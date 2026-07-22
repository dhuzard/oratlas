import { describe, expect, it } from "vitest";
import {
  CHALLENGE_BODY_MAX,
  CHALLENGE_STATUSES,
  createChallengeInputSchema,
  createChallengeResponseInputSchema,
  moderateChallengeContentInputSchema,
  publicChallengeResponseSchema,
  challengeTransitionSchema,
  transitionChallengeInputSchema,
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
    const legal = new Set([
      "open>author-responded",
      "author-responded>resolved",
      "author-responded>dismissed",
      "author-responded>withdrawn",
    ]);
    for (const from of CHALLENGE_STATUSES) {
      for (const to of CHALLENGE_STATUSES) {
        expect(isLegalChallengeTransition(from, to), `${from}>${to}`).toBe(
          legal.has(`${from}>${to}`),
        );
      }
    }
  });

  it("requires a strict tri-state COI snapshot for editorial outcomes", () => {
    const outcome = {
      expectedRevision: 1,
      toStatus: "resolved",
      rationale: "Private editorial rationale.",
    } as const;
    expect(transitionChallengeInputSchema.safeParse(outcome).success).toBe(false);
    expect(
      transitionChallengeInputSchema.safeParse({
        ...outcome,
        conflictOfInterest: { status: "none-declared" },
      }).success,
    ).toBe(true);
    expect(
      transitionChallengeInputSchema.safeParse({
        ...outcome,
        conflictOfInterest: { status: "minor-conflict" },
      }).success,
    ).toBe(false);
  });

  it("bounds responses and requires compare-and-set moderation revisions", () => {
    expect(
      createChallengeResponseInputSchema.parse({ expectedRevision: 0, body: "A response." }),
    ).toEqual({ expectedRevision: 0, body: "A response." });
    expect(
      createChallengeResponseInputSchema.safeParse({
        expectedRevision: 0,
        body: "x".repeat(10_001),
      }).success,
    ).toBe(false);
    expect(
      moderateChallengeContentInputSchema.safeParse({ expectedContentRevision: -1 }).success,
    ).toBe(false);
    expect(
      moderateChallengeContentInputSchema.safeParse({
        expectedContentRevision: 0,
        rationale: "not accepted before governance §9",
      }).success,
    ).toBe(false);
    const projected = publicChallengeResponseSchema.parse({
      id: "response-1",
      body: "",
      contentHash: "a".repeat(64),
      contentStatus: "removed",
      contentRevision: 1,
      responder: { githubLogin: "author", displayName: null },
      contributorRoles: ["author"],
      removedById: "editor-private-id",
      createdAt: "2026-07-22T00:00:00.000Z",
    });
    expect(projected).not.toHaveProperty("contributorRoles");
    expect(projected).not.toHaveProperty("removedById");
    const publicTransition = challengeTransitionSchema.parse({
      id: "transition-1",
      fromStatus: "author-responded",
      toStatus: "resolved",
      actor: { githubLogin: "editor", role: "EDITOR" },
      actorRoleSnapshot: "EDITOR",
      rationale: "private rationale",
      conflictOfInterest: { status: "conflict-declared" },
      administratorOverride: {
        administrator: { githubLogin: "admin" },
        exercisedAt: "2026-07-22T00:00:00.000Z",
      },
      revision: 2,
      createdAt: "2026-07-22T00:00:00.000Z",
    });
    expect(publicTransition.actor).not.toHaveProperty("role");
    expect(publicTransition).not.toHaveProperty("actorRoleSnapshot");
    expect(publicTransition).not.toHaveProperty("rationale");
    expect(publicTransition.conflictOfInterest.status).toBe("conflict-declared");
  });
});
