import "server-only";
import { isExactCommitSha } from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";
import { prisma } from "./db";
import { tryMapPublicNodeVersion } from "./node-publication";
import { readablePublicNodeVersionWhere } from "./public-snapshot-visibility";

export const SITEMAP_URL_LIMIT = 50_000;

export interface SitemapRecord {
  path: string;
  lastModified?: Date;
}

const STATIC_PATHS = [
  "/",
  "/api-docs",
  "/archive",
  "/certifications",
  "/connect",
  "/compare",
  "/create-review",
  "/explore",
  "/publications",
  "/verification",
] as const;

const reviewSitemapQuery = {
  where: { status: "published" },
  select: {
    id: true,
    slug: true,
    reviewType: true,
    repositoryId: true,
    currentSnapshotId: true,
    synthesisSeriesKey: true,
    currentSynthesisVersionId: true,
    updatedAt: true,
    versions: {
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reviewId: true,
        recordSourceType: true,
        snapshotId: true,
        snapshot: { select: { commitSha: true } },
        isExample: true,
        publicState: true,
        publishedAt: true,
        createdAt: true,
        synthesisOrdinal: true,
        synthesisDraftId: true,
        sourceSelectionKey: true,
        synthesisAcceptedAt: true,
        synthesisDraft: {
          select: {
            id: true,
            reviewId: true,
            seriesKey: true,
            status: true,
            acceptedAt: true,
            reviewVersion: { select: { id: true, synthesisOrdinal: true } },
          },
        },
      },
    },
  },
} satisfies Prisma.ReviewFindManyArgs;

const nodeSitemapQuery = {
  where: {
    repositoryId: { not: null },
    versions: { some: readablePublicNodeVersionWhere },
  },
  select: {
    id: true,
    kind: true,
    repositoryId: true,
    updatedAt: true,
    repository: { select: { id: true } },
    versions: {
      where: readablePublicNodeVersionWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        snapshotId: true,
        title: true,
        abstract: true,
        text: true,
        contributorsJson: true,
        license: true,
        provenanceJson: true,
        payloadJson: true,
        versionDoi: true,
        conceptDoi: true,
        isExample: true,
        createdAt: true,
        snapshot: { select: { commitSha: true } },
      },
    },
  },
} satisfies Prisma.KnowledgeNodeFindManyArgs;

export type SitemapReviewRow = Prisma.ReviewGetPayload<typeof reviewSitemapQuery>;
export type SitemapNodeRow = Prisma.KnowledgeNodeGetPayload<typeof nodeSitemapQuery>;

export interface SitemapSources {
  reviews: readonly SitemapReviewRow[];
  nodes: readonly SitemapNodeRow[];
}

type NodeVersionMapper = typeof tryMapPublicNodeVersion;

function segment(value: string): string {
  return encodeURIComponent(value);
}

function isReadableReviewVersion(version: SitemapReviewRow["versions"][number]): boolean {
  return (
    version.recordSourceType === "repository" &&
    version.snapshotId !== null &&
    version.snapshot !== null &&
    isExactCommitSha(version.snapshot.commitSha) &&
    version.isExample === false &&
    (version.publicState === "published" || version.publicState === "withdrawn")
  );
}

function isReadableSynthesisVersion(
  review: SitemapReviewRow,
  version: SitemapReviewRow["versions"][number],
): boolean {
  const draft = version.synthesisDraft;
  return (
    review.reviewType === "ai-synthesis" &&
    review.repositoryId === null &&
    review.currentSnapshotId === null &&
    review.synthesisSeriesKey !== null &&
    version.reviewId === review.id &&
    version.recordSourceType === "synthesis" &&
    version.snapshotId === null &&
    version.isExample === false &&
    version.publicState === "published" &&
    version.synthesisOrdinal !== null &&
    version.synthesisOrdinal > 0 &&
    version.synthesisDraftId !== null &&
    version.sourceSelectionKey === `${review.synthesisSeriesKey}:${version.synthesisOrdinal}` &&
    version.synthesisAcceptedAt !== null &&
    draft !== null &&
    draft.id === version.synthesisDraftId &&
    draft.reviewId === review.id &&
    draft.seriesKey === review.synthesisSeriesKey &&
    draft.status === "accepted" &&
    draft.acceptedAt?.getTime() === version.synthesisAcceptedAt.getTime() &&
    draft.reviewVersion?.id === version.id &&
    draft.reviewVersion.synthesisOrdinal === version.synthesisOrdinal
  );
}

function addRecord(records: Map<string, SitemapRecord>, record: SitemapRecord): void {
  const prior = records.get(record.path);
  if (!prior) {
    records.set(record.path, record);
    return;
  }
  if (
    record.lastModified &&
    (!prior.lastModified || record.lastModified.getTime() > prior.lastModified.getTime())
  ) {
    records.set(record.path, record);
  }
}

/**
 * Produce only URLs that the corresponding public page loader can resolve.
 * Input rows are deliberately lightweight projections rather than full review
 * detail graphs.
 */
export function buildSitemapRecords(
  sources: SitemapSources,
  mapNodeVersion: NodeVersionMapper = tryMapPublicNodeVersion,
): SitemapRecord[] {
  const records = new Map<string, SitemapRecord>();
  for (const path of STATIC_PATHS) addRecord(records, { path });

  for (const review of sources.reviews) {
    if (review.reviewType === "ai-synthesis") {
      const readable = review.versions.filter((version) =>
        isReadableSynthesisVersion(review, version),
      );
      const current = readable.find((version) => version.id === review.currentSynthesisVersionId);
      if (current) {
        addRecord(records, {
          path: `/reviews/${segment(review.slug)}`,
          lastModified: current.synthesisAcceptedAt ?? current.publishedAt ?? current.createdAt,
        });
      }
      for (const version of readable) {
        addRecord(records, {
          path: `/reviews/${segment(review.slug)}/syntheses/${segment(version.id)}`,
          lastModified: version.synthesisAcceptedAt ?? version.publishedAt ?? version.createdAt,
        });
      }
      continue;
    }

    // getReviewDetail() chooses the newest stored version before applying its
    // fail-closed visibility checks, so a withheld/corrupt head suppresses the
    // current review URL rather than falling back to older content.
    const current = review.versions[0];
    if (current && isReadableReviewVersion(current)) {
      addRecord(records, {
        path: `/reviews/${segment(review.slug)}`,
        lastModified: review.updatedAt,
      });
    }
    for (const version of review.versions) {
      if (!isReadableReviewVersion(version)) continue;
      addRecord(records, {
        path: `/reviews/${segment(review.slug)}/versions/${segment(version.id)}`,
        lastModified: version.publishedAt ?? version.createdAt,
      });
    }
  }

  for (const node of sources.nodes) {
    if (!node.repositoryId || !node.repository || node.versions.length === 0) continue;
    const current = node.versions[0]!;
    const mappedCurrent = mapNodeVersion(node, current);
    // getPublicNode() intentionally never falls back when its newest readable
    // stored version is malformed.
    if (!mappedCurrent || current.isExample) continue;
    addRecord(records, { path: `/nodes/${segment(node.id)}`, lastModified: node.updatedAt });
    for (const version of node.versions) {
      if (version.isExample || !mapNodeVersion(node, version)) continue;
      addRecord(records, {
        path: `/nodes/${segment(node.id)}/versions/${segment(version.id)}`,
        lastModified: version.createdAt,
      });
    }
  }

  const output = [...records.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  if (output.length > SITEMAP_URL_LIMIT) {
    throw new Error(
      `Sitemap contains ${output.length} URLs, exceeding the ${SITEMAP_URL_LIMIT}-URL protocol limit; shard the sitemap before publishing it.`,
    );
  }
  return output;
}

export async function listSitemapRecords(): Promise<SitemapRecord[]> {
  const [reviews, nodes] = await Promise.all([
    prisma.review.findMany(reviewSitemapQuery),
    prisma.knowledgeNode.findMany(nodeSitemapQuery),
  ]);
  return buildSitemapRecords({ reviews, nodes });
}
