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
          Inspect a scientific claim, its linked evidence, and the independent assessments or
          disagreements around it—without rewriting the original record.
        </p>

        <form action="/archive" method="get" role="search" className="home-search">
          <label htmlFor="home-q" className="sr-only">
            Search claims, reviews, or authors
          </label>
          <input
            id="home-q"
            type="search"
            name="q"
            placeholder="Search a claim, review, or author…"
          />
          <button className="btn" type="submit">
            Explore claims and evidence
          </button>
        </form>

        <div className="home-actions">
          <Link className="btn btn-secondary" href="/submit">
            Submit a review
          </Link>
          <Link href="#how-it-works">How ORAtlas works</Link>
        </div>

        <p className="home-note">
          ORAtlas preserves public, versioned review records. Archive acceptance is not peer review
          or scientific endorsement.
        </p>
      </section>

      <section
        id="how-it-works"
        className="home-how"
        aria-labelledby="how-it-works-title"
      >
        <div className="home-section-intro">
          <p className="home-eyebrow">How it works</p>
          <h2 id="how-it-works-title">Follow a review from claim to evidence.</h2>
          <p>
            ORAtlas keeps the published record, supporting material, and later assessments
            connected without confusing one for another.
          </p>
        </div>
        <div className="home-principles">
          <article>
            <span className="home-principle-index" aria-hidden="true">
              01
            </span>
            <h3>Preserved record</h3>
            <p>Each accepted review version remains identifiable, attributable, and unchanged.</p>
          </article>
          <article>
            <span className="home-principle-index" aria-hidden="true">
              02
            </span>
            <h3>Claims linked to evidence</h3>
            <p>Inspect what a review claims and the exact sources or artifacts connected to it.</p>
          </article>
          <article>
            <span className="home-principle-index" aria-hidden="true">
              03
            </span>
            <h3>Assessments stay independent</h3>
            <p>
              Assessments, challenges, and disagreements remain separate records—not a universal
              score.
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
