import { describe, expect, it } from "vitest";
import {
  ORA_SCIENTIFIC_MERIT_OUTCOME_RULE_VERSION,
  ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION,
  deriveOraScientificMeritOutcome,
  oraScientificMeritCriterionResultsSchema,
} from "./ora-certification.js";

const completeness = {
  returnedDocuments: 1,
  totalDocumentsKnown: null,
  truncated: false,
  coverage: "partial" as const,
};
const evidence = { type: "publication-content-document" as const, id: "content-1" };

function criteria(
  overrides: Record<
    string,
    "pass" | "concern" | "fail" | "not-applicable" | "insufficient-evidence"
  > = {},
) {
  return oraScientificMeritCriterionResultsSchema.parse(
    ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION.criteria.map((criterion) => ({
      criterionId: criterion.id,
      status: overrides[criterion.id] ?? "pass",
      rationale: `Fixture rationale for ${criterion.id}.`,
      evidenceRefs: ["insufficient-evidence", "not-applicable"].includes(
        overrides[criterion.id] ?? "pass",
      )
        ? []
        : [evidence],
    })),
  );
}

describe("ORA Scientific Merit Pilot 0.1.0 contract", () => {
  it("defines ten immutable explicit criteria without requiring globally complete content", () => {
    expect(ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION.criteria.map((item) => item.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
      "c8",
      "c9",
      "c10",
    ]);
    expect(ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION.requireCompleteSections).not.toContain(
      "content",
    );
    expect(
      ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION.criteria.map(
        (criterion) => criterion.evidenceRequiredForStatuses,
      ),
    ).toEqual(Array.from({ length: 10 }, () => ["pass", "concern", "fail"]));
    expect(ORA_SCIENTIFIC_MERIT_OUTCOME_RULE_VERSION).toBe("ora-scientific-merit-outcome-0.1.0");
  });

  it.each([
    ["strong", {}, "certified"],
    ["meaningful concern", { c7: "concern" }, "certified-with-conditions"],
    ["explicit required failure", { c10: "fail" }, "not-certified"],
    ["material evidence missing", { c4: "insufficient-evidence" }, "inconclusive"],
  ] as const)("derives the %s fixture deterministically", (_name, overrides, outcome) => {
    expect(deriveOraScientificMeritOutcome(criteria(overrides), completeness)).toBe(outcome);
  });

  it("does not convert missing information or partial content into failure", () => {
    expect(
      deriveOraScientificMeritOutcome(criteria({ c5: "insufficient-evidence" }), completeness),
    ).toBe("inconclusive");
    expect(deriveOraScientificMeritOutcome(criteria(), completeness)).toBe("certified");
  });

  it("fails closed when content is unsupported but c4-c6 are claimed applicable", () => {
    expect(
      deriveOraScientificMeritOutcome(criteria(), {
        returnedDocuments: 0,
        totalDocumentsKnown: null,
        truncated: false,
        coverage: "unsupported",
      }),
    ).toBe("inconclusive");
  });

  it("rejects model-like outputs that omit criteria, invent criteria, or omit substantive evidence", () => {
    expect(() => oraScientificMeritCriterionResultsSchema.parse(criteria().slice(1))).toThrow();
    expect(() =>
      oraScientificMeritCriterionResultsSchema.parse([
        ...criteria().slice(1),
        { ...criteria()[0], criterionId: "invented" },
      ]),
    ).toThrow();
    expect(() =>
      oraScientificMeritCriterionResultsSchema.parse(
        criteria().map((item, index) => (index === 0 ? { ...item, evidenceRefs: [] } : item)),
      ),
    ).toThrow();
  });
});
