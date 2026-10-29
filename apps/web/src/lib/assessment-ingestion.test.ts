import { describe, expect, it, vi } from "vitest";
import type { NodeRelationTrustRecord, TrustRecord } from "@oratlas/contracts";
import type { Prisma } from "@oratlas/db";
import {
  ingestNodeRelationTrustAssessment,
  ingestTrustAssessment,
  ingestTrustAssessmentsForFreshRelations,
} from "./assessment-ingestion.js";

type Stored = Record<string, unknown> & { id: string; createdAt: Date };

function fakeDelegate(parentField: string) {
  const rows: Stored[] = [];
  return {
    rows,
    delegate: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const create of data)
          rows.push({ ...create, id: `assessment-${rows.length + 1}`, createdAt: new Date() });
        return { count: data.length };
      },
      findUnique: async ({ where }: { where: Record<string, Record<string, string>> }) => {
        const identity = Object.values(where)[0]!;
        return (
          rows.find((row) =>
            Object.entries(identity).every(([key, value]) => row[key] === value),
          ) ?? null
        );
      },
      upsert: async ({
        where,
        create,
      }: {
        where: Record<string, Record<string, string>>;
        create: Record<string, unknown>;
      }) => {
        const identity = Object.values(where)[0]!;
        const existing = rows.find((row) =>
          Object.entries(identity).every(([key, value]) => row[key] === value),
        );
        if (existing) return existing;
        const row: Stored = {
          ...create,
          id: `assessment-${rows.length + 1}`,
          createdAt: new Date(),
        };
        if (!row[parentField]) throw new Error(`missing ${parentField}`);
        rows.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, string> }) =>
        [...rows]
          .reverse()
          .find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
    },
  };
}

const claimRecord: TrustRecord = {
  claimId: "claim-1",
  citationId: "citation-1",
  protocolVersion: "trust-poc-1.0",
  assessorType: "human",
  assessorId: "alice",
  assessedAt: "2026-07-01T00:00:00.000Z",
  criteria: { entailment: { rating: "high", status: "assessed" } },
  reviewStatus: "human-reviewed",
};

const nodeRecord: NodeRelationTrustRecord = {
  subjectType: "node-relation",
  subject: {
    claimNodeId: "claim-1",
    evidenceNodeId: "code-1",
    evidenceKind: "code",
    relationType: "uses-code",
  },
  protocolVersion: "trust-poc-1.0",
  assessorType: "agent",
  assessorId: "agent-a",
  assessedAt: "2026-07-01T00:00:00.000Z",
  conflictOfInterest: { status: "conflict-declared" },
  criteria: { methodologicalSafeguards: { rating: "moderate", status: "assessed" } },
  reviewStatus: "agent-proposed",
};

describe("multiple-assessment ingestion", () => {
  it("bounds singleton batches and avoids lookups for fresh subjects", async () => {
    const claim = fakeDelegate("claimEvidenceRelationId");
    const createMany = vi.fn(claim.delegate.createMany);
    const findUnique = vi.fn(claim.delegate.findUnique);
    const tx = {
      trustAssessment: { ...claim.delegate, createMany, findUnique },
    } as unknown as Prisma.TransactionClient;
    await ingestTrustAssessmentsForFreshRelations(
      tx,
      Array.from({ length: 81 }, (_, index) => ({
        claimEvidenceRelationId: `fresh-${index}`,
        record: claimRecord,
        sourceRelationHumanReviewed: false,
      })),
    );
    expect(createMany.mock.calls.map(([args]) => args.data.length)).toEqual([40, 40, 1]);
    expect(findUnique).not.toHaveBeenCalled();
    expect(claim.rows).toHaveLength(81);
    await ingestTrustAssessmentsForFreshRelations(tx, []);
    expect(createMany).toHaveBeenCalledTimes(3);
  });

  it("batches fresh singleton subjects with the same complete normalized provenance", async () => {
    const sequential = fakeDelegate("claimEvidenceRelationId");
    const batched = fakeDelegate("claimEvidenceRelationId");
    const record = {
      ...claimRecord,
      conflictOfInterest: { status: "conflict-declared" as const },
      limitations: ["source limitation"],
      aggregateScore: 0.5,
      aggregateMethod: "source-method",
      evidence: { source: "evidence/source.md", declaration: "producer assertion" },
    };
    const baseline = await ingestTrustAssessment(
      { trustAssessment: sequential.delegate } as unknown as Prisma.TransactionClient,
      "relation-1",
      record,
      true,
    );
    await ingestTrustAssessmentsForFreshRelations(
      { trustAssessment: batched.delegate } as unknown as Prisma.TransactionClient,
      [{ claimEvidenceRelationId: "relation-1", record, sourceRelationHumanReviewed: true }],
    );
    const { id: _id, createdAt: _createdAt, ...expected } = baseline;
    const { id: _batchId, createdAt: _batchCreatedAt, ...actual } = batched.rows[0]!;
    expect(actual).toEqual(expected);
    expect(actual.reviewStatus).toBe("unverified-import");
    expect(actual.sourceRelationHumanReviewed).toBe(true);
    expect(actual.conflictOfInterestStatus).toBe("conflict-declared");
    expect(actual.sourceAggregateScore).toBe(0.5);
    expect(actual.sourceAggregateMethod).toBe("source-method");
    expect(actual.sourceEvidenceJson).toBe(actual.evidenceJson);
    expect(actual.sourceAssessorId).toBe("alice");
    expect(actual.sourceAssessedAt).toEqual(new Date(claimRecord.assessedAt!));
    expect(actual.sourceRecordHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves exact deduplication and supersession in mixed fresh subject groups", async () => {
    const claim = fakeDelegate("claimEvidenceRelationId");
    const tx = { trustAssessment: claim.delegate } as unknown as Prisma.TransactionClient;
    const changed = {
      ...claimRecord,
      criteria: { entailment: { rating: "low" as const, status: "assessed" as const } },
    };
    await ingestTrustAssessmentsForFreshRelations(tx, [
      { claimEvidenceRelationId: "multi", record: claimRecord, sourceRelationHumanReviewed: false },
      {
        claimEvidenceRelationId: "singleton",
        record: claimRecord,
        sourceRelationHumanReviewed: null,
      },
      {
        claimEvidenceRelationId: "multi",
        record: structuredClone(claimRecord),
        sourceRelationHumanReviewed: false,
      },
      { claimEvidenceRelationId: "multi", record: changed, sourceRelationHumanReviewed: false },
      {
        claimEvidenceRelationId: "multi",
        record: { ...claimRecord, assessorId: "bob" },
        sourceRelationHumanReviewed: false,
      },
    ]);
    expect(claim.rows).toHaveLength(4);
    const multi = claim.rows.filter((row) => row.claimEvidenceRelationId === "multi");
    expect(multi).toHaveLength(3);
    expect(multi[1]!.supersedesAssessmentId).toBe(multi[0]!.id);
    expect(multi[2]!.supersedesAssessmentId).toBeUndefined();
    expect(
      claim.rows.find((row) => row.claimEvidenceRelationId === "singleton")!
        .sourceRelationHumanReviewed,
    ).toBeNull();
  });

  it("coexists, reuses an exact source record, and appends a changed claim assessment", async () => {
    const claim = fakeDelegate("claimEvidenceRelationId");
    const tx = { trustAssessment: claim.delegate } as unknown as Prisma.TransactionClient;

    const first = await ingestTrustAssessment(tx, "relation-1", claimRecord, false);
    const other = await ingestTrustAssessment(
      tx,
      "relation-1",
      { ...claimRecord, assessorId: "bob" },
      false,
    );
    const replay = await ingestTrustAssessment(
      tx,
      "relation-1",
      structuredClone(claimRecord),
      false,
    );
    const changed = await ingestTrustAssessment(
      tx,
      "relation-1",
      {
        ...claimRecord,
        criteria: { entailment: { rating: "low", status: "assessed" } },
      },
      false,
    );

    expect(claim.rows).toHaveLength(3);
    expect(replay.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
    expect(changed.supersedesAssessmentId).toBe(first.id);
    expect(changed.id).not.toBe(first.id);
    expect(first.conflictOfInterestStatus).toBe("not-provided");
    expect(first.sourceRecordJson).toContain('"conflictOfInterest":{"status":"not-provided"}');
  });

  it("applies the same append-only source lineage to node-relation assessments", async () => {
    const node = fakeDelegate("nodeEdgeProposalId");
    const tx = {
      nodeRelationTrustAssessment: node.delegate,
    } as unknown as Prisma.TransactionClient;

    const first = await ingestNodeRelationTrustAssessment(tx, "proposal-1", nodeRecord);
    const replay = await ingestNodeRelationTrustAssessment(
      tx,
      "proposal-1",
      structuredClone(nodeRecord),
    );
    const changed = await ingestNodeRelationTrustAssessment(tx, "proposal-1", {
      ...nodeRecord,
      criteria: { methodologicalSafeguards: { rating: "high", status: "assessed" } },
    });

    expect(node.rows).toHaveLength(2);
    expect(replay.id).toBe(first.id);
    expect(changed.supersedesAssessmentId).toBe(first.id);
    expect(first.conflictOfInterestStatus).toBe("conflict-declared");
    expect(first.sourceRecordJson).toContain('"conflictOfInterest":{"status":"conflict-declared"}');
  });

  it("binds the immutable COI snapshot into source identity", async () => {
    const claim = fakeDelegate("claimEvidenceRelationId");
    const tx = { trustAssessment: claim.delegate } as unknown as Prisma.TransactionClient;

    const missing = await ingestTrustAssessment(tx, "relation-1", claimRecord, false);
    const declared = await ingestTrustAssessment(
      tx,
      "relation-1",
      { ...claimRecord, conflictOfInterest: { status: "none-declared" } },
      false,
    );

    expect(declared.id).not.toBe(missing.id);
    expect(declared.sourceRecordHash).not.toBe(missing.sourceRecordHash);
    expect(declared.conflictOfInterestStatus).toBe("none-declared");
  });
});
