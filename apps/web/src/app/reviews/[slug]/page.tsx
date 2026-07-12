import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { type Metadata } from "next";
import { Card, Badge, CompatibilityBadge, DefinitionList, Notice, StatusPill } from "@oratlas/ui";
import { getReviewDetail } from "@/lib/reviews";
import { listReviewComments } from "@/lib/comments";
import { getCurrentUser, isEditor } from "@/lib/auth";
import { TrustDisplay } from "@/components/TrustDisplay";
import { CommentsSection } from "./CommentsSection";
import { ProvenanceBadge } from "@oratlas/ui";
import { serializeJsonForHtml } from "@/lib/json-for-html";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; versionId?: string }>;
}): Promise<Metadata> {
  const { slug, versionId } = await params;
  const review = await getReviewDetail(slug, versionId);
  if (!review) return { title: "Review not found" };
  return {
    title: review.title,
    description: review.abstract?.slice(0, 200),
    openGraph: {
      title: review.title,
      description: review.abstract?.slice(0, 200),
      type: "article",
    },
    alternates: {
      canonical: versionId ? `/reviews/${slug}/versions/${versionId}` : `/reviews/${slug}`,
    },
  };
}

function DoiValue({ value, isExample }: { value?: string; isExample: boolean }) {
  if (!value) return <span className="muted">—</span>;
  if (isExample) {
    return (
      <span>
        <span className="mono">{value}</span> <Badge tone="warning">example — not resolvable</Badge>
      </span>
    );
  }
  return (
    <a className="mono" href={`https://doi.org/${value}`} rel="noopener noreferrer">
      {value}
    </a>
  );
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ slug: string; versionId?: string }>;
}) {
  const { slug, versionId } = await params;
  const review = await getReviewDetail(slug, versionId);
  if (!review) notFound();
  const isHistoricalRoute = Boolean(versionId);

  const [comments, user, requestHeaders] = await Promise.all([
    listReviewComments(slug, review.version.id),
    getCurrentUser(),
    headers(),
  ]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const commentList = comments ?? {
    reviewSlug: slug,
    reviewVersionId: review.version.id,
    commentCount: 0,
    comments: [],
  };
  const commentsByClaim = new Map<string, number>();
  for (const c of commentList.comments) {
    if (c.status !== "visible" || !c.claimLocalId) continue;
    commentsByClaim.set(c.claimLocalId, (commentsByClaim.get(c.claimLocalId) ?? 0) + 1);
  }

  const supportingByCitation = new Map<string, number>();
  for (const c of review.claims) {
    for (const r of c.relations) {
      supportingByCitation.set(
        r.citationLocalId,
        (supportingByCitation.get(r.citationLocalId) ?? 0) + 1,
      );
    }
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    headline: review.title,
    abstract: review.abstract,
    author: review.contributors.map((c) => ({ "@type": "Person", name: c.displayName })),
    license: review.licenseSpdx,
    codeRepository: review.repository.canonicalUrl,
    ...(review.version.versionDoi && !review.version.isExample
      ? { identifier: `https://doi.org/${review.version.versionDoi}` }
      : {}),
  };

  return (
    <article>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: serializeJsonForHtml(jsonLd) }}
      />

      <div className="btn-row" style={{ marginBottom: "0.5rem" }}>
        <StatusPill status={review.status} />
        {review.compatibilityLevel ? (
          <CompatibilityBadge level={review.compatibilityLevel} />
        ) : null}
        {review.version.isExample ? <Badge tone="warning">example data</Badge> : null}
      </div>

      {isHistoricalRoute ? (
        <Notice tone="info" title="Immutable historical version">
          You are viewing version {review.version.semanticVersion ?? review.version.id}. Its
          snapshot, evidence and version-scoped discussion are preserved exactly. Historical
          comments are read-only.{" "}
          <Link href={`/reviews/${review.slug}`}>View the current version</Link>.
        </Notice>
      ) : null}

      <h1>{review.title}</h1>
      {review.abstract ? <p className="prose">{review.abstract}</p> : null}

      {review.contributors.length > 0 ? (
        <p className="muted">
          {review.contributors.map((c, i) => (
            <span key={i}>
              {i > 0 ? ", " : ""}
              {c.displayName}
              {c.orcid ? (
                c.isExampleOrcid ? (
                  <span className="mono"> ({c.orcid}, example)</span>
                ) : (
                  <a href={`https://orcid.org/${c.orcid}`} className="mono">
                    {" "}
                    ({c.orcid})
                  </a>
                )
              ) : null}
            </span>
          ))}
        </p>
      ) : null}

      {review.keywords.length > 0 || review.domains.length > 0 ? (
        <ul className="tag-list">
          {review.domains.map((d) => (
            <li key={`d-${d}`}>{d}</li>
          ))}
          {review.keywords.map((k) => (
            <li key={`k-${k}`}>{k}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid layout-2">
        <div>
          <Card title="Repository, version & identifiers">
            <p className="prov-legend">
              <ProvenanceBadge kind="repository-fact">Repository facts</ProvenanceBadge>
            </p>
            <DefinitionList
              items={[
                {
                  term: "Repository",
                  value: (
                    <a href={review.repository.canonicalUrl} className="mono">
                      {review.repository.owner}/{review.repository.name}
                    </a>
                  ),
                },
                {
                  term: "Exact commit",
                  value: <span className="mono">{review.snapshot.commitSha || "—"}</span>,
                },
                {
                  term: "Release",
                  value: review.snapshot.releaseTag ? (
                    review.snapshot.releaseUrl ? (
                      <a href={review.snapshot.releaseUrl}>{review.snapshot.releaseTag}</a>
                    ) : (
                      review.snapshot.releaseTag
                    )
                  ) : (
                    <span className="muted">no release (repository-only)</span>
                  ),
                },
                {
                  term: "Version DOI",
                  value: (
                    <DoiValue
                      value={review.version.versionDoi}
                      isExample={review.version.isExample}
                    />
                  ),
                },
                {
                  term: "Concept DOI",
                  value: (
                    <DoiValue
                      value={review.version.conceptDoi}
                      isExample={review.version.isExample}
                    />
                  ),
                },
                {
                  term: "Zenodo record",
                  value: review.version.zenodoRecordId ? (
                    <span className="mono">{review.version.zenodoRecordId}</span>
                  ) : (
                    <span className="muted">—</span>
                  ),
                },
                {
                  term: "Published review",
                  value: review.publishedReviewUrl ? (
                    <a href={review.publishedReviewUrl}>{review.publishedReviewUrl}</a>
                  ) : (
                    <span className="muted">—</span>
                  ),
                },
                { term: "License", value: review.licenseSpdx ?? <span className="muted">—</span> },
              ]}
            />
            {!review.version.versionDoi && !review.version.conceptDoi ? (
              <Notice tone="info" title="Repository-only review">
                This review has no DOI. The repository owner can connect the repository to Zenodo
                and publish a GitHub release to mint one. See{" "}
                <a href="https://docs.github.com/repositories/archiving-a-github-repository/referencing-and-citing-content">
                  the Zenodo–GitHub workflow
                </a>
                . Note that GitHub default-branch content may differ from a deposited release; the
                exact reviewed state is the commit above.
              </Notice>
            ) : null}
          </Card>

          <Card title="Claims and evidence">
            {review.claims.length === 0 ? (
              <p className="muted">No claims were extracted for this review.</p>
            ) : (
              review.claims.map((claim) => {
                const claimComments = commentsByClaim.get(claim.localClaimId) ?? 0;
                return (
                  <div
                    className="claim-card"
                    key={claim.localClaimId}
                    id={claim.anchor ?? claim.localClaimId}
                  >
                    <p className="claim-text">{claim.text}</p>
                    <div className="btn-row">
                      <span className="mono muted">{claim.localClaimId}</span>
                      {claim.claimType ? <Badge>{claim.claimType}</Badge> : null}
                      {claim.section ? <span className="muted">§ {claim.section}</span> : null}
                      {claimComments > 0 ? (
                        <a href="#community-review">
                          {claimComments} comment{claimComments === 1 ? "" : "s"}
                        </a>
                      ) : null}
                    </div>
                    {claim.qualification ? (
                      <p className="muted">
                        <em>Qualification:</em> {claim.qualification}
                      </p>
                    ) : null}
                    {claim.relations.map((rel, i) => (
                      <div className="relation-row" key={i}>
                        <Badge tone={rel.relationType === "contradicts" ? "warning" : "neutral"}>
                          {rel.relationType.replace(/-/g, " ")}
                        </Badge>
                        <span>
                          {rel.citationTitle ?? rel.citationLocalId}
                          {rel.citationDoi ? (
                            rel.citationIsExample ? (
                              <span className="mono"> ({rel.citationDoi}, example)</span>
                            ) : (
                              <a className="mono" href={`https://doi.org/${rel.citationDoi}`}>
                                {" "}
                                ({rel.citationDoi})
                              </a>
                            )
                          ) : null}
                        </span>
                        {rel.trust ? (
                          <details>
                            <summary>TRUST assessment</summary>
                            <TrustDisplay trust={rel.trust} />
                          </details>
                        ) : (
                          <span className="muted">no TRUST assessment</span>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </Card>

          {review.citations.length > 0 ? (
            <Card title="Citations">
              {review.identifierConflicts.length > 0 ? (
                <Notice tone="warning" title="Conflicting work identifiers">
                  <ul>
                    {review.identifierConflicts.map((conflict) => (
                      <li key={`${conflict.scheme}:${conflict.values.join(":")}`}>
                        {conflict.message} Atlas preserves this assertion but does not silently
                        merge the affected citations.
                      </li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Citation</th>
                      <th>Year</th>
                      <th>DOI</th>
                      <th>Used by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.citations.map((c) => (
                      <tr key={c.localCitationId}>
                        <td>{c.title ?? c.localCitationId}</td>
                        <td>{c.year ?? "—"}</td>
                        <td>
                          {c.doi ? (
                            c.isExample ? (
                              <span className="mono">{c.doi} (example)</span>
                            ) : (
                              <a className="mono" href={`https://doi.org/${c.doi}`}>
                                {c.doi}
                              </a>
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{supportingByCitation.get(c.localCitationId) ?? 0} claim(s)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <CommentsSection
            reviewSlug={review.slug}
            list={commentList}
            claims={review.claims.map((c) => ({
              localClaimId: c.localClaimId,
              anchor: c.anchor,
              text: c.text,
            }))}
            viewer={
              user
                ? {
                    githubLogin: user.githubLogin,
                    displayName: user.displayName,
                    isEditor: isEditor(user),
                  }
                : null
            }
            readOnly={isHistoricalRoute}
          />
        </div>

        <aside>
          <Card title="Compatibility">
            {review.compatibilityLevel ? (
              <CompatibilityBadge level={review.compatibilityLevel} />
            ) : null}
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              Structural compatibility is determined by transparent rules over repository files —
              never by an opaque model decision. Structural grounding does not establish the
              scientific correctness of a claim.
            </p>
          </Card>

          <Card title="Provenance summary">
            <ul className="tag-list" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <li>
                <ProvenanceBadge kind="repository-fact" /> repository, commit, release
              </li>
              <li>
                <ProvenanceBadge kind="extracted" /> title, abstract, authors, DOIs
              </li>
              <li>
                <ProvenanceBadge kind="repository-fact" /> repository TRUST assertions (not Atlas
                verification)
              </li>
              <li>
                <ProvenanceBadge kind="human-reviewed" /> Atlas-reviewed TRUST structure
              </li>
            </ul>
          </Card>

          {review.limitations.length > 0 ? (
            <Card title="Limitations">
              <ul>
                {review.limitations.map((l, i) => (
                  <li key={i} className="muted">
                    {l}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="Version history">
            <ul className="tag-list" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              {review.versions.map((v) => (
                <li key={v.id}>
                  <Link href={`/reviews/${review.slug}/versions/${v.id}`}>
                    {v.semanticVersion ?? v.releaseTag ?? "version"}
                  </Link>{" "}
                  {v.isCurrent ? <Badge>current</Badge> : null}{" "}
                  {v.publishedAt ? (
                    <span className="muted">({v.publishedAt.slice(0, 10)})</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Discuss">
            <p>
              <a href="#community-review">Community discussion ({commentList.commentCount})</a> —
              questions, concerns and endorsements from readers.
            </p>
            <p>Or ask grounded questions across accepted reviews.</p>
            <Link className="btn btn-secondary" href={`/discuss?review=${review.slug}`}>
              Ask Atlas Discuss
            </Link>
          </Card>
        </aside>
      </div>
    </article>
  );
}
