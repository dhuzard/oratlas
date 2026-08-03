import Link from "next/link";
import { Badge, CompatibilityBadge } from "@oratlas/ui";
import { InProcessSearchProvider } from "@oratlas/knowledge";
import {
  archiveSearchQuerySchema,
  CLAIM_EVIDENCE_RELATION_TYPES,
  CLAIM_TYPES,
} from "@oratlas/contracts";
import { TrustVerificationBadge } from "@/components/TrustVerificationBadge";
import { SpecialistTools } from "@/components/SpecialistTools";
import { ExplorationIntent } from "@/components/ExplorationIntent";
import { KnowledgeLandscape } from "@/components/KnowledgeLandscape";
import {
  buildKnowledgeLandscape,
  EXPLORATION_INTERESTS,
  normalizeExplorationInterests,
} from "@/lib/knowledge-landscape";
import { searchArchive } from "@/lib/archive-search";
import { buildKnowledgeIndex } from "@/lib/index-builder";

export const dynamic = "force-dynamic";

type ExploreView = "claims" | "reviews";
type ArchiveSort = "accepted" | "updated" | "title" | "relevance";
type SearchParameters = Record<string, string | string[] | undefined>;

function first(parameters: SearchParameters, key: string): string | undefined {
  const value = parameters[key];
  return Array.isArray(value) ? value[0] : value;
}

function all(parameters: SearchParameters, key: string): string[] {
  const value = parameters[key];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function bool(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function archiveSort(value: string | undefined): ArchiveSort {
  if (value === "updated" || value === "title" || value === "relevance") return value;
  return "accepted";
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const parameters = await searchParams;
  const get = (key: string) => first(parameters, key);
  const view: ExploreView = get("view") === "reviews" ? "reviews" : "claims";
  const q = get("q")?.trim() || undefined;
  const page = positivePage(get("page"));
  const sort = archiveSort(get("sort"));
  const selectedInterests = normalizeExplorationInterests(all(parameters, "interest"));
  const requestedLandscapeFocus = get("focus")?.trim() || undefined;
  const index = await buildKnowledgeIndex();
  const provider = new InProcessSearchProvider(index);

  const claimResults = provider.searchClaims({
    q,
    reviewSlug: get("reviewSlug") || undefined,
    claimType: get("claimType") || undefined,
    relationType: get("relationType") || undefined,
    trustCriterion: get("trustCriterion") || undefined,
    page: view === "claims" ? page : 1,
    pageSize: 20,
  });
  const landscapeClaimResults = provider.searchClaims({
    q,
    reviewSlug: get("reviewSlug") || undefined,
    claimType: get("claimType") || undefined,
    relationType: get("relationType") || undefined,
    trustCriterion: get("trustCriterion") || undefined,
    page: 1,
    pageSize: 40,
  });
  const landscape = buildKnowledgeLandscape(index, landscapeClaimResults.items, selectedInterests, {
    query: q,
    focusNodeId: requestedLandscapeFocus,
  });
  const landscapeOverviewHref = landscapeHref(parameters);
  const landscapeFocusHrefs = Object.fromEntries(
    landscape.nodes.map((node) => [node.id, landscapeHref(parameters, node.id)]),
  );
  const reviewQuery = archiveSearchQuerySchema.parse({
    contentType: "review",
    q,
    domain: get("domain") || undefined,
    author: get("author") || undefined,
    hasDoi: bool(get("hasDoi")),
    hasTrustData: bool(get("hasTrustData")),
    compatibility: get("compatibility") || undefined,
    sort,
    page: view === "reviews" ? page : 1,
    pageSize: 20,
  });
  const reviewResults = await searchArchive(reviewQuery, index);
  const reviews = index.reviews.map((review) => ({
    slug: review.reviewSlug,
    title: review.title,
  }));
  const domains = [...new Set(index.reviews.flatMap((review) => review.domains))].sort();
  const activeFilterCount =
    view === "claims"
      ? ["reviewSlug", "claimType", "relationType", "trustCriterion"].filter((key) => get(key))
          .length
      : ["author", "domain", "hasDoi", "hasTrustData", "compatibility"].filter((key) => get(key))
          .length + (sort === "accepted" ? 0 : 1);

  return (
    <>
      <header className="explore-header">
        <p className="home-eyebrow">Explore ORAtlas</p>
        <h1>Claims and scientific reviews</h1>
        <p className="lead">
          Start with a claim and follow its evidence, assessments, and disagreements—or browse the
          review records preserved in the archive.
        </p>
        <form action="/explore" method="get" role="search" className="explore-search">
          <input type="hidden" name="view" value={view} />
          {selectedInterests.map((interest) => (
            <input type="hidden" name="interest" value={interest} key={interest} />
          ))}
          <label htmlFor="explore-q" className="sr-only">
            Search claims, reviews, or authors
          </label>
          <input
            id="explore-q"
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search a claim, review, or author…"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </header>

      <nav className="explore-tabs" aria-label="Explore content">
        <Link
          href={viewHref("claims", q, selectedInterests)}
          aria-current={view === "claims" ? "page" : undefined}
        >
          Claims <span>{claimResults.total}</span>
        </Link>
        <Link
          href={viewHref("reviews", q, selectedInterests)}
          aria-current={view === "reviews" ? "page" : undefined}
        >
          Reviews <span>{reviewResults.total}</span>
        </Link>
      </nav>

      <div className="explore-toolbar">
        <p>
          <strong>{view === "claims" ? claimResults.total : reviewResults.total}</strong>{" "}
          {view === "claims" ? "claim" : "review"}
          {(view === "claims" ? claimResults.total : reviewResults.total) === 1 ? "" : "s"}
          {q ? " matching “" + q + "”" : ""}
        </p>
        <details className="explore-filter-panel" open={activeFilterCount > 0}>
          <summary>
            Filter results{activeFilterCount > 0 ? " (" + activeFilterCount + ")" : ""}
          </summary>
          <form action="/explore" method="get" className="filters">
            <input type="hidden" name="view" value={view} />
            {q ? <input type="hidden" name="q" value={q} /> : null}
            {selectedInterests.map((interest) => (
              <input type="hidden" name="interest" value={interest} key={interest} />
            ))}
            {view === "claims" ? (
              <>
                <div className="field">
                  <label htmlFor="reviewSlug">Review</label>
                  <select id="reviewSlug" name="reviewSlug" defaultValue={get("reviewSlug") ?? ""}>
                    <option value="">Any review</option>
                    {reviews.map((review) => (
                      <option key={review.slug} value={review.slug}>
                        {review.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="claimType">Claim type</label>
                  <select id="claimType" name="claimType" defaultValue={get("claimType") ?? ""}>
                    <option value="">Any type</option>
                    {CLAIM_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="relationType">Evidence relation</label>
                  <select
                    id="relationType"
                    name="relationType"
                    defaultValue={get("relationType") ?? ""}
                  >
                    <option value="">Any relation</option>
                    {CLAIM_EVIDENCE_RELATION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replace(/-/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="trustCriterion">Assessment criterion (TRUST)</label>
                  <input
                    id="trustCriterion"
                    type="text"
                    name="trustCriterion"
                    defaultValue={get("trustCriterion") ?? ""}
                    placeholder="e.g. entailment"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="author">Author</label>
                  <input id="author" type="text" name="author" defaultValue={get("author") ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="domain">Scientific domain</label>
                  <select id="domain" name="domain" defaultValue={get("domain") ?? ""}>
                    <option value="">Any domain</option>
                    {domains.map((domain) => (
                      <option key={domain} value={domain}>
                        {domain}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="hasDoi">Publication record</label>
                  <select id="hasDoi" name="hasDoi" defaultValue={get("hasDoi") ?? ""}>
                    <option value="">DOI or repository-only</option>
                    <option value="true">Has DOI</option>
                    <option value="false">Repository-only</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="hasTrustData">Assessment data</label>
                  <select
                    id="hasTrustData"
                    name="hasTrustData"
                    defaultValue={get("hasTrustData") ?? ""}
                  >
                    <option value="">With or without TRUST data</option>
                    <option value="true">Has TRUST data</option>
                    <option value="false">No TRUST data</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="compatibility">Review structure</label>
                  <select
                    id="compatibility"
                    name="compatibility"
                    defaultValue={get("compatibility") ?? ""}
                  >
                    <option value="">Any compatible structure</option>
                    <option value="verified-template">Verified template</option>
                    <option value="compatible">Compatible</option>
                    <option value="partially-compatible">Partially compatible</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sort">Sort by</label>
                  <select id="sort" name="sort" defaultValue={sort}>
                    <option value="accepted">Acceptance date</option>
                    <option value="updated">Update date</option>
                    <option value="title">Title</option>
                    <option value="relevance">Relevance</option>
                  </select>
                </div>
              </>
            )}
            <div className="btn-row">
              <button className="btn" type="submit">
                Apply filters
              </button>
              {activeFilterCount > 0 ? (
                <Link href={viewHref(view, q, selectedInterests)}>Clear filters</Link>
              ) : null}
            </div>
          </form>
        </details>
      </div>

      <ExplorationIntent query={q} selectedInterests={selectedInterests} view={view} />

      {q || selectedInterests.length > 0 ? (
        <KnowledgeLandscape
          landscape={landscape}
          overviewHref={landscapeOverviewHref}
          focusHrefByNode={landscapeFocusHrefs}
          focus={
            q ??
            selectedInterests
              .map(
                (selected) =>
                  EXPLORATION_INTERESTS.find((interest) => interest.id === selected)?.label ??
                  selected,
              )
              .join(", ")
          }
        />
      ) : null}

      <SpecialistTools />

      {view === "claims" ? (
        claimResults.items.length === 0 ? (
          <p className="empty-state">No claims match this search.</p>
        ) : (
          <ol className="explore-results">
            {claimResults.items.map((claim) => {
              const supporting = claim.relations.filter(
                (relation) =>
                  relation.relationType === "supports" ||
                  relation.relationType === "partially-supports",
              ).length;
              const contradicting = claim.relations.filter(
                (relation) => relation.relationType === "contradicts",
              ).length;
              return (
                <li key={claim.claimId}>
                  <article className="explore-result">
                    <h2>
                      <Link
                        href={
                          "/claims/" +
                          claim.reviewVersionId +
                          "/" +
                          encodeURIComponent(claim.localClaimId)
                        }
                      >
                        {claim.text}
                      </Link>
                    </h2>
                    <div className="meta">
                      {claim.claimType ? <Badge>{claim.claimType}</Badge> : null}
                      {supporting > 0 ? (
                        <Badge tone="success">{supporting} supporting</Badge>
                      ) : null}
                      {contradicting > 0 ? (
                        <Badge tone="warning">{contradicting} contradicting</Badge>
                      ) : null}
                      {claim.relations.flatMap((relation) =>
                        (relation.trustAssessments ?? (relation.trust ? [relation.trust] : [])).map(
                          (assessment) => (
                            <TrustVerificationBadge
                              key={assessment.assessmentId}
                              state={assessment.verificationState}
                            />
                          ),
                        ),
                      )}
                    </div>
                    <p className="muted">
                      From{" "}
                      <Link
                        href={
                          "/reviews/" +
                          claim.reviewSlug +
                          "/versions/" +
                          claim.reviewVersionId +
                          "#" +
                          claim.anchor
                        }
                      >
                        {claim.reviewTitle}
                      </Link>
                    </p>
                  </article>
                </li>
              );
            })}
          </ol>
        )
      ) : reviewResults.items.length === 0 ? (
        <p className="empty-state">No reviews match this search.</p>
      ) : (
        <ol className="explore-results">
          {reviewResults.items.map((item) =>
            item.contentType === "review" ? (
              <li key={item.slug}>
                <article className="explore-result">
                  <h2>
                    <Link href={"/reviews/" + item.slug}>{item.title}</Link>
                  </h2>
                  <div className="meta">
                    {item.compatibilityLevel ? (
                      <CompatibilityBadge level={item.compatibilityLevel} />
                    ) : null}
                    {item.hasDoi ? (
                      <Badge tone="success">DOI</Badge>
                    ) : (
                      <Badge>repository-only</Badge>
                    )}
                    {item.hasTrustData ? <Badge>TRUST data</Badge> : null}
                    {item.status === "withdrawn" ? <Badge tone="warning">withdrawn</Badge> : null}
                  </div>
                  {item.abstract ? <p>{truncate(item.abstract)}</p> : null}
                  {item.authors.length > 0 ? (
                    <p className="muted">{item.authors.join(", ")}</p>
                  ) : null}
                </article>
              </li>
            ) : null,
          )}
        </ol>
      )}

      {pageCount(
        view === "claims" ? claimResults.total : reviewResults.total,
        view === "claims" ? claimResults.pageSize : reviewResults.pageSize,
      ) > 1 ? (
        <nav className="explore-pagination" aria-label="Explore result pages">
          {page > 1 ? <Link href={pageHref(parameters, page - 1)}>Previous</Link> : <span />}
          <span className="muted">
            Page {page} of{" "}
            {pageCount(
              view === "claims" ? claimResults.total : reviewResults.total,
              view === "claims" ? claimResults.pageSize : reviewResults.pageSize,
            )}
          </span>
          {page <
          pageCount(
            view === "claims" ? claimResults.total : reviewResults.total,
            view === "claims" ? claimResults.pageSize : reviewResults.pageSize,
          ) ? (
            <Link href={pageHref(parameters, page + 1)}>Next</Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}

function viewHref(view: ExploreView, q?: string, interests: string[] = []): string {
  const parameters = new URLSearchParams({ view });
  if (q) parameters.set("q", q);
  for (const interest of interests) parameters.append("interest", interest);
  return "/explore?" + parameters;
}

function pageHref(parameters: SearchParameters, page: number): string {
  const output = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (key === "page" || !value) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry) output.append(key, entry);
    }
  }
  output.set("page", String(page));
  return "/explore?" + output;
}

function landscapeHref(parameters: SearchParameters, focusNodeId?: string): string {
  const output = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (key === "focus" || key === "page" || !value) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry) output.append(key, entry);
    }
  }
  if (focusNodeId) output.set("focus", focusNodeId);
  return "/explore?" + output;
}

function pageCount(total: number, pageSize: number): number {
  return Math.ceil(total / pageSize);
}

function truncate(value: string): string {
  return value.length > 220 ? value.slice(0, 220) + "…" : value;
}
