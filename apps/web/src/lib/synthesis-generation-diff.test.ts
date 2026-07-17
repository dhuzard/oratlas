import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@oratlas/db";
import type { SubgraphEvidenceSource } from "@oratlas/contracts";
import {
  buildPreparedSubgraphEvidencePacket,
  composeDeterministicSynthesis,
  fingerprintSubgraphEvidenceSelection,
  prepareSynthesisGenerationSnapshot,
} from "@oratlas/knowledge";

vi.mock("server-only", () => ({}));
vi.mock("./synthesis-editorial", () => ({ getPublicSynthesisReview: vi.fn() }));

import { getPublicSynthesisReview } from "./synthesis-editorial";
import { getPublicSynthesisGenerationDiff } from "./synthesis-generation-diff";

const mockedPublicReview = vi.mocked(getPublicSynthesisReview);
const seriesKey = "a".repeat(64);

function generation(ordinal: number) {
  const nodeId = "node-a";
  const versionId = "node-a-v" + ordinal;
  const commitSha = String(ordinal).repeat(40);
  const selection = { kind: "seed" as const, nodeId, versionId };
  const source: SubgraphEvidenceSource = {
    schemaVersion: "bounded-subgraph/1.0.0",
    selection,
    source: {
      kind: "bounded-supplied-subgraph",
      selectorFingerprint: fingerprintSubgraphEvidenceSelection(selection),
    },
    declaredCounts: { nodeCount: 1, edgeCount: 0, contradictionEdgeIds: [] },
    nodes: [
      {
        id: nodeId,
        localNodeId: nodeId,
        repository: {
          owner: "atlas",
          name: "review",
          url: "https://github.com/atlas/review",
        },
        versionId,
        snapshotId: "snapshot-" + ordinal,
        commitSha,
        title: "Evidence generation " + ordinal,
        contributors: [{ displayName: "Atlas Author" }],
        license: "CC-BY-4.0",
        provenance: {
          sourcePath: "knowledge/claim.json",
          repositoryUrl: "https://github.com/atlas/review",
          commitSha,
        },
        identifiers: [],
        isExample: false,
        createdAt: "2026-0" + ordinal + "-01T00:00:00.000Z",
        kind: "claim",
        payload: { statement: "Generation " + ordinal + " evidence.", qualifiers: [] },
      },
    ],
    edges: [],
  };
  const prepared = buildPreparedSubgraphEvidencePacket(source);
  return prepareSynthesisGenerationSnapshot(prepared, composeDeterministicSynthesis(prepared));
}

function row(
  ordinal: number,
  previous?: {
    id: string;
    reviewId: string;
    recordSourceType: string;
    publicState: string;
    synthesisOrdinal: number;
    synthesisDraftId: string;
    synthesisDraft: { id: string };
  },
) {
  const snapshot = generation(ordinal);
  const id = "version-" + ordinal;
  const draftId = "draft-" + ordinal;
  const acceptedAt = new Date("2026-0" + ordinal + "-15T00:00:00.000Z");
  const draft = {
    id: draftId,
    seriesKey,
    status: "accepted",
    reviewId: "review-1",
    packetJson: snapshot.packetJson,
    packetHash: snapshot.packetHash,
    documentJson: snapshot.documentJson,
    documentHash: snapshot.documentHash,
    acceptedAt,
    acceptedById: "editor-1",
    acceptedByRoleSnapshot: "EDITOR",
    acceptedByDisplayName: "Atlas Editor",
    acceptedByGithubLogin: "editor",
    previousAcceptedDraftId: previous?.synthesisDraft.id ?? null,
    previousAcceptedOrdinal: previous?.synthesisOrdinal ?? null,
    reviewVersion: { id, synthesisOrdinal: ordinal },
  };
  return {
    id,
    reviewId: "review-1",
    recordSourceType: "synthesis",
    snapshotId: null,
    isExample: false,
    publicState: "published",
    synthesisOrdinal: ordinal,
    synthesisDraftId: draftId,
    synthesisDocumentJson: snapshot.documentJson,
    synthesisPacketHash: snapshot.packetHash,
    synthesisDocumentHash: snapshot.documentHash,
    synthesisAcceptedAt: acceptedAt,
    synthesisApprovedById: "editor-1",
    synthesisApproverRole: "EDITOR",
    synthesisApproverDisplayName: "Atlas Editor",
    synthesisApproverGithubLogin: "editor",
    sourceSelectionKey: seriesKey + ":" + ordinal,
    title: snapshot.document.title,
    abstract: snapshot.document.summary,
    acceptedPredecessorVersionId: previous?.id ?? null,
    acceptedPredecessor: previous
      ? {
          id: previous.id,
          reviewId: previous.reviewId,
          recordSourceType: previous.recordSourceType,
          publicState: previous.publicState,
          synthesisOrdinal: previous.synthesisOrdinal,
          synthesisDraftId: previous.synthesisDraftId,
        }
      : null,
    synthesisDraft: draft,
  };
}

type FakeRow = ReturnType<typeof row>;

const review = {
  id: "review-1",
  slug: "bounded-synthesis",
  title: "Bounded synthesis",
  status: "published",
  reviewType: "ai-synthesis",
  repositoryId: null,
  currentSnapshotId: null,
  synthesisSeriesKey: seriesKey,
  currentSynthesisVersionId: "version-3",
};

function fixtures() {
  const first = row(1);
  const second = row(2, first);
  const third = row(3, second);
  return { first, second, third };
}

function client(rows: FakeRow[], reviewValue: typeof review | null = review): PrismaClient {
  const byId = new Map(rows.map((value) => [value.id, value]));
  return {
    review: {
      findUnique: vi.fn(async () => reviewValue),
    },
    reviewVersion: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null),
    },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  mockedPublicReview.mockReset();
  mockedPublicReview.mockResolvedValue({
    title: "Current bounded synthesis",
    version: { id: "version-3", ordinal: 3 },
  } as Awaited<ReturnType<typeof getPublicSynthesisReview>>);
});

describe("public synthesis generation diff loader", () => {
  it("loads the current direct predecessor by default without exposing private records", async () => {
    const values = fixtures();
    const result = await getPublicSynthesisGenerationDiff(
      review.slug,
      {},
      client([values.first, values.second, values.third]),
    );
    expect(result).toMatchObject({
      slug: review.slug,
      from: { id: "version-2", ordinal: 2 },
      to: { id: "version-3", ordinal: 3 },
      delta: {
        nodes: {
          reassessed: [
            {
              nodeId: "node-a",
              previous: { nodeVersionId: "node-a-v2" },
              current: { nodeVersionId: "node-a-v3" },
            },
          ],
        },
      },
    });
    const serialized = JSON.stringify(result);
    for (const privateField of [
      "packetJson",
      "documentJson",
      "synthesisDraft",
      "agentRun",
      "decisionRationale",
    ]) {
      expect(serialized).not.toContain(privateField);
    }
  });

  it("allows one exact historical predecessor pair and rejects non-predecessor selection", async () => {
    const values = fixtures();
    const future = row(4, values.third);
    const database = client([values.first, values.second, values.third, future]);
    await expect(
      getPublicSynthesisGenerationDiff(
        review.slug,
        { fromVersionId: "version-1", toVersionId: "version-2" },
        database,
      ),
    ).resolves.toMatchObject({ from: { ordinal: 1 }, to: { ordinal: 2 } });
    await expect(
      getPublicSynthesisGenerationDiff(
        review.slug,
        { fromVersionId: "version-1", toVersionId: "version-3" },
        database,
      ),
    ).resolves.toBeNull();
    await expect(
      getPublicSynthesisGenerationDiff(
        review.slug,
        { fromVersionId: "version-3", toVersionId: "version-4" },
        database,
      ),
    ).resolves.toBeNull();
    await expect(
      getPublicSynthesisGenerationDiff(review.slug, { fromVersionId: ["version-1"] }, database),
    ).resolves.toBeNull();
  });

  it("rejects private, rejected, tombstoned, cross-series and tampered generations", async () => {
    const values = fixtures();
    mockedPublicReview.mockResolvedValueOnce(null);
    await expect(
      getPublicSynthesisGenerationDiff(
        review.slug,
        {},
        client([values.first, values.second, values.third]),
      ),
    ).resolves.toBeNull();

    const rejected = structuredClone(values.second);
    rejected.synthesisDraft.status = "rejected";
    await expect(
      getPublicSynthesisGenerationDiff(
        review.slug,
        { fromVersionId: "version-1", toVersionId: "version-2" },
        client([values.first, rejected, values.third]),
      ),
    ).resolves.toBeNull();

    const tombstoned = structuredClone(values.second);
    tombstoned.publicState = "tombstoned";
    await expect(
      getPublicSynthesisGenerationDiff(
        review.slug,
        { fromVersionId: "version-1", toVersionId: "version-2" },
        client([values.first, tombstoned, values.third]),
      ),
    ).resolves.toBeNull();

    const crossSeries = structuredClone(values.second);
    crossSeries.synthesisDraft.seriesKey = "b".repeat(64);
    await expect(
      getPublicSynthesisGenerationDiff(
        review.slug,
        { fromVersionId: "version-1", toVersionId: "version-2" },
        client([values.first, crossSeries, values.third]),
      ),
    ).resolves.toBeNull();

    const tampered = structuredClone(values.second);
    tampered.synthesisDraft.packetJson = tampered.synthesisDraft.packetJson.replace(
      "Evidence generation 2",
      "Tampered private evidence",
    );
    await expect(
      getPublicSynthesisGenerationDiff(
        review.slug,
        { fromVersionId: "version-1", toVersionId: "version-2" },
        client([values.first, tampered, values.third]),
      ),
    ).resolves.toBeNull();
  });
});
