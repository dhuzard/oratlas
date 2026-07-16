import Link from "next/link";
import { Card, Badge, CompatibilityBadge } from "@oratlas/ui";
import { archiveSearchQuerySchema } from "@oratlas/contracts";
import { buildKnowledgeIndex } from "@/lib/index-builder";
import { searchArchive } from "@/lib/archive-search";

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
    contentType: get("contentType") || "all",
    nodeKind: get("nodeKind") || undefined,
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
  const results = await searchArchive(query, index);
  const domains = [...new Set(index.reviews.flatMap((r) => r.domains))].sort();

  return (
    <>
      <h1>Archive</h1>
      <p className="muted">
        {results.total} publication(s){query.q ? ` matching “${query.q}”` : ""}. Acceptance is not
        peer review.
      </p>

      <div className="grid layout-2">
        <div>
          {results.items.length === 0 ? (
            <Card>
              <p className="muted">No publications match these filters.</p>
            </Card>
          ) : (
            <ul className="review-list">
              {results.items.map((item) => (
                <li
                  key={
                    item.contentType === "review" ? `review:${item.slug}` : `node:${item.node.id}`
                  }
                  className="review-item"
                >
                  <Card as="article">
                    {item.contentType === "review" ? (
                      <>
                        <h2 style={{ fontSize: "1.2rem", margin: "0 0 0.3rem" }}>
                          <Link href={`/reviews/${item.slug}`}>{item.title}</Link>
                        </h2>
                        <div className="meta">
                          <Badge>review</Badge>
                          {item.compatibilityLevel ? (
                            <CompatibilityBadge level={item.compatibilityLevel} />
                          ) : null}
                          {item.hasDoi ? (
                            <Badge tone="success">DOI</Badge>
                          ) : (
                            <Badge>repository-only</Badge>
                          )}
                          {item.hasTrustData ? <Badge>TRUST data</Badge> : null}
                          {item.status === "withdrawn" ? (
                            <Badge tone="warning">withdrawn</Badge>
                          ) : null}
                        </div>
                        {item.abstract ? <p>{truncate(item.abstract)}</p> : null}
                        {item.authors.length > 0 ? (
                          <p className="muted">{item.authors.join(", ")}</p>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <h2 style={{ fontSize: "1.2rem", margin: "0 0 0.3rem" }}>
                          <Link href={`/nodes/${item.node.id}`}>{item.node.title}</Link>
                        </h2>
                        <div className="meta">
                          <Badge>node</Badge>
                          <Badge>{item.node.kind}</Badge>
                        </div>
                        {item.node.abstract ? <p>{truncate(item.node.abstract)}</p> : null}
                        <p className="muted">
                          {item.node.repository.owner}/{item.node.repository.name} ·{" "}
                          <span className="mono">{item.node.localNodeId}</span>
                        </p>
                      </>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {Math.ceil(results.total / results.pageSize) > 1 ? (
            <nav className="btn-row" aria-label="Archive result pages">
              {results.page > 1 ? (
                <Link href={archiveHref(query, results.page - 1)}>Previous</Link>
              ) : null}
              <span className="muted">
                Page {results.page} of {Math.ceil(results.total / results.pageSize)}
              </span>
              {results.page * results.pageSize < results.total ? (
                <Link href={archiveHref(query, results.page + 1)}>Next</Link>
              ) : null}
            </nav>
          ) : null}
        </div>

        <aside>
          <Card title="Filters">
            <p className="muted">Author, domain, DOI, TRUST, and compatibility filter reviews.</p>
            <form method="get" className="filters">
              <div className="field">
                <label htmlFor="contentType">Content type</label>
                <select
                  id="contentType"
                  name="contentType"
                  defaultValue={query.contentType ?? "all"}
                >
                  <option value="all">Reviews and nodes</option>
                  <option value="review">Reviews</option>
                  <option value="node">Nodes</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="nodeKind">Node kind</label>
                <select id="nodeKind" name="nodeKind" defaultValue={query.nodeKind ?? ""}>
                  <option value="">Any kind</option>
                  <option value="claim">Claim</option>
                  <option value="figure">Figure</option>
                  <option value="dataset">Dataset</option>
                  <option value="code">Code</option>
                </select>
              </div>
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

function truncate(value: string): string {
  return value.length > 220 ? `${value.slice(0, 220)}…` : value;
}

function archiveHref(query: ReturnType<typeof archiveSearchQuerySchema.parse>, page: number) {
  const params = new URLSearchParams();
  params.set("contentType", query.contentType ?? "all");
  if (query.nodeKind) params.set("nodeKind", query.nodeKind);
  if (query.q) params.set("q", query.q);
  if (query.domain) params.set("domain", query.domain);
  if (query.author) params.set("author", query.author);
  if (query.hasDoi !== undefined) params.set("hasDoi", String(query.hasDoi));
  if (query.hasTrustData !== undefined) params.set("hasTrustData", String(query.hasTrustData));
  if (query.hasEvidenceData !== undefined) {
    params.set("hasEvidenceData", String(query.hasEvidenceData));
  }
  if (query.compatibility) params.set("compatibility", query.compatibility);
  if (query.trustReviewState) params.set("trustReviewState", query.trustReviewState);
  params.set("sort", query.sort);
  params.set("page", String(page));
  return `/archive?${params}`;
}
