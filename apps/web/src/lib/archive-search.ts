import "server-only";
import {
  archiveSearchResponseSchema,
  publicSynthesisReviewSchema,
  type ArchiveSearchQuery,
  type ArchiveSearchResponse,
  type PublicNodeSummary,
  type PublicSynthesisReview,
} from "@oratlas/contracts";
import {
  InProcessSearchProvider,
  lexicalScore,
  tokenize,
  tokenSet,
  type KnowledgeIndexData,
} from "@oratlas/knowledge";
import { buildKnowledgeIndex } from "./index-builder";
import { listPublicNodeSummaries } from "./node-publication";
import { prisma } from "./db";
import { getPublicSynthesisReview } from "./synthesis-editorial";

export interface ArchiveSynthesisSource {
  slug: string;
  title: string;
  abstract: string;
  version: PublicSynthesisReview["version"];
  acceptedAt: string;
  freshness: Pick<PublicSynthesisReview["freshness"], "status" | "affectedReferenceCount">;
}

/** Explicit sources keep the deterministic three-way merge independently testable. */
export interface ArchiveSearchSources {
  index: KnowledgeIndexData;
  nodes: PublicNodeSummary[];
  syntheses: ArchiveSynthesisSource[];
}

/** Search all public record kinds, merge deterministically, then paginate once. */
export async function searchArchive(
  query: ArchiveSearchQuery,
  provided?: KnowledgeIndexData | ArchiveSearchSources,
): Promise<ArchiveSearchResponse> {
  const suppliedSources = isArchiveSearchSources(provided) ? provided : undefined;
  const providedIndex = isKnowledgeIndexData(provided) ? provided : undefined;
  const [index, nodeRows, synthesisRows] = await Promise.all([
    suppliedSources
      ? Promise.resolve(suppliedSources.index)
      : providedIndex
        ? Promise.resolve(providedIndex)
        : buildKnowledgeIndex(),
    query.contentType === "review" || query.contentType === "synthesis"
      ? Promise.resolve([])
      : suppliedSources
        ? Promise.resolve(
            suppliedSources.nodes.filter((node) => !query.nodeKind || node.kind === query.nodeKind),
          )
        : listPublicNodeSummaries(query.nodeKind),
    query.contentType === "review" || query.contentType === "node"
      ? Promise.resolve([])
      : suppliedSources
        ? Promise.resolve(suppliedSources.syntheses)
        : listPublicSynthesisSources(),
  ]);
  const reviewRows =
    query.contentType === "node" || query.contentType === "synthesis"
      ? []
      : new InProcessSearchProvider(index).searchReviews({
          ...query,
          page: 1,
          pageSize: Math.max(1, index.reviews.length),
        }).items;
  const qTokens = query.q ? tokenize(query.q) : [];
  const hasQuery = Boolean(query.q?.trim());
  const nodes = nodeRows
    .map((node) => ({
      contentType: "node" as const,
      node,
      score:
        qTokens.length > 0
          ? lexicalScore(
              qTokens,
              tokenSet(
                [
                  node.title,
                  node.abstract ?? "",
                  node.localNodeId,
                  node.repository.owner,
                  node.repository.name,
                ].join(" "),
              ),
            )
          : 0,
      sortDate: node.updatedAt,
    }))
    .filter((node) => !hasQuery || node.score > 0);
  const reviews = reviewRows.map((review) => ({
    contentType: "review" as const,
    slug: review.reviewSlug,
    title: review.title,
    abstract: review.abstract,
    authors: review.authors,
    domains: review.domains,
    hasDoi: review.hasDoi,
    hasTrustData: review.hasTrustData,
    compatibilityLevel: review.compatibilityLevel,
    status: review.status,
    score: review.score,
    sortDate: query.sort === "updated" ? review.updatedAt : review.acceptedAt,
  }));
  const syntheses = synthesisRows
    .map((synthesis) => ({
      contentType: "synthesis" as const,
      slug: synthesis.slug,
      title: synthesis.title,
      abstract: synthesis.abstract,
      version: synthesis.version,
      freshness: synthesis.freshness,
      score:
        qTokens.length > 0
          ? lexicalScore(qTokens, tokenSet(`${synthesis.title} ${synthesis.abstract}`))
          : 0,
      sortDate: synthesis.acceptedAt,
    }))
    .filter((synthesis) => !hasQuery || synthesis.score > 0);
  const combined = [...reviews, ...nodes, ...syntheses].sort((left, right) => {
    if (query.sort === "title")
      return (
        compareCanonical(titleOf(left), titleOf(right)) ||
        compareCanonical(keyOf(left), keyOf(right))
      );
    if (query.sort === "relevance") {
      return (
        right.score - left.score ||
        compareCanonical(dateOf(right), dateOf(left)) ||
        compareCanonical(keyOf(left), keyOf(right))
      );
    }
    return (
      compareCanonical(dateOf(right), dateOf(left)) ||
      compareCanonical(titleOf(left), titleOf(right)) ||
      compareCanonical(keyOf(left), keyOf(right))
    );
  });
  const start = (query.page - 1) * query.pageSize;
  return archiveSearchResponseSchema.parse({
    total: combined.length,
    page: query.page,
    pageSize: query.pageSize,
    items: combined.slice(start, start + query.pageSize),
  });
}

type ArchiveItem = ArchiveSearchResponse["items"][number];

function titleOf(item: ArchiveItem): string {
  return item.contentType === "node" ? item.node.title : item.title;
}

function keyOf(item: ArchiveItem): string {
  if (item.contentType === "review") return `review:${item.slug}`;
  if (item.contentType === "synthesis") return `synthesis:${item.slug}`;
  return `node:${item.node.id}`;
}

function dateOf(item: ArchiveItem): string {
  return item.sortDate ?? "";
}

/** NFKC + locale-independent case fold and code-unit comparison. */
function compareCanonical(left: string, right: string): number {
  const foldedLeft = left.normalize("NFKC").toLowerCase();
  const foldedRight = right.normalize("NFKC").toLowerCase();
  return foldedLeft < foldedRight
    ? -1
    : foldedLeft > foldedRight
      ? 1
      : left < right
        ? -1
        : left > right
          ? 1
          : 0;
}

function isArchiveSearchSources(
  value: KnowledgeIndexData | ArchiveSearchSources | undefined,
): value is ArchiveSearchSources {
  return Boolean(value && "index" in value && "nodes" in value && "syntheses" in value);
}

function isKnowledgeIndexData(
  value: KnowledgeIndexData | ArchiveSearchSources | undefined,
): value is KnowledgeIndexData {
  return Boolean(value && "reviews" in value && "claims" in value && "citations" in value);
}

async function listPublicSynthesisSources(): Promise<ArchiveSynthesisSource[]> {
  const output: ArchiveSynthesisSource[] = [];
  const batchSize = 25;
  let cursor: string | undefined;
  do {
    const candidates = await prisma.review.findMany({
      where: {
        reviewType: "ai-synthesis",
        status: "published",
        currentSynthesisVersionId: { not: null },
      },
      select: { slug: true },
      orderBy: { slug: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { slug: cursor }, skip: 1 } : {}),
    });
    const publicSyntheses = await Promise.all(
      candidates.map(async ({ slug }: { slug: string }) => {
        try {
          const synthesis = await getPublicSynthesisReview(slug);
          const parsed = publicSynthesisReviewSchema.safeParse(synthesis);
          return parsed.success ? parsed.data : null;
        } catch {
          // A malformed candidate must not make other public archive rows unavailable.
          return null;
        }
      }),
    );
    for (const synthesis of publicSyntheses) {
      if (!synthesis) continue;
      output.push({
        slug: synthesis.slug,
        title: synthesis.title,
        abstract: synthesis.abstract,
        version: synthesis.version,
        acceptedAt: synthesis.provenance.acceptedAt,
        freshness: {
          status: synthesis.freshness.status,
          affectedReferenceCount: synthesis.freshness.affectedReferenceCount,
        },
      });
    }
    cursor = candidates.length === batchSize ? candidates.at(-1)?.slug : undefined;
  } while (cursor);
  return output;
}
