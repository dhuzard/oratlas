import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { type Metadata } from "next";
import { TRUST_CRITERIA } from "@oratlas/contracts";
import { Card, Badge, CompatibilityBadge, DefinitionList, Notice, StatusPill } from "@oratlas/ui";
import { getReviewDetail } from "@/lib/reviews";
import { listReviewComments } from "@/lib/comments";
import { getCurrentUser, isEditor } from "@/lib/auth";
import { TrustDisplay } from "@/components/TrustDisplay";
import { CommentsSection } from "./CommentsSection";
import { ChallengesSection } from "./ChallengesSection";
import { listChallenges, listChallengeSubjectOptions } from "@/lib/challenges";
import { ProvenanceBadge } from "@oratlas/ui";
import { swhidArchiveUrl, swhidForRevision } from "@oratlas/exports";
import { serializeJsonForHtml } from "@/lib/json-for-html";
import { getPreservedArticle } from "@/lib/article-reader";
import { getClaimAlertCounts } from "@/lib/claim-monitoring";
import { getProcessHistoryForVersion } from "@/lib/editorial-lifecycle";
import { listExecutionPassportsForVersion } from "@/lib/execution-passports";
import { getPublicProtocolSummary } from "@/lib/protocol-drift";
import { ArticleReader } from "./ArticleReader";
import { getPublicSynthesisReview } from "@/lib/synthesis-editorial";
import { loadSynthesisReadingContext } from "@/lib/synthesis-reading";
import { SynthesisReader } from "./SynthesisReader";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; versionId?: string }>;
}): Promise<Metadata> {
  const { slug, versionId } = await params;
  const synthesis = versionId ? null : await getPublicSynthesisReview(slug);
  if (synthesis)
    return {
      title: synthesis.title,
      description: synthesis.abstract.slice(0, 200),
      alternates: { canonical: `/reviews/${slug}` },
    };
  const review = await getReviewDetail(slug, versionId);
  if (!review) return { title: "Review not found" };
  if (review.isTombstoned) {
    return {
      title: "Content unavailable",
      description: "This scholarly review version has been tombstoned.",
      robots: { index: false, follow: false },
    };
  }
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

function DoiValue({ value, isExample = false }: { value?: string; isExample?: boolean }) {
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
  const synthesis = versionId ? null : await getPublicSynthesisReview(slug);
  if (synthesis) {
    const [reading, requestHeaders] = await Promise.all([
      loadSynthesisReadingContext(synthesis),
      headers(),
    ]);
    if (!reading) notFound();
    return (
      <SynthesisReader
        synthesis={synthesis}
        reading={reading}
        nonce={requestHeaders.get("x-nonce") ?? undefined}
      />
    );
  }
  const review = await getReviewDetail(slug, versionId);
  if (!review) notFound();
  const isHistoricalRoute = Boolean(versionId);

  if (review.isTombstoned) {
    return (
      <article>
        <StatusPill status="tombstoned" />
        <h1>Content unavailable</h1>
        <Notice tone="error" title="Tombstoned scholarly version">
          The archived content and every derived public representation are withheld. Article
          metadata, authors, claims, citations, comments, search entries, discussion evidence,
          assets, exports and feed summaries are not served.
        </Notice>
        {review.lifecycleEvents.map((event) => (
          <Card title="Public lifecycle record" key={event.id}>
            <p>{event.reason}</p>
            <p className="muted">
              Recorded by @{event.actorLogin} on {event.createdAt.slice(0, 10)} · revision{" "}
              {event.revision}
            </p>
          </Card>
        ))}
        <p>
          <Link href="/api/feeds/lifecycle">View the machine-readable lifecycle ledger</Link>.
        </p>
      </article>
    );
  }

  const [
    comments,
    user,
    requestHeaders,
    preservedArticle,
    processHistory,
    executionPassports,
    protocolDrift,
    challenges,
    challengeSubjects,
  ] = await Promise.all([
    listReviewComments(slug, review.version.id),
    getCurrentUser(),
    headers(),
    getPreservedArticle(slug, review.version.id),
    getProcessHistoryForVersion(review.version.id),
    listExecutionPassportsForVersion(review.version.id),
    getPublicProtocolSummary(review.version.id),
    listChallenges(slug, review.version.id),
    listChallengeSubjectOptions(review.version.id),
  ]);
  const claimAlertCounts = await getClaimAlertCounts(review.version.id);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const commentList = comments ?? {
    reviewSlug: slug,
    reviewVersionId: review.version.id,
    commentCount: 0,
    comments: [],
  };
  const challengeList = challenges ?? {
    reviewSlug: slug,
    reviewVersionId: review.version.id,
    challenges: [],
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

  const revisionSwhid = review.snapshot.commitSha
    ? swhidForRevision(review.snapshot.commitSha)
    : undefined;

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

      {review.publicState === "withdrawn" ? (
        <Notice tone="error" title="Withdrawn version">
          This version remains visible as part of the scholarly record but should not be relied
          upon. See the attributable lifecycle notice below.
        </Notice>
      ) : null}

      {review.lifecycleEvents.map((event) => {
        const isCorrection = event.kind === "correction";
        const isCorrectedVersion = isCorrection && event.reviewVersionId === review.version.id;
        const isSupersededVersion = isCorrection && event.supersedesVersionId === review.version.id;
        return (
          <Notice
            key={event.id}
            tone={event.kind === "withdrawal" ? "error" : "warning"}
            title={
              isCorrectedVersion
                ? "Correction published"
                : isSupersededVersion
                  ? "Superseded by a corrected version"
                  : "Lifecycle notice"
            }
          >
            {event.reason} — @{event.actorLogin}, {event.createdAt.slice(0, 10)}.
            {isCorrectedVersion && event.supersedesVersionId ? (
              <>
                {" "}
                <Link href={`/reviews/${review.slug}/versions/${event.supersedesVersionId}`}>
                  View the prior version
                </Link>
                .
              </>
            ) : null}
            {isSupersededVersion ? (
              <>
                {" "}
                <Link href={`/reviews/${review.slug}/versions/${event.reviewVersionId}`}>
                  View the corrected version
                </Link>
                .
              </>
            ) : null}
          </Notice>
        );
      })}

      <h1>{review.title}</h1>
      {review.abstract ? <p className="prose">{review.abstract}</p> : null}

      {protocolDrift?.snapshots.length ? (
        <Card title={`Protocol Drift Radar (${protocolDrift.openCount} open)`}>
          <p className="muted">
            Registered protocol snapshots are compared exactly with structured claim scope.
            Differences are human-review proposals, not misconduct findings.
          </p>
          {protocolDrift.snapshots.map((snapshot) => (
            <div className="claim-card" key={snapshot.id}>
              <div className="btn-row">
                <Badge>{snapshot.registry}</Badge>
                <a href={snapshot.sourceUrl} rel="noopener noreferrer">
                  {snapshot.sourceId}
                </a>
                <span className="mono muted">version {snapshot.sourceVersion}</span>
              </div>
              <p className="mono muted" style={{ fontSize: "0.8rem" }}>
                captured {snapshot.fetchedAt} · SHA-256 {snapshot.contentHash}
              </p>
              {snapshot.proposals.map((proposal) => (
                <p key={proposal.id}>
                  <StatusPill status={proposal.status} /> <strong>{proposal.category}</strong>:{" "}
                  {proposal.rationale}
                </p>
              ))}
            </div>
          ))}
          <p>
            <Link href={`/api/protocols/reviews/${review.version.id}`}>
              Machine-readable summary
            </Link>
          </p>
        </Card>
      ) : null}

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
                  term: "Exact tree",
                  value: <span className="mono">{review.snapshot.treeSha || "—"}</span>,
                },
                {
                  term: "Archival ID (SWHID)",
                  value: revisionSwhid ? (
                    review.version.isExample ? (
                      <span>
                        <span className="mono">{revisionSwhid}</span>{" "}
                        <Badge tone="warning">example — not archived</Badge>
                      </span>
                    ) : (
                      <a className="mono" href={swhidArchiveUrl(revisionSwhid)}>
                        {revisionSwhid}
                      </a>
                    )
                  ) : (
                    <span className="muted">—</span>
                  ),
                },
                {
                  term: "Source selection",
                  value: review.version.sourceKind ?? "legacy capture",
                },
                {
                  term: "Release",
                  value: review.version.releaseTag ? (
                    review.version.releaseUrl ? (
                      <a href={review.version.releaseUrl}>{review.version.releaseTag}</a>
                    ) : (
                      review.version.releaseTag
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
            {review.version.capturePayloadHash ? (
              <p className="mono muted" style={{ overflowWrap: "anywhere" }}>
                Accepted capture SHA-256 {review.version.capturePayloadHash}
              </p>
            ) : null}
          </Card>

          {review.version.publicationConsistency ? (
            <Card title="Release / DOI / commit consistency">
              <StatusPill status={review.version.publicationConsistency.status} />
              <ul>
                {review.version.publicationConsistency.checks.map((check) => (
                  <li key={check.id}>
                    <span className="mono">{check.id}</span>: {check.outcome} — {check.description}
                    {check.details ? ` (${check.details})` : ""}
                  </li>
                ))}
              </ul>
              {review.version.editorialOverrides.length > 0 ? (
                <Notice tone="warning" title="Editorial exceptions">
                  <ul>
                    {review.version.editorialOverrides.map((override) => (
                      <li key={override.checkId}>
                        <span className="mono">{override.checkId}</span> — {override.rationale} — @
                        {override.editorLogin}, {override.createdAt.slice(0, 10)}
                      </li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
              <p className="muted">
                This report verifies identifier and source consistency. It does not judge the
                scientific correctness of the review.
              </p>
            </Card>
          ) : null}

          {preservedArticle ? (
            <ArticleReader
              document={preservedArticle}
              claims={review.claims.map((claim) => ({
                anchor: claim.anchor,
                localClaimId: claim.localClaimId,
                text: claim.text,
                section: claim.section,
              }))}
            />
          ) : (
            <Notice tone="info" title="No complete preserved article file">
              This version still exposes its immutable metadata and evidence graph, but no complete,
              non-truncated Markdown article was captured for the reader.
            </Notice>
          )}

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
                    id={
                      preservedArticle
                        ? `${claim.anchor}-evidence`
                        : (claim.anchor ?? claim.localClaimId)
                    }
                  >
                    <span id={`claim-subject-${claim.subjectId}`} />
                    <p className="claim-text">{claim.text}</p>
                    <div className="btn-row">
                      <span className="mono muted">{claim.localClaimId}</span>
                      {claim.claimType ? <Badge>{claim.claimType}</Badge> : null}
                      <Link
                        href={`/claims/${review.version.id}/${encodeURIComponent(claim.localClaimId)}`}
                      >
                        passport
                      </Link>
                      {(claimAlertCounts.get(claim.localClaimId) ?? 0) > 0 ? (
                        <Badge tone="warning">
                          evidence alert ({claimAlertCounts.get(claim.localClaimId)})
                        </Badge>
                      ) : null}
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
                      <div
                        className="relation-row"
                        key={i}
                        id={`relation-subject-${rel.relationId}`}
                      >
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
                        {rel.trusts.length > 0 ? (
                          <details>
                            <summary>TRUST assessments ({rel.trusts.length})</summary>
                            {rel.trusts.map((trust) => (
                              <section
                                key={trust.assessmentId}
                                aria-label={`TRUST assessment ${trust.assessmentId}`}
                              >
                                {TRUST_CRITERIA.map((criterion) => (
                                  <span
                                    id={`assessment-subject-${trust.assessmentId}-${criterion}`}
                                    key={criterion}
                                  />
                                ))}
                                <TrustDisplay trust={trust} />
                              </section>
                            ))}
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

          {processHistory.length > 0 ? (
            <Card title="Editorial process history">
              <p className="muted">
                Open review: reports, responses and decision letters are public, attributable and
                immutable across revision rounds.
              </p>
              {processHistory.map((entry, entryIndex) => (
                <div key={entry.submissionId}>
                  <p>
                    <strong>Submission {entryIndex + 1}</strong>{" "}
                    <span className="muted">
                      by @{entry.submitterLogin}
                      {entry.submittedAt ? ` · ${entry.submittedAt.slice(0, 10)}` : ""} ·{" "}
                      {entry.status}
                    </span>
                  </p>
                  {entry.rounds.map((round) => (
                    <div className="claim-card" key={round.roundId}>
                      <p>
                        <strong>Round {round.roundNumber}</strong>{" "}
                        <span className="muted">({round.status})</span>
                      </p>
                      <ul>
                        {round.reports.map((report, reportIndex) => (
                          <li key={reportIndex}>
                            Review by @{report.reviewerLogin} — {report.recommendation}
                            {report.reviewerOrcid
                              ? ` (ORCID ${report.reviewerOrcid}${report.orcidVerified ? "" : ", unverified"})`
                              : ""}
                            , {report.submittedAt.slice(0, 10)}
                          </li>
                        ))}
                        {round.responses.map((response, responseIndex) => (
                          <li key={`r-${responseIndex}`}>
                            Author response by @{response.authorLogin},{" "}
                            {response.submittedAt.slice(0, 10)}
                          </li>
                        ))}
                        {round.decision ? (
                          <li>
                            Decision: {round.decision.decision} — @{round.decision.editorLogin},{" "}
                            {round.decision.issuedAt.slice(0, 10)}
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </Card>
          ) : null}

          <ChallengesSection
            initial={challengeList}
            subjects={challengeSubjects}
            canFile={Boolean(user)}
          />

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

          <Card title={`Execution passports (${executionPassports.length})`}>
            <p className="muted">
              Offline verification of exact commit/tree, workflow identity, inputs, outputs, SHA-256
              digests and configured signing identity. “Execution-attested” is not a claim that
              Atlas reran the workflow or reproduced its scientific result.
            </p>
            {executionPassports.length === 0 ? (
              <p className="muted">No verified execution attestations are bound to this version.</p>
            ) : (
              <ul>
                {executionPassports.map((execution) => (
                  <li key={execution.id}>
                    <Badge>execution-attested</Badge>{" "}
                    <span className="mono">{execution.workflow.path}</span> run{" "}
                    <span className="mono">
                      {execution.workflow.runId}/{execution.workflow.runAttempt}
                    </span>{" "}
                    · {execution.claims.length} claim(s) · {execution.artifacts.length} artifact(s)
                    · <a href={execution.machineUrl}>JSON passport</a>
                  </li>
                ))}
              </ul>
            )}
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

          <Card title="Preservation &amp; exports">
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              Accepted versions are preserved in the archive and stay readable and exportable even
              if the upstream repository disappears.
            </p>
            <ul className="tag-list" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              {(
                [
                  ["bibtex", "BibTeX"],
                  ["ris", "RIS"],
                  ["csl", "CSL-JSON"],
                  ["jats", "JATS XML"],
                  ["ro-crate", "RO-Crate"],
                  ["prov", "PROV (JSON-LD)"],
                  ["package", "Preservation manifest"],
                  ["docmap", "DocMaps process history"],
                ] as const
              ).map(([format, label]) => (
                <li key={format}>
                  <a
                    href={`/api/reviews/${review.slug}/versions/${review.version.id}/export/${format}`}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Version history">
            <ul className="tag-list" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              {review.versions.map((v) => (
                <li key={v.id}>
                  <Link href={`/reviews/${review.slug}/versions/${v.id}`}>
                    {v.publicState === "tombstoned"
                      ? "withheld version"
                      : (v.semanticVersion ?? v.releaseTag ?? "version")}
                  </Link>{" "}
                  {v.isCurrent ? <Badge>current</Badge> : null}{" "}
                  {v.publicState !== "published" ? (
                    <Badge tone="warning">{v.publicState}</Badge>
                  ) : null}{" "}
                  {v.publishedAt ? (
                    <span className="muted">({v.publishedAt.slice(0, 10)})</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {review.versions.filter((version) => version.publicState !== "tombstoned").length >
            1 ? (
              <Link
                href={`/reviews/${review.slug}/compare?from=${review.versions.filter((version) => version.publicState !== "tombstoned")[1]!.id}&to=${review.versions.filter((version) => version.publicState !== "tombstoned")[0]!.id}`}
              >
                Compare the two latest readable versions
              </Link>
            ) : null}
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
