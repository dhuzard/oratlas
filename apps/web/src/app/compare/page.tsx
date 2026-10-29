import Link from "next/link";
import { type Metadata } from "next";
import { Badge, Card, Notice } from "@oratlas/ui";
import { buildKnowledgeIndex } from "@/lib/index-builder";
import { buildReviewComparison, defaultComparisonSlugs } from "@/lib/review-comparison";
import { getFeaturedClaimComparisonHref } from "@/lib/claim-comparison";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare claims and evidence" };

type SearchParameters = Record<string, string | string[] | undefined>;

function first(parameters: SearchParameters, key: string): string | undefined {
  const value = parameters[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const [index, parameters, featuredPairHref] = await Promise.all([
    buildKnowledgeIndex(),
    searchParams,
    getFeaturedClaimComparisonHref(),
  ]);
  const defaults = defaultComparisonSlugs(index);
  const reviews = [...index.reviews].sort((a, b) => a.title.localeCompare(b.title));
  const left = first(parameters, "left") ?? defaults[0];
  const right =
    first(parameters, "right") ??
    defaults.find((slug) => slug !== left) ??
    reviews.find((review) => review.reviewSlug !== left)?.reviewSlug;
  const selected = [left, right].filter((slug): slug is string => Boolean(slug));
  const columns = buildReviewComparison(index, selected);

  return (
    <article className="comparison-page">
      <header className="page-hero">
        <p className="home-eyebrow">Exact claims · Public records</p>
        <h1>Compare claims with their evidence</h1>
        <p className="lead">
          Read two exact assertions side by side, inspect their declared scope and follow their
          evidence to the preserved source. A comparison does not create a relationship or confirm
          either claim.
        </p>
        <div className="btn-row">
          {featuredPairHref ? (
            <Link className="btn" href={featuredPairHref}>
              Compare two claims · synthetic example
            </Link>
          ) : null}
          <Link href="/explore">Find claims for your question</Link>
          <a href="#review-coverage">Compare review coverage</a>
        </div>
      </header>

      <p className="muted prose">
        Only available public exact claim records can be compared. A source inspection is not an
        accepted claim record.{" "}
        <Link href="/publications/pilot">Read about the public source pilot</Link>.
      </p>

      <details className="comparison-exact-entry">
        <summary>Already have two exact claim references?</summary>
        <p>
          Use the exact occurrence paths from claim records, including their version identifiers.
          Review slugs and publisher URLs are not exact claim references.
        </p>
        <form
          action="/compare/claims"
          method="get"
          className="filters"
          aria-label="Choose exact claims to compare"
        >
          <div className="field">
            <label htmlFor="exact-left">First exact claim reference</label>
            <input
              id="exact-left"
              name="left"
              required
              placeholder="/claims/version-id/local-claim-id"
            />
          </div>
          <div className="field">
            <label htmlFor="exact-right">Second exact claim reference</label>
            <input
              id="exact-right"
              name="right"
              required
              placeholder="/nodes/node-id/versions/version-id"
            />
          </div>
          <button className="btn" type="submit">
            Compare exact claims
          </button>
        </form>
      </details>

      <section id="review-coverage" aria-labelledby="review-coverage-title">
        <h2 id="review-coverage-title">Compare review coverage</h2>
        <p>
          Compare two archived reviews by their exposed claims, citations, evidence relations and
          TRUST records. This separate view uses review-level counts rather than an exact claim
          pair.
        </p>
      </section>

      <form className="comparison-picker" method="get" aria-label="Choose reviews to compare">
        <div className="field">
          <label htmlFor="left">First record</label>
          <select id="left" name="left" defaultValue={selected[0] ?? ""}>
            {reviews.map((review) => (
              <option value={review.reviewSlug} key={review.reviewSlug}>
                {review.title}
              </option>
            ))}
          </select>
        </div>
        <div className="comparison-versus" aria-hidden="true">
          vs
        </div>
        <div className="field">
          <label htmlFor="right">Second record</label>
          <select id="right" name="right" defaultValue={selected[1] ?? ""}>
            {reviews.map((review) => (
              <option value={review.reviewSlug} key={review.reviewSlug}>
                {review.title}
              </option>
            ))}
          </select>
        </div>
        <button className="btn" type="submit">
          Compare records
        </button>
      </form>

      <Notice tone="info" title="Coverage, not a leaderboard">
        Counts show what each deposited version exposes to ORAtlas. They are not quality scores,
        confidence rankings, peer-review outcomes, or evidence of scientific truth. Missing TRUST
        data means “not available here,” not “untrustworthy.”
      </Notice>

      {columns.length < 2 ? (
        <Card>
          <p>Choose two different archived records to create a comparison.</p>
        </Card>
      ) : (
        <>
          <section aria-labelledby="comparison-overview-title">
            <div className="home-section-heading">
              <div>
                <p className="home-eyebrow">Record overview</p>
                <h2 id="comparison-overview-title">What each deposit makes inspectable</h2>
              </div>
              <Link href="/synthesis">Open the disagreement map</Link>
            </div>
            <div className="comparison-columns">
              {columns.map((column) => (
                <Card as="section" key={column.review.reviewSlug}>
                  <div className="meta">
                    <Badge>{column.review.reviewType?.replace(/-/g, " ") ?? "review"}</Badge>
                    {column.review.hasDoi ? (
                      <Badge tone="success">DOI</Badge>
                    ) : (
                      <Badge>repository-only</Badge>
                    )}
                    {column.review.hasHumanReviewedTrust ? (
                      <Badge tone="success">human-reviewed TRUST</Badge>
                    ) : column.review.hasTrustData ? (
                      <Badge>source or agent TRUST</Badge>
                    ) : (
                      <Badge>no TRUST data</Badge>
                    )}
                  </div>
                  <h3>
                    <Link href={`/reviews/${column.review.reviewSlug}`}>{column.review.title}</Link>
                  </h3>
                  {column.review.authors.length > 0 ? (
                    <p className="muted">{column.review.authors.join(", ")}</p>
                  ) : null}
                  <dl className="comparison-metrics">
                    <div>
                      <dt>Claims</dt>
                      <dd>{column.claimCount}</dd>
                    </div>
                    <div>
                      <dt>Citations</dt>
                      <dd>{column.citationCount}</dd>
                    </div>
                    <div>
                      <dt>Evidence links</dt>
                      <dd>{column.evidenceRelationCount}</dd>
                    </div>
                    <div>
                      <dt>Contradicting links</dt>
                      <dd>{column.contradictingRelationCount}</dd>
                    </div>
                    <div>
                      <dt>TRUST records</dt>
                      <dd>{column.trustAssessmentCount}</dd>
                    </div>
                    <div>
                      <dt>Human-reviewed TRUST</dt>
                      <dd>{column.humanReviewedTrustCount}</dd>
                    </div>
                  </dl>
                  <p className="comparison-types">
                    {column.claimTypes.map(({ type, count }) => (
                      <Badge key={type}>
                        {type.replace(/-/g, " ")} · {count}
                      </Badge>
                    ))}
                  </p>
                </Card>
              ))}
            </div>
          </section>

          <section aria-labelledby="comparison-claims-title" className="comparison-claims">
            <div className="home-section-heading">
              <div>
                <p className="home-eyebrow">Claim inventory</p>
                <h2 id="comparison-claims-title">Inspect the statements behind the counts</h2>
              </div>
              <Link href="/claims">Search all claims</Link>
            </div>
            <div className="comparison-columns">
              {columns.map((column) => (
                <section
                  key={column.review.reviewSlug}
                  aria-label={`Claims from ${column.review.title}`}
                >
                  <h3>{column.review.title}</h3>
                  {column.claims.length === 0 ? (
                    <Card>
                      <p className="muted">No structured claims are exposed by this deposit.</p>
                    </Card>
                  ) : (
                    column.claims.map((claim) => (
                      <Card as="article" key={claim.localClaimId}>
                        <div className="meta">
                          {claim.claimType ? (
                            <Badge>{claim.claimType.replace(/-/g, " ")}</Badge>
                          ) : null}
                          <span>
                            {claim.evidenceRelationCount} evidence link
                            {claim.evidenceRelationCount === 1 ? "" : "s"}
                          </span>
                          {claim.contradictingRelationCount > 0 ? (
                            <Badge tone="warning">
                              {claim.contradictingRelationCount} contradicting
                            </Badge>
                          ) : null}
                          {claim.trustAssessmentCount > 0 ? (
                            <Badge>{claim.trustAssessmentCount} TRUST</Badge>
                          ) : null}
                        </div>
                        <p className="claim-text">{claim.text}</p>
                        <Link href={claim.passportPath}>Inspect claim passport</Link>
                      </Card>
                    ))
                  )}
                </section>
              ))}
            </div>
          </section>
        </>
      )}

      <Card title="How to challenge a comparison">
        <p>
          Open an exact review or claim passport to comment in context. Use a formal challenge for a
          claim, citation, evidence relation, or TRUST criterion that needs an attributable,
          immutable objection. For rule-based opposing-claim pairs, use the disagreement map.
        </p>
        <div className="btn-row">
          <Link href="/synthesis">Inspect disagreements</Link>
          <Link href="/explore">Traverse connected evidence</Link>
          <Link href="/archive">Return to the review archive</Link>
        </div>
      </Card>
    </article>
  );
}
