import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({
  prisma: {
    review: { findMany: vi.fn() },
    knowledgeNode: { findMany: vi.fn() },
  },
}));
vi.mock("./node-publication", () => ({
  tryMapPublicNodeVersion: vi.fn(() => undefined),
}));

import {
  buildSitemapRecords,
  SITEMAP_URL_LIMIT,
  type SitemapNodeRow,
  type SitemapReviewRow,
} from "./sitemap-records";

const commitSha = "a".repeat(40);
const publishedAt = new Date("2026-07-01T12:00:00.000Z");
const updatedAt = new Date("2026-07-02T12:00:00.000Z");

function repositoryVersion(
  id: string,
  overrides: Record<string, unknown> = {},
): SitemapReviewRow["versions"][number] {
  return {
    id,
    reviewId: "review-1",
    recordSourceType: "repository",
    snapshotId: `snapshot-${id}`,
    snapshot: { commitSha },
    isExample: false,
    publicState: "published",
    publishedAt,
    createdAt: publishedAt,
    synthesisOrdinal: null,
    synthesisDraftId: null,
    sourceSelectionKey: null,
    synthesisAcceptedAt: null,
    synthesisDraft: null,
    ...overrides,
  } as SitemapReviewRow["versions"][number];
}

function repositoryReview(
  slug: string,
  versions: SitemapReviewRow["versions"],
  overrides: Record<string, unknown> = {},
): SitemapReviewRow {
  return {
    id: "review-1",
    slug,
    reviewType: "systematic",
    repositoryId: "repository-1",
    currentSnapshotId: versions[0]?.snapshotId ?? null,
    synthesisSeriesKey: null,
    currentSynthesisVersionId: null,
    updatedAt,
    versions,
    ...overrides,
  } as SitemapReviewRow;
}

function synthesisVersion(
  id: string,
  ordinal: number,
  overrides: Record<string, unknown> = {},
): SitemapReviewRow["versions"][number] {
  const acceptedAt = new Date(`2026-07-${String(ordinal).padStart(2, "0")}T12:00:00.000Z`);
  return {
    id,
    reviewId: "synthesis-review",
    recordSourceType: "synthesis",
    snapshotId: null,
    snapshot: null,
    isExample: false,
    publicState: "published",
    publishedAt: acceptedAt,
    createdAt: acceptedAt,
    synthesisOrdinal: ordinal,
    synthesisDraftId: `draft-${id}`,
    sourceSelectionKey: `series-1:${ordinal}`,
    synthesisAcceptedAt: acceptedAt,
    synthesisDraft: {
      id: `draft-${id}`,
      reviewId: "synthesis-review",
      seriesKey: "series-1",
      status: "accepted",
      acceptedAt,
      reviewVersion: { id, synthesisOrdinal: ordinal },
    },
    ...overrides,
  } as SitemapReviewRow["versions"][number];
}

function synthesisReview(
  versions: SitemapReviewRow["versions"],
  currentSynthesisVersionId = versions[0]?.id ?? null,
): SitemapReviewRow {
  return {
    id: "synthesis-review",
    slug: "accepted-synthesis",
    reviewType: "ai-synthesis",
    repositoryId: null,
    currentSnapshotId: null,
    synthesisSeriesKey: "series-1",
    currentSynthesisVersionId,
    updatedAt,
    versions,
  } as SitemapReviewRow;
}

function nodeVersion(
  id: string,
  overrides: Record<string, unknown> = {},
): SitemapNodeRow["versions"][number] {
  return {
    id,
    snapshotId: `snapshot-${id}`,
    title: `Title ${id}`,
    abstract: null,
    text: null,
    contributorsJson: "[]",
    license: "CC-BY-4.0",
    provenanceJson: "{}",
    payloadJson: "{}",
    versionDoi: null,
    conceptDoi: null,
    isExample: false,
    createdAt: publishedAt,
    snapshot: { commitSha },
    ...overrides,
  } as SitemapNodeRow["versions"][number];
}

function node(
  id: string,
  versions: SitemapNodeRow["versions"],
  overrides: Record<string, unknown> = {},
): SitemapNodeRow {
  return {
    id,
    kind: "claim",
    repositoryId: "repository-1",
    repository: { id: "repository-1" },
    updatedAt,
    versions,
    ...overrides,
  } as SitemapNodeRow;
}

const mapsValidNodeVersion = (_node: unknown, version: { title: string | null }) =>
  version.title?.startsWith("Corrupt") ? undefined : ({ id: "mapped" } as never);

describe("sitemap records", () => {
  it("includes static, current, and exact repository-review URLs while failing closed", () => {
    const current = repositoryVersion("current");
    const withdrawn = repositoryVersion("withdrawn", {
      publicState: "withdrawn",
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
    });
    const tombstoned = repositoryVersion("withheld", { publicState: "tombstoned" });
    const example = repositoryVersion("fixture", { isExample: true });
    const invalidCommit = repositoryVersion("invalid", {
      snapshot: { commitSha: "not-an-exact-commit" },
    });
    const records = buildSitemapRecords({
      reviews: [
        repositoryReview("public review", [current, withdrawn, tombstoned, example, invalidCommit]),
        repositoryReview("withheld-head", [tombstoned, withdrawn]),
      ],
      nodes: [],
    });
    const paths = records.map(({ path }) => path);

    expect(paths).toEqual([...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(paths).toEqual(
      expect.arrayContaining([
        "/",
        "/api-docs",
        "/archive",
        "/compare",
        "/create-review",
        "/explore",
        "/reviews/public%20review",
        "/reviews/public%20review/versions/current",
        "/reviews/public%20review/versions/withdrawn",
        "/reviews/withheld-head/versions/withdrawn",
      ]),
    );
    expect(paths).not.toContain("/reviews/withheld-head");
    expect(paths).not.toContain("/reviews/public%20review/versions/withheld");
    expect(paths).not.toContain("/reviews/public%20review/versions/fixture");
    expect(paths).not.toContain("/reviews/public%20review/versions/invalid");
  });

  it("uses the explicit synthesis head and requires cheap relational integrity", () => {
    const current = synthesisVersion("synthesis-v2", 2);
    const historical = synthesisVersion("synthesis-v1", 1);
    const mismatchedDraft = synthesisVersion("bad-draft", 3, {
      synthesisDraft: {
        id: "wrong-draft",
        reviewId: "synthesis-review",
        seriesKey: "series-1",
        status: "accepted",
        acceptedAt: new Date("2026-07-03T12:00:00.000Z"),
        reviewVersion: { id: "bad-draft", synthesisOrdinal: 3 },
      },
    });
    const records = buildSitemapRecords({
      reviews: [synthesisReview([mismatchedDraft, current, historical], current.id)],
      nodes: [],
    });
    const paths = records.map(({ path }) => path);

    expect(paths).toContain("/reviews/accepted-synthesis");
    expect(paths).toContain("/reviews/accepted-synthesis/syntheses/synthesis-v2");
    expect(paths).toContain("/reviews/accepted-synthesis/syntheses/synthesis-v1");
    expect(paths).not.toContain("/reviews/accepted-synthesis/syntheses/bad-draft");
  });

  it("mirrors node current-version fail-closed behavior and excludes example history", () => {
    const records = buildSitemapRecords(
      {
        reviews: [],
        nodes: [
          node("node-ok", [nodeVersion("node-v2"), nodeVersion("node-v1")]),
          node("node-example-history", [
            nodeVersion("node-real"),
            nodeVersion("node-fixture", { isExample: true }),
          ]),
          node("node-corrupt", [
            nodeVersion("node-bad", { title: "Corrupt current" }),
            nodeVersion("node-old"),
          ]),
        ],
      },
      mapsValidNodeVersion as never,
    );
    const paths = records.map(({ path }) => path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "/nodes/node-ok",
        "/nodes/node-ok/versions/node-v2",
        "/nodes/node-ok/versions/node-v1",
        "/nodes/node-example-history",
        "/nodes/node-example-history/versions/node-real",
      ]),
    );
    expect(paths.join("\n")).not.toMatch(/node-fixture|node-corrupt|node-bad|node-old/);
  });

  it("deduplicates URLs, retaining the newest last-modified value", () => {
    const older = repositoryReview("same", [repositoryVersion("same-version")], {
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newer = repositoryReview("same", [repositoryVersion("same-version")], {
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    const records = buildSitemapRecords({ reviews: [older, newer], nodes: [] });

    expect(records.filter(({ path }) => path === "/reviews/same")).toEqual([
      { path: "/reviews/same", lastModified: newer.updatedAt },
    ]);
    expect(records.filter(({ path }) => path.endsWith("/versions/same-version"))).toHaveLength(1);
  });

  it("fails loudly instead of truncating beyond the sitemap protocol limit", () => {
    const versionCount = SITEMAP_URL_LIMIT - 6;
    const versions = Array.from({ length: versionCount }, (_, index) =>
      repositoryVersion(`v-${index}`),
    );

    expect(() =>
      buildSitemapRecords({ reviews: [repositoryReview("too-large", versions)], nodes: [] }),
    ).toThrow(/exceeding the 50000-URL protocol limit/);
  });
});
