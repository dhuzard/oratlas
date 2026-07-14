import { notFound } from "next/navigation";
import Link from "next/link";
import { type Metadata } from "next";
import { Badge, Card, DefinitionList, Notice, StatusPill } from "@oratlas/ui";
import { getClaimPassport } from "@/lib/claim-monitoring";
import { getClaimIndependence } from "@/lib/synthesis";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ versionId: string; localClaimId: string }>;
}): Promise<Metadata> {
  const { versionId, localClaimId } = await params;
  const passport = await getClaimPassport(versionId, localClaimId);
  if (!passport) return { title: "Claim not found" };
  return { title: `Claim ${passport.localClaimId} — ${passport.reviewTitle}` };
}

/**
 * Stable public claim passport: one claim of one immutable version, its exact
 * evidence selectors, lineage across versions, and evidence alerts.
 */
export default async function ClaimPassportPage({
  params,
}: {
  params: Promise<{ versionId: string; localClaimId: string }>;
}) {
  const { versionId, localClaimId } = await params;
  const passport = await getClaimPassport(versionId, localClaimId);
  if (!passport) notFound();
  const openAlerts = passport.alerts.filter((alert) => alert.status === "open");
  const independence = await getClaimIndependence(versionId, localClaimId);

  return (
    <article>
      <div className="btn-row" style={{ marginBottom: "0.5rem" }}>
        <Badge>claim passport</Badge>
        {passport.claimType ? <Badge tone="neutral">{passport.claimType}</Badge> : null}
        {passport.isExample ? <Badge tone="warning">example data</Badge> : null}
      </div>
      <h1 style={{ fontSize: "1.4rem" }}>{passport.text}</h1>
      {passport.qualification ? (
        <p className="muted">
          <em>Qualification:</em> {passport.qualification}
        </p>
      ) : null}

      {openAlerts.length > 0 ? (
        <Notice tone="warning" title="Evidence alert">
          {openAlerts.length} open update proposal(s) affect this claim. A cited work changed
          status; an editor will resolve each proposal without silently rewriting the claim.
        </Notice>
      ) : null}

      <Card title="Identity">
        <DefinitionList
          items={[
            { term: "Claim ID", value: <span className="mono">{passport.claimId}</span> },
            { term: "Local ID", value: <span className="mono">{passport.localClaimId}</span> },
            {
              term: "Review version",
              value: (
                <Link href={`/reviews/${passport.reviewSlug}/versions/${passport.versionId}`}>
                  {passport.reviewTitle}
                  {passport.semanticVersion ? ` (v${passport.semanticVersion})` : ""}
                </Link>
              ),
            },
            {
              term: "Published",
              value: passport.publishedAt?.slice(0, 10) ?? <span className="muted">—</span>,
            },
            { term: "Section", value: passport.section ?? <span className="muted">—</span> },
          ]}
        />
      </Card>

      <Card title={`Evidence (${passport.evidence.length})`}>
        {passport.evidence.length === 0 ? (
          <p className="muted">No evidence relations were extracted for this claim.</p>
        ) : (
          passport.evidence.map((relation, index) => (
            <div className="relation-row" key={index}>
              <Badge tone={relation.relationType === "contradicts" ? "warning" : "neutral"}>
                {relation.relationType.replace(/-/g, " ")}
              </Badge>
              <span>
                {relation.citationTitle ?? relation.citationLocalId}
                {relation.citationDoi ? (
                  relation.citationIsExample ? (
                    <span className="mono"> ({relation.citationDoi}, example)</span>
                  ) : (
                    <a className="mono" href={`https://doi.org/${relation.citationDoi}`}>
                      {" "}
                      ({relation.citationDoi})
                    </a>
                  )
                ) : null}
              </span>
              {relation.sourceLocation ? (
                <span className="mono muted">@ {relation.sourceLocation}</span>
              ) : null}
              {relation.hasTrustAssessment ? <Badge>TRUST assessed</Badge> : null}
            </div>
          ))
        )}
      </Card>

      {independence ? (
        <Card title="Independence &amp; contradictions">
          <p className="muted">
            Independent evidence is counted in families: cited works sharing a dataset, cohort or
            derivative lineage collapse into one. Circular citations back into the archive are
            excluded.
          </p>
          <DefinitionList
            items={[
              {
                term: "Supporting works",
                value: `${independence.summary.supportingWorks} (${independence.summary.independentSupportingFamilies} independent famil${independence.summary.independentSupportingFamilies === 1 ? "y" : "ies"})`,
              },
              {
                term: "Opposing works",
                value: `${independence.summary.opposingWorks} (${independence.summary.independentOpposingFamilies} independent famil${independence.summary.independentOpposingFamilies === 1 ? "y" : "ies"})`,
              },
              {
                term: "Shared with other claims",
                value:
                  independence.summary.sharedWorkKeys.length > 0 ? (
                    <span className="mono">{independence.summary.sharedWorkKeys.join(", ")}</span>
                  ) : (
                    <span className="muted">none</span>
                  ),
              },
              {
                term: "Circular citations",
                value:
                  independence.summary.circularCitationIds.length > 0 ? (
                    <Badge tone="warning">
                      {independence.summary.circularCitationIds.length} (excluded from counts)
                    </Badge>
                  ) : (
                    <span className="muted">none</span>
                  ),
              },
            ]}
          />
          {independence.contradictions.length > 0 ? (
            <ul>
              {independence.contradictions.map((row, index) => {
                const other = row.a.claimId === passport.claimId ? row.b : row.a;
                return (
                  <li key={index}>
                    {row.kind === "scope-difference"
                      ? `Scope difference (${row.differingScopeFields.join(", ")})`
                      : row.kind === "undetermined-scope"
                        ? "Contradiction over shared evidence (scope undeclared)"
                        : "Genuine contradiction over shared evidence"}{" "}
                    with <Link href={other.passportPath}>{other.text.slice(0, 80)}</Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">No opposing claims detected in the current corpus.</p>
          )}
          <p>
            <Link href="/synthesis">View the full contradiction map</Link>.
          </p>
        </Card>
      ) : null}

      <Card title="Lineage across versions">
        <p className="muted">
          Deterministic lineage: the same repository-local claim id across this review's versions.
          Text changes are surfaced, never inferred.
        </p>
        <ul>
          {passport.lineage.map((entry) => (
            <li key={entry.versionId}>
              <Link
                href={`/claims/${entry.versionId}/${encodeURIComponent(passport.localClaimId)}`}
              >
                {entry.semanticVersion ? `v${entry.semanticVersion}` : entry.versionId}
              </Link>{" "}
              {entry.publishedAt ? (
                <span className="muted">({entry.publishedAt.slice(0, 10)})</span>
              ) : null}{" "}
              {entry.isCurrent ? <Badge>current</Badge> : null}
              {entry.isThisVersion ? <Badge tone="neutral">this passport</Badge> : null}
              {entry.textChanged && !entry.isThisVersion ? (
                <Badge tone="warning">text differs</Badge>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {passport.alerts.length > 0 ? (
        <Card title={`Update proposals (${passport.alerts.length})`}>
          {passport.alerts.map((alert) => (
            <div className="claim-card" key={alert.id}>
              <div className="btn-row">
                <StatusPill status={alert.status} />
                <Badge tone="warning">{alert.citationStatus}</Badge>
                <span className="mono muted">{alert.workAlias}</span>
              </div>
              <p>{alert.rationale}</p>
              {alert.resolutionNote ? (
                <p className="muted">
                  Resolution: {alert.resolutionNote} — @{alert.resolvedByLogin},{" "}
                  {alert.resolvedAt?.slice(0, 10)}
                </p>
              ) : null}
            </div>
          ))}
        </Card>
      ) : null}
    </article>
  );
}
