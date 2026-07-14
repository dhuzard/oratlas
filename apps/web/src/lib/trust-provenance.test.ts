import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./db.js", () => ({ prisma: {} }));

import {
  resolveLoadedTrustAssessment,
  verifyTrustAssessmentInTransaction,
  type LoadedTrustAssessment,
  type TrustEditorialError,
} from "./trust-provenance.js";

function loadedRow(): LoadedTrustAssessment {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "assessment-1",
    claimEvidenceRelationId: "relation-1",
    protocolVersion: "trust-poc-1.0",
    assessorType: "agent",
    assessorId: "repository-agent",
    assessedAt: now,
    identityIntegrity: null,
    entailment: '{"rating":"high","status":"assessed"}',
    sourceAccess: null,
    populationRelevance: null,
    interventionExposureRelevance: null,
    outcomeRelevance: null,
    methodologicalSafeguards: null,
    statisticalSafeguards: null,
    replicationConvergence: null,
    conflictDependency: null,
    limitationsJson: "[]",
    evidenceJson: '{"pointer":"evidence.json:1"}',
    aggregateScore: 0.75,
    aggregateMethod: "ordinal-mean-1.0",
    reviewStatus: "unverified-import",
    adjudicatorId: null,
    adjudicatedAt: null,
    sourceRecordJson: '{"reviewStatus":"agent-proposed"}',
    sourceReviewStatus: "agent-proposed",
    sourceAssessorType: "agent",
    sourceAssessorId: "repository-agent",
    sourceAssessedAt: now,
    sourceEvidenceJson: '{"pointer":"evidence.json:1"}',
    sourceAggregateScore: null,
    sourceAggregateMethod: null,
    sourceRelationHumanReviewed: false,
    revision: 2,
    createdAt: now,
    updatedAt: now,
    verification: null,
    relation: {
      id: "relation-1",
      claimId: "claim-1",
      citationId: "citation-1",
      relationType: "supports",
      supportDirection: "positive",
      sourceLocation: "relations.jsonl:1",
      extractionMethod: "repository-import",
      extractionConfidence: 0.9,
      humanReviewed: false,
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
        scopeJson: null,
        createdAt: now,
        reviewVersion: {
          id: "version-1",
          reviewId: "review-1",
          snapshotId: "snapshot-1",
          sourceSubmissionId: null,
          inspectionCaptureId: null,
          sourceKind: null,
          sourceBranch: null,
          sourceSelectionKey: null,
          tagObjectSha: null,
          sourceCreatedAt: null,
          semanticVersion: "1.0.0",
          title: "Review",
          abstract: null,
          metadataJson: "{}",
          versionDoi: null,
          conceptDoi: null,
          zenodoRecordId: null,
          releaseTag: null,
          releaseUrl: null,
          publicationConsistencyJson: null,
          capturePayloadHash: null,
          isExample: false,
          publishedAt: now,
          createdAt: now,
          publicState: "published",
          review: {
            id: "review-1",
            slug: "review",
            repositoryId: null,
            currentSnapshotId: "snapshot-1",
            title: "Review",
            abstract: null,
            reviewType: null,
            licenseSpdx: null,
            publishedReviewUrl: null,
            status: "published",
            acceptedAt: now,
            createdAt: now,
            updatedAt: now,
            lifecycleRevision: 0,
          },
        },
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
        datasetIdsJson: "[]",
        derivedFromJson: "[]",
        rawCitationJson: null,
      },
    },
  };
}

function fakeTransaction(row: LoadedTrustAssessment, casCount = 1) {
  const calls = { upsert: [] as unknown[], audit: [] as unknown[] };
  return {
    calls,
    tx: {
      trustAssessment: {
        async findUnique() {
          return row;
        },
        async updateMany() {
          return { count: casCount };
        },
      },
      trustVerification: {
        async upsert(args: unknown) {
          calls.upsert.push(args);
          return {};
        },
      },
      auditEvent: {
        async create(args: unknown) {
          calls.audit.push(args);
          return {};
        },
      },
    },
  };
}

describe("TRUST editorial verification transaction", () => {
  it("records a hash-bound marker only after the revision CAS", async () => {
    const row = loadedRow();
    const currentHash = resolveLoadedTrustAssessment(row).currentHash;
    const { tx, calls } = fakeTransaction(row);

    const result = await verifyTrustAssessmentInTransaction(
      tx,
      {
        assessmentId: row.id,
        status: "human-reviewed",
        rationale: "Checked criterion provenance and evidence pointers.",
        expectedRevision: 2,
        expectedAssessmentHash: currentHash,
      },
      { id: "editor-1", role: "EDITOR" },
    );

    expect(result).toEqual({ status: "human-reviewed", assessmentHash: currentHash, revision: 3 });
    expect(calls.upsert).toHaveLength(1);
    expect(calls.audit).toHaveLength(1);
  });

  it("rejects a stale subject before any marker write", async () => {
    const row = loadedRow();
    const { tx, calls } = fakeTransaction(row);
    await expect(
      verifyTrustAssessmentInTransaction(
        tx,
        {
          assessmentId: row.id,
          status: "adjudicated",
          rationale: "Reviewed both competing structural interpretations.",
          expectedRevision: 2,
          expectedAssessmentHash: "0".repeat(64),
        },
        { id: "editor-1", role: "ADMIN" },
      ),
    ).rejects.toMatchObject({ code: "conflict" } satisfies Partial<TrustEditorialError>);
    expect(calls.upsert).toHaveLength(0);
  });

  it("rejects a lost revision race before marker and audit writes", async () => {
    const row = loadedRow();
    const { tx, calls } = fakeTransaction(row, 0);
    await expect(
      verifyTrustAssessmentInTransaction(
        tx,
        {
          assessmentId: row.id,
          status: "human-reviewed",
          rationale: "Checked criterion provenance and evidence pointers.",
          expectedRevision: 2,
          expectedAssessmentHash: resolveLoadedTrustAssessment(row).currentHash,
        },
        { id: "editor-1", role: "EDITOR" },
      ),
    ).rejects.toMatchObject({ code: "conflict" } satisfies Partial<TrustEditorialError>);
    expect(calls.upsert).toHaveLength(0);
    expect(calls.audit).toHaveLength(0);
  });
});
