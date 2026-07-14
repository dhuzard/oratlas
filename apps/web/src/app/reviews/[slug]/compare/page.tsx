import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Badge } from "@oratlas/ui";
import { getReviewVersionDiff, type DiffSection } from "@/lib/version-diff";

export const dynamic = "force-dynamic";

function Section({ name, section }: { name: string; section: DiffSection }) {
  return (
    <Card title={name}>
      <div className="btn-row">
        <Badge tone={section.added.length ? "success" : "neutral"}>
          {section.added.length} added
        </Badge>
        <Badge tone={section.removed.length ? "warning" : "neutral"}>
          {section.removed.length} removed
        </Badge>
        <Badge>{section.changed.length} changed</Badge>
      </div>
      {section.added.length > 0 ? (
        <p>
          <strong>Added:</strong> {section.added.join(", ")}
        </p>
      ) : null}
      {section.removed.length > 0 ? (
        <p>
          <strong>Removed:</strong> {section.removed.join(", ")}
        </p>
      ) : null}
      {section.changed.length > 0 ? (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Changed record</th>
                <th>Before SHA-256</th>
                <th>After SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {section.changed.map((change) => (
                <tr key={change.key}>
                  <td>{change.key}</td>
                  <td className="mono">{change.beforeChecksum}</td>
                  <td className="mono">{change.afterChecksum}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mono muted" style={{ overflowWrap: "anywhere" }}>
        section {section.beforeChecksum} → {section.afterChecksum}
      </p>
    </Card>
  );
}

export default async function CompareReviewVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const from = Array.isArray(query.from) ? query.from[0] : query.from;
  const to = Array.isArray(query.to) ? query.to[0] : query.to;
  if (!from || !to) notFound();
  const diff = await getReviewVersionDiff(slug, from, to);
  if (!diff) notFound();

  return (
    <div>
      <h1>Canonical version diff</h1>
      <p>
        <Link href={`/reviews/${slug}/versions/${from}`}>Version {from}</Link> →{" "}
        <Link href={`/reviews/${slug}/versions/${to}`}>version {to}</Link>
      </p>
      <p className="muted">
        This comparison is computed from the archived database package only. It covers preserved
        assets, effective metadata, claims and citations; canonical JSON and SHA-256 make the result
        deterministic.
      </p>
      <Card title="Exact provenance">
        <p className="mono">from commit {diff.from.commitSha}</p>
        <p className="mono">to commit {diff.to.commitSha}</p>
        <p className="mono" style={{ overflowWrap: "anywhere" }}>
          diff SHA-256 {diff.checksum}
        </p>
      </Card>
      <Section name="Preserved assets" section={diff.sections.assets} />
      <Section name="Metadata" section={diff.sections.metadata} />
      <Section name="Claims and evidence edges" section={diff.sections.claims} />
      <Section name="Citations" section={diff.sections.citations} />
    </div>
  );
}
