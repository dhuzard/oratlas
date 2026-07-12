import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  normalizeImportedTrustRecord,
  resolveTrustVerification,
  reviewedTrustSubjectHash,
  selectPreferredTrustAssessment,
  trustSubjectInputFromDatabaseParts,
  type ReviewedTrustSubjectInput,
} from "./index.js";

function subject(): ReviewedTrustSubjectInput {
  return {
    assessment: {
      id: "assessment-1",
      protocolVersion: "trust-poc-1.0",
      assessorType: "agent",
      assessorId: "repository-agent",
      assessedAt: "2026-01-01T00:00:00.000Z",
      criteriaJson: {
        identityIntegrity: null,
        entailment: '{"rating":"high"}',
        sourceAccess: null,
        populationRelevance: null,
        interventionExposureRelevance: null,
        outcomeRelevance: null,
        methodologicalSafeguards: null,
        statisticalSafeguards: null,
        replicationConvergence: null,
        conflictDependency: null,
      },
      limitationsJson: "[]",
      evidenceJson: '{"source":"repository"}',
      aggregateScore: 0.75,
      aggregateMethod: "ordinal-mean-1.0",
      reviewStatus: "unverified-import",
      sourceRecordJson: '{"reviewStatus":"human-reviewed"}',
      sourceReviewStatus: "human-reviewed",
      sourceAssessorType: "agent",
      sourceAssessorId: "repository-agent",
      sourceAssessedAt: "2026-01-01T00:00:00.000Z",
      sourceEvidenceJson: '{"source":"repository"}',
      sourceAggregateScore: null,
      sourceAggregateMethod: null,
      sourceRelationHumanReviewed: true,
    },
    relation: {
      id: "relation-1",
      relationType: "supports",
      supportDirection: "positive",
      sourceLocation: "claims.jsonl:1",
      extractionMethod: "repository-import",
      extractionConfidence: 0.9,
    },
    claim: {
      id: "claim-1",
      reviewVersionId: "version-1",
      localClaimId: "claim-local",
      text: "A claim",
      normalizedText: "a claim",
      section: "Results",
      anchor: "claim-local",
      claimType: "empirical",
      qualification: null,
    },
    citation: {
      id: "citation-1",
      reviewVersionId: "version-1",
      localCitationId: "citation-local",
      doi: "10.1000/example",
      pmid: null,
      openAlexId: null,
      title: "A paper",
      authorsJson: "[]",
      year: 2025,
      source: "Journal",
      url: null,
      rawCitationJson: null,
    },
  };
}

describe("TRUST reviewed-subject integrity", () => {
  it("canonicalizes object keys and preserves explicit null", () => {
    expect(canonicalJson({ z: null, a: { y: 2, x: 1 } })).toBe('{"a":{"x":1,"y":2},"z":null}');
  });

  it.each([
    [
      "criteria",
      (value: ReviewedTrustSubjectInput) =>
        (value.assessment.criteriaJson.entailment = '{"rating":"low"}'),
    ],
    [
      "evidence",
      (value: ReviewedTrustSubjectInput) =>
        (value.assessment.evidenceJson = '{"source":"changed"}'),
    ],
    [
      "source assertion",
      (value: ReviewedTrustSubjectInput) =>
        (value.assessment.sourceRecordJson = '{"reviewStatus":"agent-proposed"}'),
    ],
    [
      "citation source",
      (value: ReviewedTrustSubjectInput) => (value.citation.source = "Changed Journal"),
    ],
  ])("changes the hash after a %s mutation", (_label, mutate) => {
    const original = subject();
    const changed = structuredClone(original);
    mutate(changed);
    expect(reviewedTrustSubjectHash(changed)).not.toBe(reviewedTrustSubjectHash(original));
  });

  it("uses verification state, timestamp, then id for deterministic precedence", () => {
    const candidates = [
      {
        id: "b",
        effectiveStatus: "unverified-import" as const,
        assessedAt: "2026-02-01",
        value: 1,
      },
      { id: "z", effectiveStatus: "human-reviewed" as const, assessedAt: "2026-01-01", value: 2 },
      { id: "a", effectiveStatus: "human-reviewed" as const, assessedAt: "2026-01-01", value: 3 },
    ];
    expect(selectPreferredTrustAssessment(candidates)?.value).toBe(3);
  });

  it("keeps hashes independent of Prisma include/query shape", () => {
    const base = subject();
    const withNestedQueryData = {
      assessment: { ...base.assessment },
      relation: { ...base.relation, claimId: "claim-1", nested: { ignored: true } },
      claim: { ...base.claim, createdAt: new Date(), reviewVersion: { ignored: true } },
      citation: { ...base.citation, nested: { ignored: true } },
    };
    const mapped = trustSubjectInputFromDatabaseParts(withNestedQueryData);
    expect(reviewedTrustSubjectHash(mapped)).toBe(reviewedTrustSubjectHash(base));
  });

  it("fails closed for absent, stale, invalid, and legacy verification state", () => {
    const current = subject();
    const hash = reviewedTrustSubjectHash(current);
    expect(resolveTrustVerification(current, null).state).toBe("unverified-import");
    expect(
      resolveTrustVerification(current, {
        status: "human-reviewed",
        assessmentHash: "0".repeat(64),
      }),
    ).toMatchObject({ state: "stale-verification", effectiveStatus: "unverified-import" });
    expect(
      resolveTrustVerification(current, { status: "source-claimed", assessmentHash: hash }).state,
    ).toBe("stale-verification");

    const legacy = structuredClone(current);
    legacy.assessment.sourceRecordJson = null;
    expect(resolveTrustVerification(legacy, null).state).toBe("legacy-unknown");
  });

  it("accepts only a current platform-owned status and hash", () => {
    const current = subject();
    expect(
      resolveTrustVerification(current, {
        status: "adjudicated",
        assessmentHash: reviewedTrustSubjectHash(current),
      }),
    ).toMatchObject({ state: "platform-verified", effectiveStatus: "adjudicated" });
  });

  it("preserves source assertions but forces imported public state and aggregate", () => {
    const imported = normalizeImportedTrustRecord(
      {
        claimId: "claim-1",
        citationId: "citation-1",
        protocolVersion: "trust-poc-1.0",
        assessorType: "human",
        assessorId: "repository-author",
        assessedAt: "2026-01-01T00:00:00.000Z",
        criteria: { entailment: { rating: "high", status: "assessed" } },
        evidence: { pointer: "evidence.json:2" },
        aggregateScore: null,
        aggregateMethod: null,
        reviewStatus: "human-reviewed",
      },
      true,
    );

    expect(imported).toMatchObject({
      reviewStatus: "unverified-import",
      aggregateScore: 0.75,
      aggregateMethod: "ordinal-mean-1.0",
      sourceReviewStatus: "human-reviewed",
      sourceAssessorType: "human",
      sourceAggregateScore: null,
      sourceAggregateMethod: null,
      sourceRelationHumanReviewed: true,
    });
    expect(imported.sourceRecordJson).toContain('"aggregateScore":null');
    expect(imported.sourceRecordJson).toContain('"sourceRelationHumanReviewed":true');
  });
});
