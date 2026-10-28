import Link from "next/link";
import { Card, Badge } from "@oratlas/ui";
import { InProcessSearchProvider } from "@oratlas/knowledge";
import { CLAIM_EVIDENCE_RELATION_TYPES, CLAIM_TYPES } from "@oratlas/contracts";
import { buildKnowledgeIndex } from "@/lib/index-builder";
import { TrustVerificationBadge } from "@/components/TrustVerificationBadge";
import {
  ClaimComparisonAction,
  ClaimComparisonSelection,
} from "@/components/ClaimComparisonSelection";
import { getPublicComparisonClaim } from "@/lib/claim-comparison";
import { normalizeExplorationInterests } from "@/lib/knowledge-landscape";
import {
  readClaimComparisonSelection,
  withClaimComparisonSelection,
} from "@/lib/claim-comparison-selection";

export const dynamic = "force-dynamic";

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const requestedSelection = readClaimComparisonSelection(sp);
  const selectedClaim = requestedSelection.compareLeft
    ? await getPublicComparisonClaim(requestedSelection.compareLeft)
    : null;
  const selection = selectedClaim
    ? { compareLeft: selectedClaim.reference, replaceSide: requestedSelection.replaceSide }
    : {};
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value])
      query.append(key, entry);
  }
  const currentHref = `/claims${query.size ? `?${query}` : ""}`;
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : (sp[k] as string | undefined));
  const all = (key: string): string[] =>
    typeof sp[key] === "string" ? [sp[key]] : (sp[key] ?? []);
  const graphContext: [string, string][] = [
    ...normalizeExplorationInterests(all("interest")).map((value): [string, string] => [
      "interest",
      value,
    ]),
    ...[
      ...new Set(
        all("known")
          .map((value) => value.trim())
          .filter((value) => value.length > 0 && value.length <= 200),
      ),
    ]
      .slice(0, 100)
      .map((value): [string, string] => ["known", value]),
  ];
  const focus = get("focus")?.trim();
  if (focus && focus.length <= 200) graphContext.push(["focus", focus]);
  const exploreQuery = new URLSearchParams(graphContext);
  for (const key of ["q", "reviewSlug", "claimType", "relationType", "trustCriterion"]) {
    const value = get(key);
    if (value) exploreQuery.set(key, value);
  }
  const exploreHref = `/explore${exploreQuery.size ? `?${exploreQuery}` : ""}`;

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
      <p>
        <Link href={withClaimComparisonSelection(exploreHref, selection)}>
          Find claims and connections
        </Link>{" "}
        · Archived-review claim index
      </p>

      <ClaimComparisonSelection
        selection={selection}
        selectedText={selectedClaim?.text}
        unavailable={sp.compareLeft !== undefined && !selectedClaim}
        currentHref={currentHref}
      />
      <p className="muted">
        Search claims from accepted archived reviews and inspect their supporting and contradicting
        citations. This index does not include every registered external publication.{" "}
        {results.total} claim(s) match; this view shows up to 30 results.
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
              const reference = `/claims/${encodeURIComponent(claim.reviewVersionId)}/${encodeURIComponent(claim.localClaimId)}`;
              return (
                <Card as="article" key={`${claim.reviewSlug}-${claim.claimId}`}>
                  <p className="claim-text">{claim.text}</p>
                  <div className="btn-row">
                    {claim.claimType ? <Badge>{claim.claimType}</Badge> : null}
                    {support > 0 ? <Badge tone="success">{support} supporting</Badge> : null}
                    {contradict > 0 ? (
                      <Badge tone="warning">{contradict} contradicting</Badge>
                    ) : null}
                    {claim.relations.flatMap((relation) =>
                      (relation.trustAssessments ?? (relation.trust ? [relation.trust] : [])).map(
                        (assessment) => (
                          <TrustVerificationBadge
                            key={assessment.assessmentId}
                            state={assessment.verificationState}
                          />
                        ),
                      ),
                    )}
                  </div>
                  <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                    from{" "}
                    <Link
                      href={`/reviews/${claim.reviewSlug}/versions/${claim.reviewVersionId}#${claim.anchor}`}
                    >
                      {claim.reviewTitle}
                    </Link>
                  </p>
                  <div className="btn-row">
                    <Link href={withClaimComparisonSelection(reference, selection)}>
                      Inspect exact claim
                    </Link>
                    <ClaimComparisonAction
                      reference={reference}
                      selection={selection}
                      currentHref={currentHref}
                    />
                  </div>
                </Card>
              );
            })
          )}
        </div>

        <aside>
          <Card title="Filter claims">
            <form method="get" className="filters">
              {graphContext.map(([name, value]) => (
                <input type="hidden" key={`${name}:${value}`} name={name} value={value} />
              ))}
              {selection.compareLeft ? (
                <input type="hidden" name="compareLeft" value={selection.compareLeft} />
              ) : null}
              {selection.replaceSide ? (
                <input type="hidden" name="replaceSide" value={selection.replaceSide} />
              ) : null}
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
