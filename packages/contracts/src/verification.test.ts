import { describe, expect, it } from "vitest";
import {
  createVerificationProtocolSchema,
  createVerificationRunSchema,
  submitVerificationFindingSchema,
  verificationStructuredJsonSchema,
} from "./verification.js";
import { SCIENTIFIC_VERIFICATION_DEMO_FINDINGS } from "./verification-demo-fixtures.js";

describe("generic scientific verification contracts", () => {
  it("requires an exact discriminated subject union", () => {
    expect(
      createVerificationRunSchema.parse({
        verificationProtocolId: "protocol-1",
        subject: { type: "publication-version", publicationVersionId: "version-1" },
        idempotencyKey: "request-001",
      }).subject,
    ).toEqual({ type: "publication-version", publicationVersionId: "version-1" });

    for (const subject of [
      { type: "publication-version", publicationVersionId: "v", knowledgeNodeVersionId: "n" },
      { type: "publication-claim-occurrence", publicationVersionId: "v" },
      { type: "anything", subjectId: "mutable-url" },
    ]) {
      expect(() =>
        createVerificationRunSchema.parse({
          verificationProtocolId: "protocol-1",
          subject,
          idempotencyKey: "request-001",
        }),
      ).toThrow();
    }
  });

  it("keeps protocol definition generic and versioned", () => {
    expect(
      createVerificationProtocolSchema.parse({
        authorityVerifierId: "verifier-1",
        seriesKey: "reported-statistic-consistency",
        protocolVersion: "0.1.0",
        title: "Reported statistic consistency",
        description: "Executed outside ORAtlas.",
        verificationType: "reported-statistic-consistency",
        executionMode: "external-execution",
        supportedSubjectTypes: ["publication-version"],
        definition: { executor: "external", implementation: "protocol-owned" },
      }).executionMode,
    ).toBe("external-execution");
  });

  it("bounds generic structured JSON by finite values, depth, and bytes", () => {
    expect(verificationStructuredJsonSchema.parse({ recomputedP: 0.00335 })).toEqual({
      recomputedP: 0.00335,
    });
    expect(() => verificationStructuredJsonSchema.parse({ value: Number.NaN })).toThrow();
    expect(() =>
      verificationStructuredJsonSchema.parse({ value: "x".repeat(65 * 1024) }),
    ).toThrow();
    let nested: unknown = "leaf";
    for (let index = 0; index < 14; index += 1) nested = { nested };
    expect(() => verificationStructuredJsonSchema.parse(nested)).toThrow();
  });

  it("distinguishes unverifiable from a failed procedure", () => {
    const common = {
      findingKey: "reported-t-001",
      findingType: "statistic-consistency",
      impact: "major",
      statement: "Required parameters were not present.",
      rationale: "No degrees of freedom were frozen in the input.",
    } as const;
    expect(
      submitVerificationFindingSchema.parse({ ...common, status: "unverifiable" }).status,
    ).toBe("unverifiable");
    expect(submitVerificationFindingSchema.parse({ ...common, status: "failed" }).status).toBe(
      "failed",
    );
  });

  it("accepts structured statistics without making SciPy the universal schema", () => {
    const parsed = submitVerificationFindingSchema.parse({
      findingKey: "reported-t-001",
      findingType: "statistic-consistency",
      status: "verified",
      impact: "informational",
      statement: "Reported p-value is consistent under this protocol.",
      rationale: "The external verifier submitted its exact structured comparison.",
      reported: { testType: "t", statistic: 3.12, degreesOfFreedom: [38], reportedP: 0.0034 },
      observed: { recomputedP: 0.00335, library: "scipy", libraryVersion: "1.x" },
      tolerance: { absolute: 0.0001 },
    });
    expect(parsed.observed).toMatchObject({ library: "scipy" });
  });

  it("provides all six deterministic synthetic external-output fixtures", () => {
    expect(SCIENTIFIC_VERIFICATION_DEMO_FINDINGS.map((finding) => finding.findingKey)).toEqual([
      "a-correct-t-test",
      "b-deliberately-incorrect-p",
      "c-insufficient-parameters",
      "d-structured-figure-equality",
      "e-structured-figure-mismatch",
      "f-analysis-independently-reproduced",
    ]);
    expect(
      SCIENTIFIC_VERIFICATION_DEMO_FINDINGS.map(
        (finding) => submitVerificationFindingSchema.parse(finding).status,
      ),
    ).toEqual(["verified", "discrepancy", "unverifiable", "verified", "discrepancy", "verified"]);
  });
});
