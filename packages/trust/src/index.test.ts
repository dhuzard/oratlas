import { describe, expect, it } from "vitest";
import {
  ORDINAL_MEAN_METHOD,
  assessmentSourceIdentity,
  assertSingleAssessmentProtocol,
  computeAggregate,
  ordinalAtLeast,
  validateTrustAssessmentRecord,
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
  it("accepts relation-scoped node evidence through the combined importer", () => {
    expect(
      validateTrustAssessmentRecord({
        subjectType: "node-relation",
        subject: {
          claimNodeId: "claim:primary-result",
          evidenceNodeId: "code:analysis",
          evidenceKind: "code",
          relationType: "uses-code",
        },
        protocolVersion: "trust-poc-1.0",
        assessorType: "agent",
        criteria: { methodologicalSafeguards: { rating: "moderate" } },
      }).ok,
    ).toBe(true);
  });

  it("does not broaden the legacy-only validator", () => {
    expect(
      validateTrustRecord({
        subjectType: "node-relation",
        subject: {
          claimNodeId: "claim:primary-result",
          evidenceNodeId: "code:analysis",
          evidenceKind: "code",
          relationType: "uses-code",
        },
        protocolVersion: "trust-poc-1.0",
        assessorType: "agent",
        criteria: {},
      }).ok,
    ).toBe(false);
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
    const rating = (value: Parameters<typeof ordinalAtLeast>[0]["rating"]) => ({
      protocolVersion: "trust-poc-1.0",
      rating: value,
    });
    expect(ordinalAtLeast(rating("high"), rating("moderate"))).toBe(true);
    expect(ordinalAtLeast(rating("low"), rating("high"))).toBe(false);
    expect(ordinalAtLeast(rating("not-assessed"), rating("low"))).toBe(false);
  });

  it("refuses ordinal translation between protocol versions", () => {
    expect(() =>
      ordinalAtLeast(
        { protocolVersion: "trust-poc-1.0", rating: "high" },
        { protocolVersion: "trust-poc-1.1", rating: "moderate" },
      ),
    ).toThrow("comparison requires one exact TRUST protocol version");
  });
});

describe("assertSingleAssessmentProtocol", () => {
  it.each(["aggregation", "disagreement"] as const)(
    "fails closed for mixed protocol %s",
    (operation) => {
      expect(() =>
        assertSingleAssessmentProtocol(operation, [
          { protocolVersion: "trust-poc-1.0" },
          { protocolVersion: "trust-poc-1.0 " },
        ]),
      ).toThrow(`${operation} requires one exact TRUST protocol version`);
    },
  );

  it("uses exact opaque identity and accepts empty, single, and identical sets", () => {
    expect(assertSingleAssessmentProtocol("selection", [])).toBeUndefined();
    expect(
      assertSingleAssessmentProtocol("selection", [{ protocolVersion: "TRUST-PoC-1.0" }]),
    ).toBe("TRUST-PoC-1.0");
    expect(
      assertSingleAssessmentProtocol("selection", [
        { protocolVersion: "trust-poc-1.0" },
        { protocolVersion: "trust-poc-1.0" },
      ]),
    ).toBe("trust-poc-1.0");
    expect(() =>
      assertSingleAssessmentProtocol("selection", [
        { protocolVersion: "trust-poc-1.0" },
        { protocolVersion: "TRUST-POC-1.0" },
      ]),
    ).toThrow();
  });
});

describe("assessmentSourceIdentity", () => {
  it("keeps a changed source record in the same lineage with a new exact hash", () => {
    const original = assessmentSourceIdentity(record);
    const changed = assessmentSourceIdentity({
      ...record,
      criteria: { ...record.criteria, entailment: { rating: "low", status: "assessed" } },
    });
    expect(changed.sourceLineageKey).toBe(original.sourceLineageKey);
    expect(changed.sourceRecordHash).not.toBe(original.sourceRecordHash);
    expect(assessmentSourceIdentity(structuredClone(record))).toEqual(original);
  });
});

describe("assessmentSourceIdentity", () => {
  it("keeps a changed source record in the same lineage with a new exact hash", () => {
    const original = assessmentSourceIdentity(record);
    const changed = assessmentSourceIdentity({
      ...record,
      criteria: { ...record.criteria, entailment: { rating: "low", status: "assessed" } },
    });
    expect(changed.sourceLineageKey).toBe(original.sourceLineageKey);
    expect(changed.sourceRecordHash).not.toBe(original.sourceRecordHash);
    expect(assessmentSourceIdentity(structuredClone(record))).toEqual(original);
  });
});
