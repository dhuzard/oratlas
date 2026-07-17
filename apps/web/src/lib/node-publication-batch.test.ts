import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@oratlas/db";

vi.mock("server-only", () => ({}));

import { getExactPublicNodeVersions, scanPublicNodeSummaries } from "./node-publication";

const createdAt = new Date("2026-07-16T10:00:00.000Z");

function storedVersion(nodeId: string, ordinal = 1) {
  const commitSha = ordinal.toString(16).padStart(40, "0");
  return {
    id: `${nodeId}-version-${ordinal}`,
    knowledgeNodeId: nodeId,
    snapshotId: `${nodeId}-snapshot-${ordinal}`,
    sourceSubmissionId: null,
    inspectionCaptureId: null,
    capturePayloadHash: null,
    title: `Node ${nodeId}`,
    abstract: null,
    text: null,
    contributorsJson: "[]",
    license: "CC-BY-4.0",
    provenanceJson: JSON.stringify({
      sourcePath: `nodes/${nodeId}.json`,
      repositoryUrl: `https://github.com/open/${nodeId}`,
      commitSha,
    }),
    payloadJson: JSON.stringify({ statement: `Claim ${nodeId}.`, qualifiers: [] }),
    versionDoi: null,
    conceptDoi: null,
    isExample: false,
    createdAt,
    snapshot: { commitSha },
  };
}

function nodeRow(index: number, currentOrdinal = 1) {
  const id = `node-${String(index).padStart(3, "0")}`;
  return {
    id,
    repositoryId: `repository-${id}`,
    localNodeId: `local-${id}`,
    kind: "claim",
    createdAt,
    updatedAt: createdAt,
    repository: {
      owner: "open",
      name: id,
      canonicalUrl: `https://github.com/open/${id}`,
    },
    versions: [storedVersion(id, currentOrdinal)],
  };
}

describe("batch exact public node projection", () => {
  it("projects the 100-node packet maximum with one current-node query", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => nodeRow(index + 1));
    const findMany = vi.fn().mockResolvedValue(rows);
    const findHistorical = vi.fn();
    const client = {
      knowledgeNode: { findMany },
      knowledgeNodeVersion: { findMany: findHistorical },
    } as unknown as PrismaClient;
    const requested = rows.map((row) => ({
      nodeId: row.id,
      nodeVersionId: row.versions[0]!.id,
    }));
    const result = await getExactPublicNodeVersions(requested, client);
    expect(result.size).toBe(100);
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany.mock.calls[0]![0]).toMatchObject({ take: 100 });
    expect(findHistorical).not.toHaveBeenCalled();
  });

  it("uses at most one bounded fallback query for exact historical versions", async () => {
    const rows = [nodeRow(1, 2), nodeRow(2, 2)];
    const historical = rows.map((row) => storedVersion(row.id, 1));
    const findHistorical = vi.fn().mockResolvedValue(historical);
    const client = {
      knowledgeNode: { findMany: vi.fn().mockResolvedValue(rows) },
      knowledgeNodeVersion: { findMany: findHistorical },
    } as unknown as PrismaClient;
    const result = await getExactPublicNodeVersions(
      rows.map((row) => ({ nodeId: row.id, nodeVersionId: `${row.id}-version-1` })),
      client,
    );
    expect(result.size).toBe(2);
    expect(findHistorical).toHaveBeenCalledOnce();
    expect(findHistorical.mock.calls[0]![0]).toMatchObject({ take: 100 });
  });

  it("fails closed before querying when the packet cardinality exceeds 100", async () => {
    const findMany = vi.fn();
    const client = {
      knowledgeNode: { findMany },
      knowledgeNodeVersion: { findMany: vi.fn() },
    } as unknown as PrismaClient;
    const requested = Array.from({ length: 101 }, (_, index) => ({
      nodeId: `node-${index}`,
      nodeVersionId: `version-${index}`,
    }));
    expect(await getExactPublicNodeVersions(requested, client)).toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("bounded public node summary scan", () => {
  it("signals an exact raw-candidate boundary when a corrupt head hides a later valid node", async () => {
    const rows = Array.from({ length: 2_001 }, (_, index) => {
      const row = nodeRow(index + 1);
      row.id = `scan-node-${String(index + 1).padStart(4, "0")}`;
      row.localNodeId = row.id;
      return row;
    });
    rows[499]!.versions[0]!.payloadJson = "{not-json";
    const justBeyondBoundary = rows[2_000]!;
    const findMany = vi.fn(
      async (query: { cursor?: { id: string }; skip?: number; take: number }) => {
        const cursorIndex = query.cursor
          ? rows.findIndex((row) => row.id === query.cursor!.id)
          : -1;
        const start = cursorIndex + (query.skip ?? 1);
        return rows.slice(start, start + query.take);
      },
    );
    const client = { knowledgeNode: { findMany } } as unknown as PrismaClient;

    const result = await scanPublicNodeSummaries(undefined, client);

    expect(result).toMatchObject({
      scannedCandidateCount: 2_000,
      candidateLimit: 2_000,
      candidateLimitReached: true,
    });
    expect(result.items).toHaveLength(1_999);
    expect(result.items.some((item) => item.id === rows[499]!.id)).toBe(false);
    expect(result.items.some((item) => item.id === justBeyondBoundary.id)).toBe(false);
    expect(findMany).toHaveBeenCalledTimes(10);
    expect(findMany.mock.calls.every(([query]) => query.take <= 201)).toBe(true);
  });

  it("propagates candidate-page infrastructure failures", async () => {
    const failure = new Error("database unavailable");
    const client = {
      knowledgeNode: { findMany: vi.fn().mockRejectedValue(failure) },
    } as unknown as PrismaClient;
    await expect(scanPublicNodeSummaries(undefined, client)).rejects.toBe(failure);
  });
});
