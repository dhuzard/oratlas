import { describe, expect, it } from "vitest";
import {
  TRUST_DISAGREEMENT_MAX_ASSESSMENTS,
  trustDisagreementInputSchema,
  trustDisagreementReportSchema,
} from "./trust-disagreement.js";

describe("TRUST disagreement contracts", () => {
  it("accepts a bounded strict comparison input", () => {
    expect(
      trustDisagreementInputSchema.safeParse({
        assessments: [
          {
            assessmentId: "assessment-1",
            protocolVersion: "TRUST-1.0",
            criteria: [
              { criterion: "entailment", status: "assessed", rating: "high" },
              {
                criterion: "sourceAccess",
                status: "not-assessed",
                rating: "not-assessed",
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    {
      assessments: [
        {
          assessmentId: "duplicate-criterion",
          protocolVersion: "TRUST-1.0",
          criteria: [
            { criterion: "entailment", status: "assessed", rating: "high" },
            { criterion: "entailment", status: "assessed", rating: "low" },
          ],
        },
      ],
    },
    {
      assessments: [
        {
          assessmentId: "mismatched-status",
          protocolVersion: "TRUST-1.0",
          criteria: [{ criterion: "entailment", status: "not-assessed", rating: "high" }],
        },
      ],
    },
    {
      assessments: [
        { assessmentId: "same", protocolVersion: "TRUST-1.0", criteria: [] },
        { assessmentId: "same", protocolVersion: "TRUST-1.0", criteria: [] },
      ],
    },
    {
      assessments: Array.from({ length: TRUST_DISAGREEMENT_MAX_ASSESSMENTS + 1 }, (_, index) => ({
        assessmentId: `assessment-${index}`,
        protocolVersion: "TRUST-1.0",
        criteria: [],
      })),
    },
  ])("rejects malformed or unbounded comparison input %#", (input) => {
    expect(trustDisagreementInputSchema.safeParse(input).success).toBe(false);
  });

  it("keeps the public result bounded and free of adjudication or aggregate fields", () => {
    const report = {
      protocolVersion: "TRUST-1.0",
      assessmentIds: ["assessment-1", "assessment-2"],
      disagreements: [
        {
          criterion: "entailment",
          ratings: [
            { rating: "low", assessmentIds: ["assessment-1"] },
            { rating: "high", assessmentIds: ["assessment-2"] },
          ],
        },
      ],
      coverageGaps: [],
    };
    expect(trustDisagreementReportSchema.safeParse(report).success).toBe(true);
    expect(
      trustDisagreementReportSchema.safeParse({ ...report, adjudication: "high" }).success,
    ).toBe(false);
  });
});
