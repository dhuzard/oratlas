import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createReviewedNodeRelationTrustSubject,
  normalizeImportedNodeRelationTrustRecord,
  normalizeImportedTrustRecord,
  nodeRelationTrustSubjectInputFromDatabaseRows,
  resolveNodeRelationTrustVerification,
  resolveTrustVerification,
  reviewedNodeRelationTrustSubjectHash,
  reviewedTrustSubjectHash,
  orderTrustAssessments,
  compareTrustCodeUnits,
  trustSubjectInputFromDatabaseParts,
  type ReviewedTrustSubjectInput,
  type ReviewedNodeRelationTrustSubjectInput,
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

function nodeRelationSubject(): ReviewedNodeRelationTrustSubjectInput {
  const importedRecord = {
    subjectType: "node-relation" as const,
    subject: {
      claimNodeId: "claim:primary-result",
      evidenceNodeId: "dataset:observations",
      evidenceKind: "dataset" as const,
      relationType: "uses-dataset" as const,
    },
    protocolVersion: "trust-poc-1.0",
    assessorType: "agent" as const,
    criteria: { sourceAccess: { rating: "high" as const, status: "assessed" as const } },
    reviewStatus: "agent-proposed" as const,
  };
  const nodeVersion = (
    id: string,
    nodeId: string,
    localNodeId: string,
    kind: string,
    payloadJson: string,
  ) => ({
    version: {
      id,
      knowledgeNodeId: nodeId,
      snapshotId: "snapshot-1",
      sourceSubmissionId: "submission-1",
      inspectionCaptureId: "capture-1",
      capturePayloadHash: "a".repeat(64),
      title: localNodeId,
      abstract: null,
      text: null,
      contributorsJson: "[]",
      license: "MIT",
      payloadJson,
      provenanceJson: '{"commitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
      versionDoi: null,
      conceptDoi: null,
      isExample: false,
    },
    node: { id: nodeId, repositoryId: "repository-1", localNodeId, kind },
    repository: {
      id: "repository-1",
      githubRepositoryId: "123",
      canonicalUrl: "https://github.com/example/review",
    },
    snapshot: {
      id: "snapshot-1",
      repositoryId: "repository-1",
      commitSha: "a".repeat(40),
      sourceTreeSha: "b".repeat(40),
      sourceKind: "default-branch",
      inspectionStatus: "succeeded",
      contentHash: "c".repeat(64),
    },
    inspectionCapture: {
      id: "capture-1",
      payloadHash: "a".repeat(64),
      githubRepositoryId: "123",
      commitSha: "a".repeat(40),
    },
    sourceSubmission: {
      id: "submission-1",
      repositoryId: "repository-1",
      snapshotId: "snapshot-1",
      inspectionCaptureId: "capture-1",
      submittedPayloadHash: "d".repeat(64),
      acceptedNodeSelectionHash: "e".repeat(64),
    },
  });
  return {
    assessment: {
      ...structuredClone(subject().assessment),
      sourceRecordJson: canonicalJson(importedRecord),
    },
    importedRecord,
    proposal: {
      id: "proposal-1",
      originKey: "origin-1",
      sourceStableKey: canonicalJson({
        githubRepositoryId: "123",
        localNodeId: "claim:primary-result",
        commitSha: "a".repeat(40),
      }),
      targetStableKey: canonicalJson({
        githubRepositoryId: "123",
        localNodeId: "dataset:observations",
        commitSha: "a".repeat(40),
      }),
      relationType: "uses-dataset",
      sourceNodeVersionId: "claim-version-1",
      targetNodeId: "dataset-node-1",
      targetNodeVersionId: "dataset-version-1",
      origin: "asserted-by-author",
      rationale: "The analysis consumes this immutable dataset version.",
      evidenceJson: "{}",
      sourceSubmissionId: "submission-1",
      inspectionCaptureId: "capture-1",
      status: "confirmed",
      revision: 1,
      reviewedById: "editor-1",
      reviewedAt: "2026-01-02T00:00:00.000Z",
      reviewNote: "Confirmed exact evidence relation.",
      confirmedEdgeId: "node-edge-1",
    },
    confirmedEdge: {
      id: "node-edge-1",
      sourceNodeVersionId: "claim-version-1",
      targetNodeId: "dataset-node-1",
      relationType: "uses-dataset",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      rationale: "The analysis consumes this immutable dataset version.",
      assertedAt: null,
      confirmedTargetNodeVersionId: "dataset-version-1",
      confirmedById: "editor-1",
      confirmedAt: "2026-01-02T00:00:00.000Z",
      revision: 1,
      confirmerRole: "EDITOR",
    },
    claimNode: {
      ...nodeVersion(
        "claim-version-1",
        "claim-node-1",
        "claim:primary-result",
        "claim",
        '{"statement":"A claim"}',
      ),
      kind: "claim",
    },
    evidenceNode: {
      ...nodeVersion(
        "dataset-version-1",
        "dataset-node-1",
        "dataset:observations",
        "dataset",
        '{"format":"csv","sizeBytes":100}',
      ),
      kind: "dataset",
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

  it("orders every assessment without using verification or rating precedence", () => {
    const candidates = [
      {
        id: "b",
        assessedAt: "2026-02-01",
        assessorType: "agent",
        assessorId: null,
        protocolVersion: "trust-1",
        value: 1,
      },
      {
        id: "z",
        assessedAt: "2026-01-01",
        assessorType: "human",
        assessorId: "z",
        protocolVersion: "trust-1",
        value: 2,
      },
      {
        id: "a",
        assessedAt: "2026-01-01",
        assessorType: "human",
        assessorId: "a",
        protocolVersion: "trust-1",
        value: 3,
      },
    ];
    expect(orderTrustAssessments(candidates).map(({ value }) => value)).toEqual([3, 2, 1]);
  });

  it("uses host-independent code-unit ordering for non-ASCII provenance", () => {
    expect(["é", "z", "ä", "a"].sort(compareTrustCodeUnits)).toEqual(["a", "z", "ä", "é"]);
    const candidates = ["é", "z", "ä", "a"].map((assessorId, index) => ({
      id: `id-${index}`,
      assessedAt: null,
      assessorType: "human",
      assessorId,
      protocolVersion: "trust-1",
      value: assessorId,
    }));
    expect(orderTrustAssessments(candidates).map(({ value }) => value)).toEqual([
      "a",
      "z",
      "ä",
      "é",
    ]);
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

describe("TRUST node-relation subject integrity", () => {
  it("maps only canonical stable keys and exact local snapshots", () => {
    const { importedRecord: _imported, ...rows } = nodeRelationSubject();
    expect(
      nodeRelationTrustSubjectInputFromDatabaseRows(rows).importedRecord.subject,
    ).toMatchObject({
      claimNodeId: "claim:primary-result",
      evidenceNodeId: "dataset:observations",
    });

    const badKey = structuredClone(rows);
    badKey.proposal.targetStableKey = "123:dataset:observations:mutable";
    expect(() => nodeRelationTrustSubjectInputFromDatabaseRows(badKey)).toThrow(/persisted/i);

    const missingRepositoryIdentity = structuredClone(rows);
    missingRepositoryIdentity.evidenceNode.repository.githubRepositoryId = null;
    expect(() => nodeRelationTrustSubjectInputFromDatabaseRows(missingRepositoryIdentity)).toThrow(
      /GitHub identities/i,
    );

    const oldLocalVersion = structuredClone(rows);
    oldLocalVersion.evidenceNode.snapshot.id = "older-snapshot";
    oldLocalVersion.evidenceNode.snapshot.commitSha = "f".repeat(40);
    oldLocalVersion.proposal.targetStableKey = canonicalJson({
      githubRepositoryId: "123",
      localNodeId: "dataset:observations",
      commitSha: "f".repeat(40),
    });
    expect(() => nodeRelationTrustSubjectInputFromDatabaseRows(oldLocalVersion)).toThrow(
      /local TRUST relation/i,
    );
  });

  it("normalizes every repository assertion to an unverified import", () => {
    const imported = normalizeImportedNodeRelationTrustRecord({
      subjectType: "node-relation",
      subject: {
        claimNodeId: "claim:primary-result",
        evidenceNodeId: "dataset:observations",
        evidenceKind: "dataset",
        relationType: "uses-dataset",
      },
      protocolVersion: "trust-poc-1.0",
      assessorType: "human",
      assessorId: "repository-author",
      assessedAt: "2026-01-01T00:00:00.000Z",
      criteria: { sourceAccess: { rating: "very-high", status: "assessed" } },
      evidence: { pointer: "nodes/dataset.json" },
      aggregateScore: 1,
      aggregateMethod: "source-claimed-method",
      reviewStatus: "adjudicated",
    });

    expect(imported).toMatchObject({
      reviewStatus: "unverified-import",
      sourceReviewStatus: "adjudicated",
      aggregateScore: 1,
      aggregateMethod: "ordinal-mean-1.0",
      sourceAggregateScore: 1,
      sourceAggregateMethod: "source-claimed-method",
      sourceRelationHumanReviewed: null,
    });
    expect(imported.sourceRecordJson).toContain('"subjectType":"node-relation"');
    expect(imported.sourceRecordJson).not.toContain("sourceRelationHumanReviewed");
  });

  it.each([
    [
      "relation",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.proposal.rationale = "Changed rationale"),
    ],
    [
      "claim version",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.claimNode.version.payloadJson = '{"statement":"Changed"}'),
    ],
    [
      "evidence version",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.evidenceNode.version.payloadJson = '{"format":"parquet","sizeBytes":100}'),
    ],
    [
      "source assertion",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.assessment.sourceRecordJson = '{"reviewStatus":"agent-proposed"}'),
    ],
  ])("invalidates the canonical hash after a %s mutation", (_label, mutate) => {
    const original = nodeRelationSubject();
    const changed = structuredClone(original);
    mutate(changed);
    expect(reviewedNodeRelationTrustSubjectHash(changed)).not.toBe(
      reviewedNodeRelationTrustSubjectHash(original),
    );
  });

  it("uses the existing fail-closed verification marker semantics", () => {
    const current = nodeRelationSubject();
    const assessmentHash = reviewedNodeRelationTrustSubjectHash(current);
    expect(
      resolveNodeRelationTrustVerification(current, {
        status: "human-reviewed",
        assessmentHash,
      }),
    ).toMatchObject({ state: "platform-verified", effectiveStatus: "human-reviewed" });

    const changed = structuredClone(current);
    changed.evidenceNode.version.payloadJson = '{"format":"csv","sizeBytes":101}';
    expect(
      resolveNodeRelationTrustVerification(changed, {
        status: "human-reviewed",
        assessmentHash,
      }),
    ).toMatchObject({ state: "stale-verification", effectiveStatus: "unverified-import" });
  });

  it.each([
    [
      "proposed proposal",
      (value: ReviewedNodeRelationTrustSubjectInput) => (value.proposal.status = "proposed"),
    ],
    [
      "rejected proposal",
      (value: ReviewedNodeRelationTrustSubjectInput) => (value.proposal.status = "rejected"),
    ],
    [
      "superseded proposal",
      (value: ReviewedNodeRelationTrustSubjectInput) => (value.proposal.status = "superseded"),
    ],
    [
      "missing edge",
      (value: ReviewedNodeRelationTrustSubjectInput) => (value.confirmedEdge = null),
    ],
    [
      "mismatched edge id",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.proposal.confirmedEdgeId = "other-edge"),
    ],
    [
      "rejected edge",
      (value: ReviewedNodeRelationTrustSubjectInput) => (value.confirmedEdge!.status = "rejected"),
    ],
    [
      "author provenance",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.confirmedEdge!.provenance = "asserted-by-author"),
    ],
    [
      "wrong relation",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.confirmedEdge!.relationType = "derives-from"),
    ],
    [
      "wrong source",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.confirmedEdge!.sourceNodeVersionId = "other-version"),
    ],
    [
      "wrong stable target",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.confirmedEdge!.targetNodeId = "other-node"),
    ],
    [
      "wrong frozen version",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.confirmedEdge!.confirmedTargetNodeVersionId = "other-version"),
    ],
    [
      "missing confirmer",
      (value: ReviewedNodeRelationTrustSubjectInput) => (value.confirmedEdge!.confirmedById = null),
    ],
    [
      "missing confirmation time",
      (value: ReviewedNodeRelationTrustSubjectInput) => (value.confirmedEdge!.confirmedAt = null),
    ],
    [
      "inactive confirmer",
      (value: ReviewedNodeRelationTrustSubjectInput) =>
        (value.confirmedEdge!.confirmerRole = "USER"),
    ],
  ])("demotes a matching marker for %s", (_label, mutate) => {
    const changed = nodeRelationSubject();
    mutate(changed);
    const assessmentHash = reviewedNodeRelationTrustSubjectHash(changed);
    expect(
      resolveNodeRelationTrustVerification(changed, {
        status: "human-reviewed",
        assessmentHash,
      }),
    ).toMatchObject({ state: "stale-verification", effectiveStatus: "unverified-import" });
  });

  it("refuses mismatched endpoints and invalid evidence semantics before hashing", () => {
    const mismatched = nodeRelationSubject();
    mismatched.proposal.targetNodeVersionId = "other-version";
    expect(() => createReviewedNodeRelationTrustSubject(mismatched)).toThrow(/endpoints/i);

    const invalidFigure = nodeRelationSubject();
    invalidFigure.evidenceNode.kind = "figure";
    invalidFigure.evidenceNode.node.kind = "figure";
    invalidFigure.importedRecord.subject.evidenceKind = "figure";
    expect(() => createReviewedNodeRelationTrustSubject(invalidFigure)).toThrow(/figure evidence/i);

    const invalidKind = nodeRelationSubject();
    (invalidKind.evidenceNode as { kind: string }).kind = "claim";
    expect(() => createReviewedNodeRelationTrustSubject(invalidKind)).toThrow(
      /dataset, code, or figure/i,
    );
  });
});
