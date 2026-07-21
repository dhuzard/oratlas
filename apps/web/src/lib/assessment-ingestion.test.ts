import { describe, expect, it } from "vitest";
import type { NodeRelationTrustRecord, TrustRecord } from "@oratlas/contracts";
import type { Prisma } from "@oratlas/db";
import {
  ingestNodeRelationTrustAssessment,
  ingestTrustAssessment,
} from "./assessment-ingestion.js";

type Stored = Record<string, unknown> & { id: string; createdAt: Date };

function fakeDelegate(parentField: string) {
  const rows: Stored[] = [];
  return {
    rows,
    delegate: {
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
  criteria: { methodologicalSafeguards: { rating: "moderate", status: "assessed" } },
  reviewStatus: "agent-proposed",
};

describe("multiple-assessment ingestion", () => {
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
  });
});
