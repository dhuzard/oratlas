import { type Metadata } from "next";
import Link from "next/link";
import { Card, Badge } from "@oratlas/ui";
import { nodeArchiveQuerySchema } from "@oratlas/contracts";
import { listPublicNodes } from "@/lib/node-publication";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Knowledge nodes",
  description: "Browse accepted claim, figure, dataset, and code publications.",
};

export default async function NodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const query = nodeArchiveQuerySchema.parse({
    q: first("q") || undefined,
    kind: first("kind") || undefined,
    page: first("page") ? Number(first("page")) : 1,
    pageSize: 20,
  });
  const result = await listPublicNodes(query);

  return (
    <>
      <h1>Knowledge nodes</h1>
      <p className="muted">
        {result.total} accepted claim, figure, dataset, or code publication(s). Each stable node URL
        exposes immutable version history and confirmed graph context.
      </p>
      <div className="grid layout-2">
        <section aria-label="Knowledge node results">
          {result.items.length === 0 ? (
            <Card>
              <p className="muted">No knowledge nodes match these filters.</p>
            </Card>
          ) : (
            <ul className="review-list">
              {result.items.map((node) => (
                <li key={node.id} className="review-item">
                  <Card as="article">
                    <div className="meta">
                      <Badge>node</Badge>
                      <Badge>{node.kind}</Badge>
                    </div>
                    <h2 style={{ fontSize: "1.2rem", margin: "0.4rem 0" }}>
                      <Link href={`/nodes/${node.id}`}>{node.title}</Link>
                    </h2>
                    {node.abstract ? <p>{truncate(node.abstract)}</p> : null}
                    <p className="muted">
                      <span className="mono">{node.localNodeId}</span> · {node.repository.owner}/
                      {node.repository.name}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            q={query.q}
            kind={query.kind}
          />
        </section>
        <aside>
          <Card title="Filters">
            <form method="get" className="filters">
              <div className="field">
                <label htmlFor="node-q">Search nodes</label>
                <input id="node-q" type="search" name="q" defaultValue={query.q ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="node-kind">Kind</label>
                <select id="node-kind" name="kind" defaultValue={query.kind ?? ""}>
                  <option value="">Any kind</option>
                  <option value="claim">Claim</option>
                  <option value="figure">Figure</option>
                  <option value="dataset">Dataset</option>
                  <option value="code">Code</option>
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

function Pagination({
  page,
  pageSize,
  total,
  q,
  kind,
}: {
  page: number;
  pageSize: number;
  total: number;
  q?: string;
  kind?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  const href = (nextPage: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (kind) params.set("kind", kind);
    params.set("page", String(nextPage));
    return `/nodes?${params}`;
  };
  return (
    <nav className="btn-row" aria-label="Knowledge node result pages">
      {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : null}
      <span className="muted">
        Page {page} of {pages}
      </span>
      {page < pages ? <Link href={href(page + 1)}>Next</Link> : null}
    </nav>
  );
}

function truncate(value: string): string {
  return value.length > 260 ? `${value.slice(0, 260)}…` : value;
}
