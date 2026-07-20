import { describe, expect, it } from "vitest";
import {
  claimRecordSchema,
  nodeRelationTrustRecordSchema,
  parseJsonlArtifact,
  trustAssessmentRecordSchema,
  trustRecordSchema,
} from "./artifacts.js";

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
    expect(result.truncatedCount).toBe(0);
  });

  it("caps record count", () => {
    const content = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ id: `c${i}`, text: "t" }),
    ).join("\n");
    const result = parseJsonlArtifact(content, claimRecordSchema, 3);
    expect(result.records).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.truncatedCount).toBe(7);
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

describe("nodeRelationTrustRecordSchema", () => {
  const record = {
    subjectType: "node-relation",
    subject: {
      claimNodeId: "claim:primary-result",
      evidenceNodeId: "dataset:observations",
      evidenceKind: "dataset",
      relationType: "uses-dataset",
    },
    protocolVersion: "trust-poc-1.0",
    assessorType: "agent",
    criteria: { sourceAccess: { rating: "high", status: "assessed" } },
    reviewStatus: "human-reviewed",
  } as const;

  it("accepts TRUST only for a complete claim-to-evidence relation", () => {
    expect(nodeRelationTrustRecordSchema.parse(record)).toMatchObject(record);
    expect(trustAssessmentRecordSchema.safeParse(record).success).toBe(true);
  });

  it.each([
    ["dataset", "uses-code"],
    ["code", "uses-dataset"],
    ["figure", "uses-dataset"],
    ["figure", "supports"],
  ])("rejects %s evidence with the %s relation", (evidenceKind, relationType) => {
    expect(
      nodeRelationTrustRecordSchema.safeParse({
        ...record,
        subject: { ...record.subject, evidenceKind, relationType },
      }).success,
    ).toBe(false);
  });

  it("accepts immutable cross-repository evidence addressing", () => {
    expect(
      nodeRelationTrustRecordSchema.safeParse({
        ...record,
        subject: {
          ...record.subject,
          evidenceRepository: {
            githubRepositoryId: "987654321",
            commitSha: "a".repeat(40),
          },
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    { subjectType: "node", nodeId: "dataset:observations" },
    {
      subjectType: "node-relation",
      subject: { evidenceNodeId: "dataset:observations", evidenceKind: "dataset" },
    },
    {
      subjectType: "node-relation",
      subject: {
        claimNodeId: "claim:primary-result",
        evidenceNodeId: "claim:primary-result",
        evidenceKind: "dataset",
        relationType: "uses-dataset",
      },
    },
  ])("has no bare-node or incomplete-relation schema path", (subject) => {
    expect(
      trustAssessmentRecordSchema.safeParse({
        ...record,
        ...subject,
      }).success,
    ).toBe(false);
  });

  it("keeps legacy claim-citation TRUST records valid", () => {
    expect(
      trustAssessmentRecordSchema.safeParse({
        claimId: "claim-1",
        citationId: "citation-1",
        protocolVersion: "trust-poc-1.0",
        assessorType: "agent",
        criteria: {},
      }).success,
    ).toBe(true);
  });

  it("does not let a malformed typed node subject fall back to legacy fields", () => {
    expect(
      trustAssessmentRecordSchema.safeParse({
        claimId: "claim-1",
        citationId: "citation-1",
        subjectType: "node-relation",
        subject: { nodeId: "dataset:observations" },
        protocolVersion: "trust-poc-1.0",
        assessorType: "agent",
        criteria: {},
      }).success,
    ).toBe(false);
  });

  it("does not let an untyped node subject fall back to legacy fields", () => {
    expect(
      trustAssessmentRecordSchema.safeParse({
        claimId: "claim-1",
        citationId: "citation-1",
        subject: {
          claimNodeId: "claim:primary-result",
          evidenceNodeId: "dataset:observations",
          evidenceKind: "dataset",
          relationType: "uses-dataset",
        },
        protocolVersion: "trust-poc-1.0",
        assessorType: "agent",
        criteria: {},
      }).success,
    ).toBe(false);
  });

  it("rejects unknown node-relation criteria and criterion fields without changing legacy", () => {
    expect(
      nodeRelationTrustRecordSchema.safeParse({
        ...record,
        criteria: { inventedCriterion: { rating: "high" } },
      }).success,
    ).toBe(false);
    expect(
      nodeRelationTrustRecordSchema.safeParse({
        ...record,
        criteria: { sourceAccess: { rating: "high", unexpectedVerified: true } },
      }).success,
    ).toBe(false);
    expect(
      trustRecordSchema.safeParse({
        claimId: "claim-1",
        citationId: "citation-1",
        protocolVersion: "trust-poc-1.0",
        assessorType: "agent",
        criteria: { entailment: { rating: "high", legacyExtension: true } },
      }).success,
    ).toBe(true);
  });
});
