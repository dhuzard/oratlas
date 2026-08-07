import Link from "next/link";
import { type Metadata } from "next";
import { Badge, Card, Notice } from "@oratlas/ui";
import { buildKnowledgeIndex } from "@/lib/index-builder";
import { buildReviewComparison, defaultComparisonSlugs } from "@/lib/review-comparison";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare reviews" };

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
  const [index, parameters] = await Promise.all([buildKnowledgeIndex(), searchParams]);
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
        <p className="home-eyebrow">Compare the archive</p>
        <h1>Compare reviews, evidence and TRUST</h1>
        <p className="lead">
          Put two deposited records side by side, then inspect their exact claims, citations,
          evidence relations and independent TRUST assessments.
        </p>
      </header>

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
