import { describe, expect, it } from "vitest";
import {
  createTrustAdjudicationInputSchema,
  publicTrustAdjudicationSchema,
} from "./trust-adjudication.js";

const base = {
  subjectType: "claim-citation" as const,
  assessmentIds: ["assessment-a", "assessment-b"],
  expectedDisagreementHash: "a".repeat(64),
  outcome: "disagreement-upheld" as const,
  rationale: "A sufficiently detailed private adjudication rationale.",
  conflictOfInterest: { status: "none-declared" as const },
  administratorOverride: false,
};

describe("TRUST adjudication contracts", () => {
  it("requires unique references and an upheld referenced assessment", () => {
    expect(createTrustAdjudicationInputSchema.safeParse(base).success).toBe(true);
    expect(
      createTrustAdjudicationInputSchema.safeParse({
        ...base,
        assessmentIds: ["assessment-a", "assessment-a"],
      }).success,
    ).toBe(false);
    expect(
      createTrustAdjudicationInputSchema.safeParse({
        ...base,
        outcome: "assessment-upheld",
        selectedAssessmentId: "assessment-c",
      }).success,
    ).toBe(false);
  });

  it("requires a public conflict declaration for an ADMIN override", () => {
    expect(
      createTrustAdjudicationInputSchema.safeParse({ ...base, administratorOverride: true })
        .success,
    ).toBe(false);
    expect(
      createTrustAdjudicationInputSchema.safeParse({
        ...base,
        administratorOverride: true,
        conflictOfInterest: { status: "conflict-declared" },
      }).success,
    ).toBe(true);
  });

  it("keeps the public projection minimal", () => {
    const projected = publicTrustAdjudicationSchema.parse({
      id: "adjudication-a",
      subjectType: "claim-citation",
      protocolVersion: "trust-v2",
      assessmentIds: ["assessment-a", "assessment-b"],
      outcome: "disagreement-upheld",
      adjudicator: { githubLogin: "editor" },
      conflictOfInterest: { status: "none-declared" },
      disagreementHash: "a".repeat(64),
      outcomeHash: "b".repeat(64),
      createdAt: "2026-07-22T00:00:00.000Z",
      valid: true,
    });
    expect(projected).not.toHaveProperty("rationale");
    expect(projected.adjudicator).toEqual({ githubLogin: "editor" });
    expect(
      publicTrustAdjudicationSchema.safeParse({ ...projected, adjudicatorRoleSnapshot: "ADMIN" })
        .success,
    ).toBe(false);
  });
});
