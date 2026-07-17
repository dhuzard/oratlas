import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveSearchQuerySchema, type PublicNodeSummary } from "@oratlas/contracts";
import type { KnowledgeIndexData } from "@oratlas/knowledge";

const mocks = vi.hoisted(() => ({
  buildKnowledgeIndex: vi.fn(),
  listPublicNodeSummaries: vi.fn(),
  findSynthesisCandidates: vi.fn(),
  getPublicSynthesisReview: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./index-builder", () => ({ buildKnowledgeIndex: mocks.buildKnowledgeIndex }));
vi.mock("./node-publication", () => ({
  listPublicNodeSummaries: mocks.listPublicNodeSummaries,
}));
vi.mock("./db", () => ({
  prisma: { review: { findMany: mocks.findSynthesisCandidates } },
}));
vi.mock("./synthesis-editorial", () => ({
  getPublicSynthesisReview: mocks.getPublicSynthesisReview,
}));

import {
  searchArchive,
  type ArchiveSearchSources,
  type ArchiveSynthesisSource,
} from "./archive-search";

const emptyIndex: KnowledgeIndexData = {
  reviews: [],
  claims: [],
  citations: [],
  identifierConflicts: [],
};

const reviewIndex: KnowledgeIndexData = {
  ...emptyIndex,
  reviews: [
    {
      reviewSlug: "repository-review",
      reviewId: "review-1",
      reviewVersionId: "repository-version-1",
      title: "Delta repository review",
      abstract: "A review maintained in a research repository.",
      keywords: ["repository"],
      domains: ["Biology"],
      authors: ["Ada Editor"],
      acceptedAt: "2026-07-14T10:00:00.000Z",
      updatedAt: "2026-07-14T10:00:00.000Z",
      publicationYear: 2026,
      commitSha: "a".repeat(40),
      hasDoi: false,
      hasTrustData: false,
      hasEvidenceData: true,
      hasHumanReviewedTrust: false,
      status: "published",
    },
  ],
};

const node: PublicNodeSummary = {
  id: "node-1",
  localNodeId: "claim-1",
  kind: "claim",
  title: "Beta knowledge node",
  abstract: "A public graph node.",
  repository: { owner: "lab", name: "atlas", url: "https://github.com/lab/atlas" },
  currentVersionId: "node-version-1",
  updatedAt: "2026-07-15T10:00:00.000Z",
};

const synthesis = (
  slug: string,
  title: string,
  freshness: ArchiveSynthesisSource["freshness"],
  acceptedAt: string,
): ArchiveSynthesisSource => ({
  slug,
  title,
  abstract: `${title} summarizes accepted public nodes.`,
  version: { id: `${slug}-version-1`, ordinal: 1, isCurrent: true },
  acceptedAt,
  freshness,
});

const sources: ArchiveSearchSources = {
  index: reviewIndex,
  nodes: [node],
  syntheses: [
    synthesis(
      "alpha-fresh",
      "Alpha fresh synthesis",
      { status: "fresh", affectedReferenceCount: 0 },
      "2026-07-17T10:00:00.000Z",
    ),
    synthesis(
      "gamma-stale",
      "Gamma stale synthesis",
      { status: "stale", affectedReferenceCount: 2 },
      "2026-07-16T10:00:00.000Z",
    ),
    synthesis(
      "epsilon-unchecked",
      "Epsilon unchecked synthesis",
      { status: "unchecked", affectedReferenceCount: 0 },
      "2026-07-13T10:00:00.000Z",
    ),
  ],
};

function validPublicSynthesis(slug: string) {
  const sectionIds = [
    "background",
    "state-of-knowledge",
    "agreements",
    "contradictions-and-open-questions",
    "data-and-code-availability",
    "limitations",
  ] as const;
  const sectionTitles = [
    "Background",
    "State of knowledge",
    "Agreements",
    "Contradictions and open questions",
    "Data and code availability",
    "Limitations",
  ] as const;
  const hash = "a".repeat(64);
  const document = {
    schemaVersion: "1.0.0" as const,
    title: "Public accepted synthesis",
    summary: "Only a fully validated public synthesis reaches the archive.",
    citations: [],
    sections: sectionIds.map((id, index) => ({
      id,
      title: sectionTitles[index],
      paragraphs: [{ text: `Grounded section ${index + 1}.`, citations: [] }],
    })),
  };
  return {
    slug,
    reviewType: "ai-synthesis" as const,
    title: document.title,
    abstract: document.summary,
    document,
    provenance: {
      generationMode: "deterministic-template" as const,
      pipelineSoftware: {
        id: "software:oratlas-synthesis-writer" as const,
        kind: "software-agent" as const,
        displayName: "Open Review Atlas Synthesis Writer" as const,
        pipelineVersion: "kg12-v1",
      },
      provider: "deterministic",
      model: "grounded-template",
      modelVersion: "1",
      promptVersion: "synthesis-prompt/1.0.0",
      promptHash: hash,
      packetHash: hash,
      documentHash: hash,
      generatedAt: "2026-07-17T09:00:00.000Z",
      acceptedAt: "2026-07-17T10:00:00.000Z",
      approvingEditor: {
        displayName: "Editor",
        githubLogin: "editor",
        roleSnapshot: "EDITOR" as const,
      },
      rightsStatement: "The editor confirms publication rights for this synthesis.",
      licenseSpdx: "CC-BY-4.0",
      checklistVersion: "synthesis-checklist/1.0.0" as const,
      acceptedPredecessorVersionId: null,
      acceptedPredecessorOrdinal: null,
      ordinal: 1,
      attributionPolicyVersion: "synthesis-attribution/1.0.0" as const,
      materializationPolicyVersion: "synthesis-materialization/1.0.0" as const,
    },
    citations: [],
    version: { id: "version-public", ordinal: 1, isCurrent: true },
    freshness: {
      status: "stale" as const,
      policyVersion: "synthesis-staleness/1.0.0" as const,
      evaluatedAt: "2026-07-17T11:00:00.000Z",
      reasonCodes: ["node-head-changed" as const],
      affectedReferenceCount: 4,
    },
  };
}

describe("archive discovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.buildKnowledgeIndex.mockResolvedValue(emptyIndex);
    mocks.listPublicNodeSummaries.mockResolvedValue([]);
  });

  it("merges all three record kinds before one deterministic pagination slice", async () => {
    const first = await searchArchive(
      archiveSearchQuerySchema.parse({ sort: "title", page: 1, pageSize: 2 }),
      sources,
    );
    const second = await searchArchive(
      archiveSearchQuerySchema.parse({ sort: "title", page: 2, pageSize: 2 }),
      sources,
    );
    const third = await searchArchive(
      archiveSearchQuerySchema.parse({ sort: "title", page: 3, pageSize: 2 }),
      sources,
    );

    expect([first.total, second.total, third.total]).toEqual([5, 5, 5]);
    const keys = [...first.items, ...second.items, ...third.items].map((item) =>
      item.contentType === "node" ? `node:${item.node.id}` : `${item.contentType}:${item.slug}`,
    );
    expect(keys).toEqual([
      "synthesis:alpha-fresh",
      "node:node-1",
      "review:repository-review",
      "synthesis:epsilon-unchecked",
      "synthesis:gamma-stale",
    ]);
    expect(new Set(keys).size).toBe(5);
  });

  it("supports distinct type filters and text search without cross-type leakage", async () => {
    for (const [contentType, expected] of [
      ["review", "review:repository-review"],
      ["node", "node:node-1"],
      ["synthesis", "synthesis:alpha-fresh"],
    ] as const) {
      const result = await searchArchive(
        archiveSearchQuerySchema.parse({ contentType, sort: "title", pageSize: 1 }),
        sources,
      );
      const item = result.items[0]!;
      const key =
        item.contentType === "node" ? `node:${item.node.id}` : `${item.contentType}:${item.slug}`;
      expect(key).toBe(expected);
      expect(result.total).toBe(contentType === "synthesis" ? 3 : 1);
    }

    const text = await searchArchive(
      archiveSearchQuerySchema.parse({ q: "stale", sort: "relevance" }),
      sources,
    );
    expect(text.items).toHaveLength(1);
    expect(text.items[0]).toMatchObject({ contentType: "synthesis", slug: "gamma-stale" });
  });

  it("preserves authoritative fresh, stale, and unchecked synthesis summaries", async () => {
    const result = await searchArchive(
      archiveSearchQuerySchema.parse({ contentType: "synthesis", sort: "title" }),
      sources,
    );
    expect(
      result.items.map((item) =>
        item.contentType === "synthesis"
          ? [item.slug, item.freshness.status, item.freshness.affectedReferenceCount]
          : null,
      ),
    ).toEqual([
      ["alpha-fresh", "fresh", 0],
      ["epsilon-unchecked", "unchecked", 0],
      ["gamma-stale", "stale", 2],
    ]);
  });

  it("fails closed per invalid, private, example, or corrupt synthesis candidate", async () => {
    mocks.findSynthesisCandidates.mockResolvedValue([
      { slug: "public" },
      { slug: "private" },
      { slug: "example" },
      { slug: "invalid-head" },
      { slug: "corrupt" },
    ]);
    mocks.getPublicSynthesisReview.mockImplementation(async (slug: string) => {
      if (slug === "corrupt") throw new Error("corrupt stored JSON");
      if (slug === "invalid-head") {
        return { ...validPublicSynthesis(slug), privateDraftId: "must-not-leak" };
      }
      return slug === "public" ? validPublicSynthesis(slug) : null;
    });

    const result = await searchArchive(
      archiveSearchQuerySchema.parse({ contentType: "synthesis" }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      contentType: "synthesis",
      slug: "public",
      freshness: { status: "stale", affectedReferenceCount: 4 },
    });
    expect(JSON.stringify(result)).not.toContain("privateDraftId");
    expect(JSON.stringify(result)).not.toContain("invalid-head");
  });

  it("bounds integrity reads while traversing every candidate for truthful totals", async () => {
    const firstBatch = Array.from({ length: 25 }, (_, index) => ({
      slug: `synthesis-${String(index).padStart(2, "0")}`,
    }));
    const finalBatch = [{ slug: "synthesis-25" }];
    mocks.findSynthesisCandidates
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(finalBatch);
    let active = 0;
    let maximumActive = 0;
    mocks.getPublicSynthesisReview.mockImplementation(async (slug: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return validPublicSynthesis(slug);
    });

    const result = await searchArchive(
      archiveSearchQuerySchema.parse({ contentType: "synthesis", pageSize: 50 }),
    );
    expect(result.total).toBe(26);
    expect(result.items).toHaveLength(26);
    expect(maximumActive).toBe(25);
    expect(mocks.findSynthesisCandidates).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { slug: "synthesis-24" },
        skip: 1,
        take: 25,
      }),
    );
  });
});
