import Link from "next/link";
import { Card, Badge } from "@oratlas/ui";
import { InProcessSearchProvider } from "@oratlas/knowledge";
import { CLAIM_EVIDENCE_RELATION_TYPES, CLAIM_TYPES } from "@oratlas/contracts";
import { buildKnowledgeIndex } from "@/lib/index-builder";
import { ProvenanceBadge } from "@oratlas/ui";

export const dynamic = "force-dynamic";

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : (sp[k] as string | undefined));

  const index = await buildKnowledgeIndex();
  const provider = new InProcessSearchProvider(index);
  const results = provider.searchClaims({
    q: get("q") || undefined,
    reviewSlug: get("reviewSlug") || undefined,
    claimType: get("claimType") || undefined,
    relationType: get("relationType") || undefined,
    trustCriterion: get("trustCriterion") || undefined,
    page: 1,
    pageSize: 30,
  });

  const reviews = index.reviews.map((r) => ({ slug: r.reviewSlug, title: r.title }));

  return (
    <>
      <h1>Claim explorer</h1>
      <p className="muted">
        Search claims across all accepted reviews and inspect their supporting and contradicting
        citations. {results.total} claim(s) match.
      </p>

      <div className="grid layout-2">
        <div>
          {results.items.length === 0 ? (
            <Card>
              <p className="muted">No claims match these filters.</p>
            </Card>
          ) : (
            results.items.map((claim) => {
              const support = claim.relations.filter(
                (r) => r.relationType === "supports" || r.relationType === "partially-supports",
              ).length;
              const contradict = claim.relations.filter(
                (r) => r.relationType === "contradicts",
              ).length;
              return (
                <Card as="article" key={`${claim.reviewSlug}-${claim.claimId}`}>
                  <p className="claim-text">{claim.text}</p>
                  <div className="btn-row">
                    {claim.claimType ? <Badge>{claim.claimType}</Badge> : null}
                    {support > 0 ? <Badge tone="success">{support} supporting</Badge> : null}
                    {contradict > 0 ? (
                      <Badge tone="warning">{contradict} contradicting</Badge>
                    ) : null}
                    {claim.relations.some((r) =>
                      (r.trustAssessments ?? (r.trust ? [r.trust] : [])).some(
                        (assessment) =>
                          assessment.reviewStatus === "human-reviewed" ||
                          assessment.reviewStatus === "adjudicated",
                      ),
                    ) ? (
                      <ProvenanceBadge kind="human-reviewed">
                        Atlas structurally reviewed
                      </ProvenanceBadge>
                    ) : claim.relations.some(
                        (r) => (r.trustAssessments?.length ?? 0) > 0 || r.trust !== undefined,
                      ) ? (
                      <ProvenanceBadge kind="repository-fact">
                        Repository TRUST assertion
                      </ProvenanceBadge>
                    ) : null}
                  </div>
                  <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                    from{" "}
                    <Link
                      href={`/reviews/${claim.reviewSlug}/versions/${claim.reviewVersionId}#${claim.anchor}`}
                    >
                      {claim.reviewTitle}
                    </Link>
                  </p>
                </Card>
              );
            })
          )}
        </div>

        <aside>
          <Card title="Filter claims">
            <form method="get" className="filters">
              <div className="field">
                <label htmlFor="q">Search</label>
                <input id="q" type="search" name="q" defaultValue={get("q") ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="reviewSlug">Review</label>
                <select id="reviewSlug" name="reviewSlug" defaultValue={get("reviewSlug") ?? ""}>
                  <option value="">Any</option>
                  {reviews.map((r) => (
                    <option key={r.slug} value={r.slug}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="claimType">Claim type</label>
                <select id="claimType" name="claimType" defaultValue={get("claimType") ?? ""}>
                  <option value="">Any</option>
                  {CLAIM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="relationType">Evidence relation</label>
                <select
                  id="relationType"
                  name="relationType"
                  defaultValue={get("relationType") ?? ""}
                >
                  <option value="">Any</option>
                  {CLAIM_EVIDENCE_RELATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/-/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="trustCriterion">TRUST criterion assessed</label>
                <input
                  id="trustCriterion"
                  type="text"
                  name="trustCriterion"
                  defaultValue={get("trustCriterion") ?? ""}
                  placeholder="e.g. entailment"
                />
              </div>
              <button className="btn" type="submit">
                Apply
              </button>
            </form>
          </Card>
        </aside>
      </div>
    </>
  );
}
