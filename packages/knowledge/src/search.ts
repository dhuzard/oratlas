import { type ArchiveSearchQuery, type ClaimSearchQuery } from "@oratlas/contracts";
import { lexicalScore, tokenize, tokenSet } from "./text.js";
import { type IndexedClaim, type IndexedReview, type KnowledgeIndexData } from "./types.js";

export interface SearchResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * SearchProvider interface (spec §16). The POC ships an in-process lexical
 * implementation; PostgreSQL FTS or an external engine can be added behind the
 * same interface without changing callers.
 */
export interface SearchProvider {
  searchReviews(query: ArchiveSearchQuery): SearchResult<IndexedReview & { score: number }>;
  searchClaims(query: ClaimSearchQuery): SearchResult<IndexedClaim & { score: number }>;
}

function paginate<T>(items: T[], page: number, pageSize: number): SearchResult<T> {
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pageSize };
}

/** Deterministic, dependency-free lexical index over accepted records. */
export class InProcessSearchProvider implements SearchProvider {
  private readonly reviewTokens = new Map<string, Set<string>>();
  private readonly claimTokens = new Map<string, Set<string>>();

  constructor(private readonly data: KnowledgeIndexData) {
    for (const r of data.reviews) {
      this.reviewTokens.set(
        r.reviewVersionId,
        tokenSet(
          [
            r.title,
            r.abstract ?? "",
            r.keywords.join(" "),
            r.domains.join(" "),
            r.authors.join(" "),
          ].join(" "),
        ),
      );
    }
    for (const c of data.claims) {
      this.claimTokens.set(c.claimId, tokenSet(`${c.text} ${c.reviewTitle}`));
    }
  }

  searchReviews(query: ArchiveSearchQuery): SearchResult<IndexedReview & { score: number }> {
    const hasTextQuery = Boolean(query.q?.trim());
    const qTokens = query.q ? tokenize(query.q) : [];
    const rows = this.data.reviews.filter((r) => this.reviewMatchesFilters(r, query));

    let scored = rows.map((r) => ({
      ...r,
      score:
        qTokens.length > 0
          ? lexicalScore(qTokens, this.reviewTokens.get(r.reviewVersionId) ?? new Set())
          : 0,
    }));

    if (hasTextQuery) {
      // Sorting changes ordering, never membership. Previously a date/title
      // sort retained every review when none matched q. A nonempty query that
      // reduces to stopwords/punctuation also intentionally matches nothing.
      scored = scored.filter((r) => r.score > 0);
    }

    scored.sort((a, b) => {
      switch (query.sort) {
        case "relevance":
          return b.score - a.score || compareDateDesc(a.acceptedAt, b.acceptedAt);
        case "title":
          return a.title.localeCompare(b.title);
        case "updated":
          return compareDateDesc(a.updatedAt, b.updatedAt);
        case "accepted":
        default:
          return compareDateDesc(a.acceptedAt, b.acceptedAt);
      }
    });

    return paginate(scored, query.page, query.pageSize);
  }

  private reviewMatchesFilters(r: IndexedReview, q: ArchiveSearchQuery): boolean {
    if (q.hasDoi !== undefined && r.hasDoi !== q.hasDoi) return false;
    if (q.hasTrustData !== undefined && r.hasTrustData !== q.hasTrustData) return false;
    if (q.hasEvidenceData !== undefined && r.hasEvidenceData !== q.hasEvidenceData) return false;
    if (q.reviewStatus && r.status !== q.reviewStatus) return false;
    if (q.compatibility && r.compatibilityLevel !== q.compatibility) return false;
    if (q.year && r.publicationYear !== q.year) return false;
    if (q.domain && !r.domains.some((d) => d.toLowerCase() === q.domain!.toLowerCase())) {
      return false;
    }
    if (q.keywords && q.keywords.length > 0) {
      const lower = r.keywords.map((k) => k.toLowerCase());
      if (!q.keywords.every((k) => lower.includes(k.toLowerCase()))) return false;
    }
    if (q.author) {
      const needle = q.author.toLowerCase();
      if (!r.authors.some((a) => a.toLowerCase().includes(needle))) return false;
    }
    if (q.trustReviewState === "human-reviewed" && !r.hasHumanReviewedTrust) return false;
    if (q.trustReviewState === "agent-proposed-only" && r.hasHumanReviewedTrust) return false;
    return true;
  }

  searchClaims(query: ClaimSearchQuery): SearchResult<IndexedClaim & { score: number }> {
    const hasTextQuery = Boolean(query.q?.trim());
    const qTokens = query.q ? tokenize(query.q) : [];
    const rows = this.data.claims.filter((c) => this.claimMatchesFilters(c, query));

    let scored = rows.map((c) => ({
      ...c,
      score:
        qTokens.length > 0
          ? lexicalScore(qTokens, this.claimTokens.get(c.claimId) ?? new Set())
          : 0,
    }));
    if (hasTextQuery) scored = scored.filter((c) => c.score > 0);
    scored.sort((a, b) => b.score - a.score || a.reviewTitle.localeCompare(b.reviewTitle));

    return paginate(scored, query.page, query.pageSize);
  }

  private claimMatchesFilters(c: IndexedClaim, q: ClaimSearchQuery): boolean {
    if (q.reviewSlug && c.reviewSlug !== q.reviewSlug) return false;
    if (q.claimType && c.claimType !== q.claimType) return false;
    if (q.relationType && !c.relations.some((r) => r.relationType === q.relationType)) {
      return false;
    }
    if (q.trustCriterion) {
      const has = c.relations.some((r) => r.trust?.notableCriteria.includes(q.trustCriterion!));
      if (!has) return false;
    }
    return true;
  }
}

function compareDateDesc(a?: string, b?: string): number {
  const av = a ? Date.parse(a) : 0;
  const bv = b ? Date.parse(b) : 0;
  return bv - av;
}
