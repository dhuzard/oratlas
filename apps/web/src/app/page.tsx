import Link from "next/link";
import { Card, Badge, CompatibilityBadge, StatusPill } from "@oratlas/ui";
import { buildKnowledgeIndex } from "@/lib/index-builder";
import { ProvenanceLegend } from "@/components/ProvenanceLegend";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const index = await buildKnowledgeIndex();
  const recent = [...index.reviews]
    .sort((a, b) => (b.acceptedAt ?? "").localeCompare(a.acceptedAt ?? ""))
    .slice(0, 5);
  const domains = [...new Set(index.reviews.flatMap((r) => r.domains))].sort();
  const withDoi = index.reviews.filter((r) => r.hasDoi).length;
  const withTrust = index.reviews.filter((r) => r.hasTrustData).length;

  return (
    <>
      <section className="hero prose">
        <h1>An open archive for computational literature reviews</h1>
        <p className="lead">
          Discover, submit, validate, and discuss AI-enriched computational literature reviews
          produced from public GitHub repositories built with, forked from, or structurally
          compatible with the ComputationalReviewTemplate.
        </p>
        <form
          action="/archive"
          method="get"
          role="search"
          className="btn-row"
          style={{ marginTop: "1rem" }}
        >
          <label
            htmlFor="home-q"
            className="sr-only"
            style={{ position: "absolute", left: "-999px" }}
          >
            Search reviews
          </label>
          <input
            id="home-q"
            type="search"
            name="q"
            placeholder="Search reviews, claims, authors…"
            style={{ maxWidth: "28rem" }}
          />
          <button className="btn" type="submit">
            Search
          </button>
          <Link className="btn btn-secondary" href="/submit">
            Submit a repository
          </Link>
        </form>
      </section>

      <div className="grid layout-2">
        <div>
          <Card title="Recently accepted reviews">
            {recent.length === 0 ? (
              <p className="muted">No reviews yet. Seed the database or submit a repository.</p>
            ) : (
              <ul className="review-list">
                {recent.map((r) => (
                  <li key={r.reviewSlug} className="review-item">
                    <h3>
                      <Link href={`/reviews/${r.reviewSlug}`}>{r.title}</Link>
                    </h3>
                    <div className="meta">
                      <StatusPill status={r.status} />
                      {r.compatibilityLevel ? (
                        <CompatibilityBadge level={r.compatibilityLevel} />
                      ) : null}
                      {r.hasDoi ? (
                        <Badge tone="success">DOI</Badge>
                      ) : (
                        <Badge>repository-only</Badge>
                      )}
                      {r.hasTrustData ? <Badge>TRUST data</Badge> : null}
                      {r.authors.length > 0 ? <span>{r.authors.join(", ")}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <aside>
          <Card title="Filter the archive">
            <p className="muted" style={{ marginTop: 0 }}>
              {index.reviews.length} accepted review(s); {withDoi} with a DOI, {withTrust} with
              TRUST data.
            </p>
            <ul className="tag-list">
              <li>
                <Link href="/archive?hasDoi=true">Has DOI</Link>
              </li>
              <li>
                <Link href="/archive?hasTrustData=true">Has TRUST data</Link>
              </li>
              <li>
                <Link href="/archive?trustReviewState=human-reviewed">Human-reviewed TRUST</Link>
              </li>
            </ul>
            {domains.length > 0 ? (
              <>
                <h3 style={{ fontSize: "1rem" }}>Scientific domains</h3>
                <ul className="tag-list">
                  {domains.map((d) => (
                    <li key={d}>
                      <Link href={`/archive?domain=${encodeURIComponent(d)}`}>{d}</Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
          <Card title="How to read this archive">
            <ProvenanceLegend />
            <p className="muted">
              The interface always distinguishes repository facts, extracted metadata, human-curated
              metadata, agent proposals, and human-reviewed records.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
