import { describe, expect, it } from "vitest";
import {
  ORDINAL_MEAN_METHOD,
  computeAggregate,
  ordinalAtLeast,
  validateTrustRecord,
} from "./index.js";
import { type TrustRecord } from "@oratlas/contracts";

const record: TrustRecord = {
  claimId: "claim-001",
  citationId: "ref-1",
  protocolVersion: "trust-poc-1.0",
  assessorType: "agent",
  criteria: {
    entailment: { rating: "high", status: "assessed" },
    sourceAccess: { rating: "very-high", status: "assessed" },
    populationRelevance: { rating: "moderate", status: "assessed" },
    replicationConvergence: { rating: "not-applicable", status: "not-applicable" },
    statisticalSafeguards: { rating: "not-assessed", status: "not-assessed" },
  },
  reviewStatus: "agent-proposed",
};

describe("validateTrustRecord", () => {
  it("accepts a valid criterion-level record", () => {
    expect(validateTrustRecord(record).ok).toBe(true);
  });
  it("rejects malformed records", () => {
    expect(validateTrustRecord({ claimId: "x" }).ok).toBe(false);
  });
});

describe("computeAggregate", () => {
  it("averages only assessed ordinal criteria and reports the method", () => {
    const result = computeAggregate(record);
    // (0.75 + 1 + 0.5) / 3 = 0.75
    expect(result.score).toBe(0.75);
    expect(result.method).toBe(ORDINAL_MEAN_METHOD);
    expect(result.assessedCriteria).toEqual(["entailment", "sourceAccess", "populationRelevance"]);
    expect(result.skippedCriteria).toContain("replicationConvergence");
    expect(result.skippedCriteria).toContain("statisticalSafeguards");
  });

  it("returns null when nothing is assessed (never invents a score)", () => {
    const empty: TrustRecord = {
      ...record,
      criteria: { entailment: { rating: "not-assessed", status: "not-assessed" } },
    };
    expect(computeAggregate(empty).score).toBeNull();
  });
});

describe("ordinalAtLeast", () => {
  it("compares ordinals and treats non-values as false", () => {
    expect(ordinalAtLeast("high", "moderate")).toBe(true);
    expect(ordinalAtLeast("low", "high")).toBe(false);
    expect(ordinalAtLeast("not-assessed", "low")).toBe(false);
  });
});
