import { describe, expect, it } from "vitest";
import { evidencePacketSchema } from "./discussion.js";
import {
  subgraphEvidenceSourceSchema,
  subgraphEvidenceTrustSchema,
  SUBGRAPH_EVIDENCE_LIMITS,
} from "./subgraph-evidence.js";

describe("subgraph evidence contracts", () => {
  it("keeps the legacy Atlas Discuss EvidencePacket 1.1 contract unchanged", () => {
    expect(
      evidencePacketSchema.safeParse({
        schemaVersion: "1.1.0",
        question: "What is known?",
        builtAt: "2026-01-01T00:00:00.000Z",
        reviews: [],
        claims: [],
        citations: [],
        identifierConflicts: [],
      }).success,
    ).toBe(true);
    expect(evidencePacketSchema.safeParse({ schemaVersion: "1.0.0" }).success).toBe(false);
  });

  it("requires a bounded supplied source, declared counts, and rejects pagination/private fields", () => {
    const base = {
      schemaVersion: "bounded-subgraph/1.0.0",
      selection: { kind: "seed", nodeId: "node", versionId: "version" },
      source: { kind: "bounded-supplied-subgraph", selectorFingerprint: "a".repeat(64) },
      declaredCounts: { nodeCount: 0, edgeCount: 0, contradictionEdgeIds: [] },
      nodes: [],
      edges: [],
    };
    expect(subgraphEvidenceSourceSchema.safeParse(base).success).toBe(true);
    expect(
      subgraphEvidenceSourceSchema.safeParse({ ...base, page: { nextCursor: "cursor" } }).success,
    ).toBe(false);
    expect(
      subgraphEvidenceSourceSchema.safeParse({ ...base, editorNotes: "private" }).success,
    ).toBe(false);
  });

  it("enforces strict source count caps", () => {
    const result = subgraphEvidenceSourceSchema.safeParse({
      schemaVersion: "bounded-subgraph/1.0.0",
      selection: { kind: "seed", nodeId: "node", versionId: "version" },
      source: { kind: "bounded-supplied-subgraph", selectorFingerprint: "a".repeat(64) },
      declaredCounts: {
        nodeCount: SUBGRAPH_EVIDENCE_LIMITS.maxNodes + 1,
        edgeCount: 0,
        contradictionEdgeIds: [],
      },
      nodes: [],
      edges: [],
    });
    expect(result.success).toBe(false);
  });

  it("requires exact TRUST subjects, verified status semantics, and documented aggregates", () => {
    const trust = {
      subject: {
        sourceNodeId: "claim",
        sourceVersionId: "claim-v1",
        targetNodeId: "dataset",
        targetVersionId: "dataset-v1",
        relationType: "uses-dataset",
      },
      assessmentId: "trust-1",
      protocolVersion: "TRUST-1.0",
      reviewStatus: "human-reviewed",
      verificationState: "platform-verified",
      criteria: [
        {
          criterion: "sourceAccess",
          rating: "high",
          status: "assessed",
        },
      ],
      aggregateScore: 0.75,
      aggregateMethod: "ordinal-mean-1.0",
    };
    expect(subgraphEvidenceTrustSchema.safeParse(trust).success).toBe(true);
    expect(subgraphEvidenceTrustSchema.safeParse({ ...trust, subject: undefined }).success).toBe(
      false,
    );
    expect(subgraphEvidenceTrustSchema.safeParse({ ...trust, criteria: [] }).success).toBe(false);
    expect(
      subgraphEvidenceTrustSchema.safeParse({ ...trust, aggregateMethod: undefined }).success,
    ).toBe(false);
    expect(subgraphEvidenceTrustSchema.safeParse({ ...trust, aggregateScore: 1 }).success).toBe(
      false,
    );
    expect(
      subgraphEvidenceTrustSchema.safeParse({
        ...trust,
        verificationState: "stale-verification",
        reviewStatus: "adjudicated",
      }).success,
    ).toBe(false);
    expect(
      subgraphEvidenceTrustSchema.safeParse({
        ...trust,
        verificationState: "platform-verified",
        reviewStatus: "unverified-import",
      }).success,
    ).toBe(false);
    expect(
      subgraphEvidenceTrustSchema.safeParse({
        ...trust,
        verificationState: "stale-verification",
        reviewStatus: "unverified-import",
        aggregateScore: undefined,
        aggregateMethod: undefined,
      }).success,
    ).toBe(true);
    expect(
      subgraphEvidenceTrustSchema.safeParse({
        ...trust,
        criteria: [
          {
            criterion: "sourceAccess",
            rating: "very-high",
            status: "not-assessed",
          },
        ],
        aggregateScore: undefined,
        aggregateMethod: undefined,
      }).success,
    ).toBe(false);
  });
});
