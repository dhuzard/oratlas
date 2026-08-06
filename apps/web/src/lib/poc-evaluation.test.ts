import { describe, expect, it } from "vitest";
import { parsePocEvaluation } from "./poc-evaluation";

describe("POC corpus evaluation metadata", () => {
  it("accepts a bounded, actionable source assessment", () => {
    expect(
      parsePocEvaluation({
        corpusRole: "ai-review",
        sourceCoverage: "Representative claims only.",
        limitations: ["Not a complete import."],
        suggestedFixes: ["Publish typed claim artifacts."],
      }),
    ).toEqual({
      corpusRole: "ai-review",
      sourceCoverage: "Representative claims only.",
      limitations: ["Not a complete import."],
      suggestedFixes: ["Publish typed claim artifacts."],
    });
  });

  it.each([
    null,
    { corpusRole: "publication", sourceCoverage: "x", limitations: ["x"], suggestedFixes: ["x"] },
    { corpusRole: "ai-review", sourceCoverage: "x", limitations: [], suggestedFixes: ["x"] },
    {
      corpusRole: "ai-review",
      sourceCoverage: "x",
      limitations: ["x"],
      suggestedFixes: ["x".repeat(1_001)],
    },
  ])("fails closed on malformed or unbounded metadata", (value) => {
    expect(parsePocEvaluation(value)).toBeUndefined();
  });
});
