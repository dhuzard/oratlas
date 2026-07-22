import { describe, expect, it } from "vitest";
import { type TrustDisagreementInput } from "@oratlas/contracts";
import { detectTrustCriterionDisagreements } from "./index.js";

const assessed = (
  criterion: "entailment" | "sourceAccess",
  rating: "very-low" | "low" | "moderate" | "high" | "very-high",
) => ({ criterion, status: "assessed" as const, rating });

function comparison(assessments: TrustDisagreementInput["assessments"]): TrustDisagreementInput {
  return { assessments };
}

describe("detectTrustCriterionDisagreements", () => {
  it("detects any differing explicit ordinal and groups matching ratings", () => {
    const report = detectTrustCriterionDisagreements(
      comparison([
        {
          assessmentId: "assessment-c",
          protocolVersion: "TRUST-1.0",
          criteria: [assessed("entailment", "high")],
        },
        {
          assessmentId: "assessment-a",
          protocolVersion: "TRUST-1.0",
          criteria: [assessed("entailment", "low")],
        },
        {
          assessmentId: "assessment-b",
          protocolVersion: "TRUST-1.0",
          criteria: [assessed("entailment", "high")],
        },
      ]),
    );

    expect(report.disagreements).toEqual([
      {
        criterion: "entailment",
        ratings: [
          { rating: "low", assessmentIds: ["assessment-a"] },
          { rating: "high", assessmentIds: ["assessment-b", "assessment-c"] },
        ],
      },
    ]);
  });

  it("does not treat equal explicit ratings as disagreement", () => {
    const report = detectTrustCriterionDisagreements(
      comparison([
        {
          assessmentId: "assessment-2",
          protocolVersion: "TRUST-1.0",
          criteria: [assessed("entailment", "moderate")],
        },
        {
          assessmentId: "assessment-1",
          protocolVersion: "TRUST-1.0",
          criteria: [assessed("entailment", "moderate")],
        },
      ]),
    );

    expect(report.disagreements).toEqual([]);
    expect(report.assessmentIds).toEqual(["assessment-1", "assessment-2"]);
  });

  it("reports missing, not-assessed, and not-applicable as coverage gaps", () => {
    const report = detectTrustCriterionDisagreements(
      comparison([
        {
          assessmentId: "missing",
          protocolVersion: "TRUST-1.0",
          criteria: [],
        },
        {
          assessmentId: "not-applicable",
          protocolVersion: "TRUST-1.0",
          criteria: [
            {
              criterion: "entailment",
              status: "not-applicable",
              rating: "not-applicable",
            },
          ],
        },
        {
          assessmentId: "not-assessed",
          protocolVersion: "TRUST-1.0",
          criteria: [
            {
              criterion: "entailment",
              status: "not-assessed",
              rating: "not-assessed",
            },
          ],
        },
      ]),
    );

    expect(report.disagreements).toEqual([]);
    expect(report.coverageGaps[0]).toEqual({
      criterion: "identityIntegrity",
      gaps: [
        { assessmentId: "missing", reason: "missing" },
        { assessmentId: "not-applicable", reason: "missing" },
        { assessmentId: "not-assessed", reason: "missing" },
      ],
    });
    expect(report.coverageGaps[1]).toEqual({
      criterion: "entailment",
      gaps: [
        { assessmentId: "missing", reason: "missing" },
        { assessmentId: "not-applicable", reason: "not-applicable" },
        { assessmentId: "not-assessed", reason: "not-assessed" },
      ],
    });
  });

  it("keeps disagreements and coverage gaps orthogonal", () => {
    const report = detectTrustCriterionDisagreements(
      comparison([
        {
          assessmentId: "high",
          protocolVersion: "TRUST-1.0",
          criteria: [assessed("sourceAccess", "high")],
        },
        {
          assessmentId: "low",
          protocolVersion: "TRUST-1.0",
          criteria: [assessed("sourceAccess", "low")],
        },
        {
          assessmentId: "gap",
          protocolVersion: "TRUST-1.0",
          criteria: [],
        },
      ]),
    );

    expect(report.disagreements).toContainEqual({
      criterion: "sourceAccess",
      ratings: [
        { rating: "low", assessmentIds: ["low"] },
        { rating: "high", assessmentIds: ["high"] },
      ],
    });
    expect(report.coverageGaps).toContainEqual({
      criterion: "sourceAccess",
      gaps: [{ assessmentId: "gap", reason: "missing" }],
    });
  });

  it("is invariant to input order and uses canonical criterion/rating ordering", () => {
    const assessments: TrustDisagreementInput["assessments"] = [
      {
        assessmentId: "z",
        protocolVersion: "TRUST-1.0",
        criteria: [assessed("sourceAccess", "very-high"), assessed("entailment", "very-low")],
      },
      {
        assessmentId: "a",
        protocolVersion: "TRUST-1.0",
        criteria: [assessed("entailment", "very-high"), assessed("sourceAccess", "very-low")],
      },
    ];
    const forward = detectTrustCriterionDisagreements(comparison(assessments));
    const reversed = detectTrustCriterionDisagreements(comparison([...assessments].reverse()));

    expect(reversed).toEqual(forward);
    expect(forward.disagreements.map(({ criterion }) => criterion)).toEqual([
      "entailment",
      "sourceAccess",
    ]);
    expect(forward.disagreements[0]?.ratings.map(({ rating }) => rating)).toEqual([
      "very-low",
      "very-high",
    ]);
  });

  it("fails closed instead of comparing different exact protocol strings", () => {
    expect(() =>
      detectTrustCriterionDisagreements(
        comparison([
          { assessmentId: "a", protocolVersion: "TRUST-1.0", criteria: [] },
          { assessmentId: "b", protocolVersion: "trust-1.0", criteria: [] },
        ]),
      ),
    ).toThrow("disagreement requires one exact TRUST protocol version");
  });

  it("returns a bounded empty report without inventing a protocol", () => {
    expect(detectTrustCriterionDisagreements({ assessments: [] })).toEqual({
      protocolVersion: null,
      assessmentIds: [],
      disagreements: [],
      coverageGaps: [],
    });
  });

  it("validates input at the core boundary", () => {
    expect(() =>
      detectTrustCriterionDisagreements({
        assessments: [
          {
            assessmentId: "same",
            protocolVersion: "TRUST-1.0",
            criteria: [],
          },
          {
            assessmentId: "same",
            protocolVersion: "TRUST-1.0",
            criteria: [],
          },
        ],
      }),
    ).toThrow();
  });
});
