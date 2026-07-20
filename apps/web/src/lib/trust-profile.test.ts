import { describe, expect, it } from "vitest";
import { TRUST_CRITERIA } from "@oratlas/contracts";
import { trustCriterionProfile, trustCriterionProfileFromJson } from "./trust-profile";

describe("TRUST criterion presentation", () => {
  it("renders all canonical criteria while distinguishing absent and explicitly not assessed", () => {
    const profile = trustCriterionProfile({
      entailment: { rating: "not-assessed", status: "not-assessed" },
    });

    expect(profile).toHaveLength(TRUST_CRITERIA.length);
    expect(profile.find((row) => row.criterion === "entailment")).toMatchObject({
      rating: "not-assessed",
      status: "not-assessed",
    });
    expect(profile.find((row) => row.criterion === "sourceAccess")).toMatchObject({
      rating: "not-supplied",
      status: "not-supplied",
    });
  });

  it("fails malformed persisted criterion JSON closed instead of inventing an assessment", () => {
    const criteria = Object.fromEntries(
      TRUST_CRITERIA.map((criterion) => [criterion, null]),
    ) as Record<(typeof TRUST_CRITERIA)[number], string | null>;
    criteria.identityIntegrity = "not-json";

    expect(trustCriterionProfileFromJson(criteria)[0]).toEqual({
      criterion: "identityIntegrity",
      rating: "unavailable",
      status: "invalid",
    });
  });
});
