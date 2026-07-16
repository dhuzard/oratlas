import "server-only";
import {
  archiveSearchResponseSchema,
  type ArchiveSearchQuery,
  type ArchiveSearchResponse,
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

/** Search reviews and nodes first, merge deterministically, then paginate once. */
export async function searchArchive(
  query: ArchiveSearchQuery,
  providedIndex?: KnowledgeIndexData,
): Promise<ArchiveSearchResponse> {
  const [index, nodeRows] = await Promise.all([
    providedIndex ? Promise.resolve(providedIndex) : buildKnowledgeIndex(),
    query.contentType === "review" ? Promise.resolve([]) : listPublicNodeSummaries(query.nodeKind),
  ]);
  const reviewRows =
    query.contentType === "node"
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
  const combined = [...reviews, ...nodes].sort((left, right) => {
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
  return item.contentType === "review" ? item.title : item.node.title;
}

function keyOf(item: ArchiveItem): string {
  return item.contentType === "review" ? `review:${item.slug}` : `node:${item.node.id}`;
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
