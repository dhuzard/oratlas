/**
 * Deterministic external-output examples for CI and integrator conformance.
 * They contain no calculation implementation and may be attached only to a
 * clearly labelled synthetic subject by tests or demos.
 */
export const SCIENTIFIC_VERIFICATION_DEMO_FINDINGS = [
  {
    findingKey: "a-correct-t-test",
    findingType: "statistic-consistency",
    status: "verified",
    impact: "informational",
    statement: "The reported synthetic t-test p-value is consistent under the fixture protocol.",
    rationale: "A deterministic external fixture supplied matching reported and observed values.",
    reported: { testType: "t", statistic: 3.12, degreesOfFreedom: [38], reportedP: 0.0034 },
    observed: { recomputedP: 0.00335, library: "external-ci-fixture", libraryVersion: "1.0.0" },
    tolerance: { absolute: 0.0001 },
  },
  {
    findingKey: "b-deliberately-incorrect-p",
    findingType: "statistic-consistency",
    status: "discrepancy",
    impact: "major",
    statement:
      "The deliberately incorrect synthetic p-value differs from the observed fixture value.",
    rationale: "The external fixture intentionally supplies a mismatch for deterministic coverage.",
    reported: { testType: "t", statistic: 3.12, degreesOfFreedom: [38], reportedP: 0.34 },
    observed: { recomputedP: 0.00335, library: "external-ci-fixture", libraryVersion: "1.0.0" },
  },
  {
    findingKey: "c-insufficient-parameters",
    findingType: "statistic-consistency",
    status: "unverifiable",
    impact: "minor",
    statement: "The synthetic report omits parameters required by the external protocol.",
    rationale: "Missing scientific evidence is unavailable, not a failed verification procedure.",
    reported: { testType: "t", statistic: 3.12 },
  },
  {
    findingKey: "d-structured-figure-equality",
    findingType: "figure-structured-comparison",
    status: "verified",
    impact: "informational",
    statement: "The structured synthetic figure data are equal.",
    rationale:
      "The external fixture compared exact structured values rather than visual similarity alone.",
    observed: { method: "structured-comparison", equal: true },
  },
  {
    findingKey: "e-structured-figure-mismatch",
    findingType: "figure-structured-comparison",
    status: "discrepancy",
    impact: "major",
    statement: "The structured synthetic figure data contain a deliberate mismatch.",
    rationale: "The deterministic external comparison found different exact structured values.",
    observed: { method: "structured-comparison", equal: false },
  },
  {
    findingKey: "f-analysis-independently-reproduced",
    findingType: "analysis-result-comparison",
    status: "verified",
    impact: "major",
    statement: "The synthetic analysis result was independently reproduced.",
    rationale:
      "The external fixture explicitly distinguishes independent reproduction from regeneration.",
    observed: { method: "independent-reproduction", matched: true },
  },
] as const;
