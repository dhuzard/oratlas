import Link from "next/link";
import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@oratlas/ui";
import { ExactPairReferences } from "@/components/ExactPairReferences";
import { ContextualRecordActions } from "@/components/ContextualRecordActions";
import { getPublicClaimComparison } from "@/lib/claim-comparison";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare exact claims" };

type SearchParameters = Record<string, string | string[] | undefined>;

export default async function ClaimComparisonPage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const parameters = await searchParams;
  if (typeof parameters.left !== "string" || typeof parameters.right !== "string") notFound();
  const pair = await getPublicClaimComparison(parameters.left, parameters.right);
  if (!pair) notFound();

  return (
    <article className={`comparison-page claim-pair-page ${styles.page}`}>
      <header className="page-hero">
        <p className="home-eyebrow">Exact occurrence comparison</p>
        <h1>Compare two exact claims</h1>
        <p className="lead">
          Read each assertion in its declared scope, follow its evidence and inspect the preserved
          source. Similar wording or a shared citation does not establish agreement.
        </p>
        <div className="btn-row">
          <Link href="/">Home</Link>
          <Link href="/explore">Find claims</Link>
          <Link href="/compare#review-coverage">Compare review coverage</Link>
        </div>
      </header>

      <Notice title="A comparison is not scientific confirmation">
        Opening this pair creates no relationship, merges no claim identities and changes no
        assessment. Archive acceptance and structural provenance are separate from scientific
        checks.
      </Notice>

      <div className={styles.columns}>
        {[pair.left, pair.right].map((side, position) => (
          <section
            key={position}
            className="card"
            aria-label={`${position === 0 ? "First" : "Second"} claim occurrence`}
          >
            <p className="home-eyebrow">{position === 0 ? "First" : "Second"} exact occurrence</p>
            {side.isExample ? <Badge tone="warning">Demo / synthetic</Badge> : null}
            <h2>{side.source.title}</h2>
            <p className="claim-text">{side.text}</p>
            {side.qualification ? (
              <p>
                <strong>Qualification:</strong> {side.qualification}
              </p>
            ) : null}
            <code className={styles.reference}>{side.reference}</code>
            <Link href={side.reference}>Inspect exact occurrence</Link>

            <h3>Declared scope</h3>
            {side.scope && Object.keys(side.scope).length > 0 ? (
              <dl className={styles.scope}>
                {Object.entries(side.scope).map(([term, value]) => (
                  <div key={term}>
                    <dt>{term}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>No structured scope was declared. Matching scope cannot be assumed.</p>
            )}

            <h3>Source context</h3>
            <p>
              <Link href={side.source.href}>Read exact source version</Link>
            </p>
            {side.source.publishedTargetUrl ? (
              <p>
                <a href={side.source.publishedTargetUrl} rel="external">
                  Open publisher page (may have changed)
                </a>
              </p>
            ) : null}
            <dl className={styles.scope}>
              <div>
                <dt>Version</dt>
                <dd>{side.source.versionId}</dd>
              </div>
              <div>
                <dt>Lifecycle</dt>
                <dd>
                  <Badge>{side.source.lifecycle}</Badge>
                </dd>
              </div>
              <div>
                <dt>Locator</dt>
                <dd>{side.source.locator ?? "No passage locator is available."}</dd>
              </div>
            </dl>
            <p className="muted">{side.source.passageLabel}</p>
            {side.source.passage ? (
              <blockquote className={styles.passage}>{side.source.passage}</blockquote>
            ) : null}
            {side.source.structuralProvenance ? (
              <p>
                Structural provenance: {side.source.structuralProvenance}. This identifies source
                structure, not scientific correctness.
              </p>
            ) : null}

            <h3>Linked evidence</h3>
            {side.evidence.length === 0 ? (
              <p>No linked evidence is returned for this exact occurrence in this bounded read.</p>
            ) : null}
            <ul>
              {side.evidence.map((evidence) => (
                <li key={evidence.id}>
                  <Link href={evidence.href}>{evidence.title}</Link>
                  <p>
                    <Badge>
                      {evidence.status === "confirmed"
                        ? "editor-confirmed relation"
                        : "source assertion"}
                    </Badge>
                    {" · "}
                    {evidence.relationType}
                  </p>
                  {evidence.doi ? (
                    <p>
                      DOI: {evidence.doi}
                      {evidence.isExample ? " (example identifier; no external DOI link)" : ""}
                    </p>
                  ) : null}
                  {evidence.locator ? <p>Evidence locator: {evidence.locator}</p> : null}
                </li>
              ))}
            </ul>
            <ContextualRecordActions
              sourceType={side.source.type}
              sourceHref={side.source.href}
              reference={side.reference}
            />
            <p className="muted">
              {side.evidenceTruncated
                ? "Evidence list truncated; additional records may exist."
                : side.source.type === "publication-version" && !side.canonical
                  ? "Graph evidence coverage is unavailable until this occurrence has an explicit canonical binding."
                  : "All recorded evidence returned for this occurrence is shown."}
            </p>
          </section>
        ))}
      </div>

      <Card title="Relationship and uncertainty">
        {pair.relationships.length === 0 ? (
          <p>
            No relationship in this bounded view. This comparison infers no editor-confirmed
            relationship; additional recorded relations may exist outside the returned neighborhood.
            Pending proposals are not assessed here.
          </p>
        ) : (
          <ul>
            {pair.relationships.map((relationship) => (
              <li key={relationship.id}>
                <Badge>
                  {relationship.status === "confirmed"
                    ? "editor-confirmed relation"
                    : "source assertion"}
                </Badge>{" "}
                {relationship.relationType}
                <p>{relationship.rationale ?? "No rationale was recorded."}</p>
                <p className="muted">
                  Exact direction: {relationship.sourceNodeVersionId} →{" "}
                  {relationship.targetNodeVersionId}
                </p>
              </li>
            ))}
          </ul>
        )}
        {pair.sharedSourceFacts.length > 0 ? (
          <ul>
            {pair.sharedSourceFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        ) : null}
        <ul>
          {pair.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </Card>
      <ExactPairReferences
        href={pair.href}
        references={JSON.stringify(
          {
            left: {
              reference: pair.left.reference,
              sourceVersionId: pair.left.source.versionId,
              occurrenceId: pair.left.source.occurrenceId,
              canonical: pair.left.canonical,
            },
            right: {
              reference: pair.right.reference,
              sourceVersionId: pair.right.source.versionId,
              occurrenceId: pair.right.source.occurrenceId,
              canonical: pair.right.canonical,
            },
          },
          null,
          2,
        )}
      />
      <p>
        <Link href="/api-docs#two-record-recipe">Read and reuse this evidence through REST</Link>
      </p>
    </article>
  );
}
