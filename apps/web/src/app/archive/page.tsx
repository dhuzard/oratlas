import Link from "next/link";
import { Card, Badge, CompatibilityBadge } from "@oratlas/ui";
import { InProcessSearchProvider } from "@oratlas/knowledge";
import { archiveSearchQuerySchema } from "@oratlas/contracts";
import { buildKnowledgeIndex } from "@/lib/index-builder";

export const dynamic = "force-dynamic";

function bool(v: string | undefined): boolean | undefined {
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : (sp[k] as string | undefined));

  const query = archiveSearchQuerySchema.parse({
    q: get("q") || undefined,
    domain: get("domain") || undefined,
    author: get("author") || undefined,
    hasDoi: bool(get("hasDoi")),
    hasTrustData: bool(get("hasTrustData")),
    hasEvidenceData: bool(get("hasEvidenceData")),
    compatibility: get("compatibility") || undefined,
    trustReviewState: (get("trustReviewState") as never) || undefined,
    sort: (get("sort") as never) || "accepted",
    page: get("page") ? Number(get("page")) : 1,
    pageSize: 20,
  });

  const index = await buildKnowledgeIndex();
  const provider = new InProcessSearchProvider(index);
  const results = provider.searchReviews(query);
  const domains = [...new Set(index.reviews.flatMap((r) => r.domains))].sort();

  return (
    <>
      <h1>Archive</h1>
      <p className="muted">
        {results.total} review(s){query.q ? ` matching “${query.q}”` : ""}. Acceptance is not peer
        review.
      </p>

      <div className="grid layout-2">
        <div>
          {results.items.length === 0 ? (
            <Card>
              <p className="muted">No reviews match these filters.</p>
            </Card>
          ) : (
            <ul className="review-list">
              {results.items.map((r) => (
                <li key={r.reviewSlug} className="review-item">
                  <Card as="article">
                    <h2 style={{ fontSize: "1.2rem", margin: "0 0 0.3rem" }}>
                      <Link href={`/reviews/${r.reviewSlug}`}>{r.title}</Link>
                    </h2>
                    <div className="meta">
                      {r.compatibilityLevel ? (
                        <CompatibilityBadge level={r.compatibilityLevel} />
                      ) : null}
                      {r.hasDoi ? (
                        <Badge tone="success">DOI</Badge>
                      ) : (
                        <Badge>repository-only</Badge>
                      )}
                      {r.hasTrustData ? <Badge>TRUST data</Badge> : null}
                      {r.hasHumanReviewedTrust ? (
                        <Badge tone="success">Atlas-reviewed TRUST structure</Badge>
                      ) : null}
                      {r.publicationYear ? <span>{r.publicationYear}</span> : null}
                    </div>
                    {r.abstract ? (
                      <p style={{ marginBottom: 0 }}>
                        {r.abstract.slice(0, 220)}
                        {r.abstract.length > 220 ? "…" : ""}
                      </p>
                    ) : null}
                    {r.authors.length > 0 ? (
                      <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                        {r.authors.join(", ")}
                      </p>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside>
          <Card title="Filters">
            <form method="get" className="filters">
              <div className="field">
                <label htmlFor="q">Search</label>
                <input id="q" type="search" name="q" defaultValue={query.q ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="author">Author</label>
                <input id="author" type="text" name="author" defaultValue={query.author ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="domain">Domain</label>
                <select id="domain" name="domain" defaultValue={query.domain ?? ""}>
                  <option value="">Any</option>
                  {domains.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="hasDoi">DOI</label>
                <select id="hasDoi" name="hasDoi" defaultValue={get("hasDoi") ?? ""}>
                  <option value="">Any</option>
                  <option value="true">Has DOI</option>
                  <option value="false">Repository-only</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="hasTrustData">TRUST data</label>
                <select
                  id="hasTrustData"
                  name="hasTrustData"
                  defaultValue={get("hasTrustData") ?? ""}
                >
                  <option value="">Any</option>
                  <option value="true">Has TRUST data</option>
                  <option value="false">No TRUST data</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="trustReviewState">TRUST review state</label>
                <select
                  id="trustReviewState"
                  name="trustReviewState"
                  defaultValue={get("trustReviewState") ?? "any"}
                >
                  <option value="any">Any</option>
                  <option value="human-reviewed">Atlas structurally reviewed</option>
                  <option value="agent-proposed-only">Repository/unverified only</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="compatibility">Compatibility</label>
                <select
                  id="compatibility"
                  name="compatibility"
                  defaultValue={query.compatibility ?? ""}
                >
                  <option value="">Any</option>
                  <option value="verified-template">Verified template</option>
                  <option value="compatible">Compatible</option>
                  <option value="partially-compatible">Partially compatible</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="sort">Sort by</label>
                <select id="sort" name="sort" defaultValue={query.sort}>
                  <option value="accepted">Acceptance date</option>
                  <option value="updated">Update date</option>
                  <option value="title">Title</option>
                  <option value="relevance">Relevance</option>
                </select>
              </div>
              <button className="btn" type="submit">
                Apply filters
              </button>
            </form>
          </Card>
        </aside>
      </div>
    </>
  );
}
