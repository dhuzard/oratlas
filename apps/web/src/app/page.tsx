import Link from "next/link";
import { buildKnowledgeIndex } from "@/lib/index-builder";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const index = await buildKnowledgeIndex();
  const recent = [...index.reviews]
    .sort((a, b) => (b.acceptedAt ?? "").localeCompare(a.acceptedAt ?? ""))
    .slice(0, 4);

  return (
    <>
      <section className="home-hero" aria-labelledby="home-title">
        <p className="home-eyebrow">Open Review Atlas</p>
        <h1 id="home-title">The arXiv for AI-generated scientific reviews.</h1>
        <p className="lead">
          Generate a review with the Allen AIreview workflow, deposit an exact public version here,
          then let the community read, compare, comment on and challenge its scientific record.
        </p>

        <form action="/archive" method="get" role="search" className="home-search">
          <input type="hidden" name="contentType" value="review" />
          <label htmlFor="home-q" className="sr-only">
            Search reviews, topics, or authors
          </label>
          <input
            id="home-q"
            type="search"
            name="q"
            placeholder="Search a review, topic, or author…"
          />
          <button className="btn" type="submit">
            Search the review archive
          </button>
        </form>

        <div className="home-actions">
          <Link className="btn btn-secondary" href="/archive">
            Browse all reviews
          </Link>
          <Link href="/create-review">Create &amp; deposit a review</Link>
          <Link href="/compare">Compare reviews</Link>
        </div>

        <p className="home-note">
          ORAtlas preserves public, versioned review records. Archive acceptance is not peer review
          or scientific endorsement.
        </p>
      </section>

      <section id="how-it-works" className="home-how" aria-labelledby="how-it-works-title">
        <div className="home-section-intro">
          <p className="home-eyebrow">How it works</p>
          <h2 id="how-it-works-title">One workflow from generation to scientific exchange.</h2>
          <p>
            AIreview creates the review; ORAtlas archives and connects it. The source record, later
            assessments and community responses stay distinct.
          </p>
        </div>
        <div className="home-principles">
          <article>
            <span className="home-principle-index" aria-hidden="true">
              01
            </span>
            <h3>Generate with AIreview</h3>
            <p>Use the Allen template’s gated evidence, drafting, criticism and MyST workflow.</p>
          </article>
          <article>
            <span className="home-principle-index" aria-hidden="true">
              02
            </span>
            <h3>Deposit an exact version</h3>
            <p>ORAtlas captures a public commit or release as an attributable, immutable record.</p>
          </article>
          <article>
            <span className="home-principle-index" aria-hidden="true">
              03
            </span>
            <h3>Inspect and challenge</h3>
            <p>
              Read the review, compare claims and evidence, and add separate comments, challenges or
              TRUST assessments.
            </p>
          </article>
        </div>
      </section>

      <section className="home-latest" aria-labelledby="latest-reviews-title">
        <div className="home-section-heading">
          <div>
            <p className="home-eyebrow">From the archive</p>
            <h2 id="latest-reviews-title">Latest reviews</h2>
          </div>
          <Link href="/archive">Browse the archive</Link>
        </div>

        {recent.length === 0 ? (
          <p className="muted">No reviews have been published yet.</p>
        ) : (
          <ol className="home-review-list">
            {recent.map((review) => (
              <li key={review.reviewSlug}>
                <h3>
                  <Link href={"/reviews/" + review.reviewSlug}>{review.title}</Link>
                </h3>
                {review.authors.length > 0 ? (
                  <p className="muted">{review.authors.join(", ")}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
