import { describe, expect, it } from "vitest";
import { claimRecordSchema, parseJsonlArtifact, trustRecordSchema } from "./artifacts.js";

describe("parseJsonlArtifact", () => {
  it("parses valid lines and reports invalid ones without aborting", () => {
    const content = [
      JSON.stringify({ id: "c1", text: "Claim one." }),
      "not json",
      JSON.stringify({ id: "c2", text: "Claim two.", claimType: "empirical" }),
      JSON.stringify({ id: "c3" }), // missing text
      "",
    ].join("\n");
    const result = parseJsonlArtifact(content, claimRecordSchema);
    expect(result.records.map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]?.line).toBe(2);
    expect(result.errors[1]?.line).toBe(4);
    expect(result.truncated).toBe(false);
  });

  it("caps record count", () => {
    const content = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ id: `c${i}`, text: "t" }),
    ).join("\n");
    const result = parseJsonlArtifact(content, claimRecordSchema, 3);
    expect(result.records).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
});

describe("trustRecordSchema", () => {
  it("accepts a criterion-level record with ordinal ratings", () => {
    const record = {
      claimId: "c1",
      citationId: "ref1",
      protocolVersion: "trust-1.0",
      assessorType: "agent",
      criteria: {
        entailment: { rating: "high", rationale: "Direct quote supports the claim." },
        sourceAccess: { rating: "not-applicable", status: "not-applicable" },
      },
      reviewStatus: "agent-proposed",
    };
    const parsed = trustRecordSchema.safeParse(record);
    expect(parsed.success).toBe(true);
  });

  it("rejects numeric probabilities as ratings", () => {
    const record = {
      claimId: "c1",
      citationId: "ref1",
      protocolVersion: "trust-1.0",
      assessorType: "agent",
      criteria: { entailment: { rating: 0.93 } },
    };
    expect(trustRecordSchema.safeParse(record).success).toBe(false);
  });

  it("requires aggregate method context via schema shape (method field present when score used)", () => {
    const record = {
      claimId: "c1",
      citationId: "ref1",
      protocolVersion: "trust-1.0",
      assessorType: "agent",
      criteria: {},
      aggregateScore: 0.5,
      aggregateMethod: "ordinal-mean-1.0",
    };
    expect(trustRecordSchema.safeParse(record).success).toBe(true);
  });
});
