import Link from "next/link";
import { CLAIM_EVIDENCE_RELATION_TYPES, CLAIM_TYPES } from "@oratlas/contracts";
import { SpecialistTools } from "@/components/SpecialistTools";
import { ExplorationIntent } from "@/components/ExplorationIntent";
import { KnowledgeLandscape } from "@/components/KnowledgeLandscape";
import { DiscussClient } from "@/app/discuss/DiscussClient";
import { GraphCurationClient } from "./GraphCurationClient";
import { EXPLORATION_INTERESTS, normalizeExplorationInterests } from "@/lib/knowledge-landscape";
import { createKnowledgeLandscapeResponse } from "@/lib/knowledge-landscape-service";
import { resolveDatabaseAnchors } from "@/lib/knowledge-recommendation-service";
import { buildKnowledgeIndex } from "@/lib/index-builder";
import { getCurrentUser, isEditor } from "@/lib/auth";

export const dynamic = "force-dynamic";

type SearchParameters = Record<string, string | string[] | undefined>;
const GRAPH_SCOPE_PARAMETER_KEYS = new Set([
  "q",
  "interest",
  "reviewSlug",
  "claimType",
  "relationType",
  "trustCriterion",
  "known",
]);

function first(parameters: SearchParameters, key: string): string | undefined {
  const value = parameters[key];
  return Array.isArray(value) ? value[0] : value;
}

function all(parameters: SearchParameters, key: string): string[] {
  const value = parameters[key];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const parameters = await searchParams;
  const get = (key: string) => first(parameters, key);
  const q = get("q")?.trim() || undefined;
  const selectedInterests = normalizeExplorationInterests(all(parameters, "interest"));
  const knownNodeIds = normalizeKnownNodeIds(all(parameters, "known"));
  const requestedLandscapeFocus = get("focus")?.trim() || undefined;
  const [index, user] = await Promise.all([buildKnowledgeIndex(), getCurrentUser()]);
  const landscapeResponse = await createKnowledgeLandscapeResponse(index, {
    q,
    interests: selectedInterests,
    focusNodeId: requestedLandscapeFocus,
    reviewSlug: get("reviewSlug") || undefined,
    claimType: get("claimType") || undefined,
    relationType: get("relationType") || undefined,
    trustCriterion: get("trustCriterion") || undefined,
  });
  const landscape = landscapeResponse.landscape;
  const graphReferences = [
    ...new Map(
      landscape.nodes
        .filter((node) => node.graphNodeId)
        .map((node) => [
          node.graphNodeId!,
          { nodeId: node.graphNodeId!, nodeVersionId: node.graphNodeVersionId },
        ]),
    ).values(),
  ];
  const anchorsByGraphNodeId = Object.fromEntries(
    await resolveDatabaseAnchors(graphReferences, knownNodeIds),
  );
  const landscapeOverviewHref = landscapeHref(parameters);
  const landscapeFocusHrefs = Object.fromEntries(
    landscape.nodes.map((node) => [node.id, landscapeHref(parameters, node.id)]),
  );
  const knownToggleHrefByNode = Object.fromEntries(
    graphReferences.map(({ nodeId }) => [
      nodeId,
      landscapeHref(
        parameters,
        requestedLandscapeFocus,
        knownNodeIds.includes(nodeId)
          ? knownNodeIds.filter((knownNodeId) => knownNodeId !== nodeId)
          : [...knownNodeIds, nodeId],
      ),
    ]),
  );
  const clearKnownHref = landscapeHref(parameters, requestedLandscapeFocus, []);
  const reviews = index.reviews.map((review) => ({
    slug: review.reviewSlug,
    title: review.title,
  }));
  const activeFilterCount = ["reviewSlug", "claimType", "relationType", "trustCriterion"].filter(
    (key) => get(key),
  ).length;
  const hasExplicitLandscapeScope = Boolean(
    q ||
    selectedInterests.length > 0 ||
    requestedLandscapeFocus ||
    get("reviewSlug") ||
    get("claimType") ||
    get("relationType") ||
    get("trustCriterion"),
  );

  return (
    <>
      <header className="explore-header">
        <p className="home-eyebrow">Explore ORAtlas</p>
        <h1>Traverse the evidence graph</h1>
        <p className="lead">
          Enter through a topic or explicit interest, then move between preserved reviews, claims,
          evidence, and research objects. Search starts a path; it does not rank a database dump.
        </p>
        <form action="/explore" method="get" role="search" className="explore-search">
          {selectedInterests.map((interest) => (
            <input type="hidden" name="interest" value={interest} key={interest} />
          ))}
          {knownNodeIds.map((nodeId) => (
            <input type="hidden" name="known" value={nodeId} key={nodeId} />
          ))}
          <label htmlFor="explore-q" className="sr-only">
            Search claims, reviews, or authors
          </label>
          <input
            id="explore-q"
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search a claim, review, or author…"
          />
          <button className="btn" type="submit">
            Enter graph
          </button>
        </form>
      </header>

      <ExplorationIntent
        query={q}
        selectedInterests={selectedInterests}
        knownNodeIds={knownNodeIds}
      />

      <section className="explore-traversal-controls" aria-label="Refine graph traversal">
        <details className="explore-filter-panel" open={activeFilterCount > 0}>
          <summary>
            Refine graph entry{activeFilterCount > 0 ? " (" + activeFilterCount + ")" : ""}
          </summary>
          <form action="/explore" method="get" className="filters">
            {q ? <input type="hidden" name="q" value={q} /> : null}
            {selectedInterests.map((interest) => (
              <input type="hidden" name="interest" value={interest} key={interest} />
            ))}
            {knownNodeIds.map((nodeId) => (
              <input type="hidden" name="known" value={nodeId} key={nodeId} />
            ))}
            <div className="field">
              <label htmlFor="reviewSlug">Review</label>
              <select id="reviewSlug" name="reviewSlug" defaultValue={get("reviewSlug") ?? ""}>
                <option value="">Any review</option>
                {reviews.map((review) => (
                  <option key={review.slug} value={review.slug}>
                    {review.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="claimType">Claim type</label>
              <select id="claimType" name="claimType" defaultValue={get("claimType") ?? ""}>
                <option value="">Any type</option>
                {CLAIM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
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
                <option value="">Any relation</option>
                {CLAIM_EVIDENCE_RELATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/-/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="trustCriterion">Assessment criterion (TRUST)</label>
              <input
                id="trustCriterion"
                type="text"
                name="trustCriterion"
                defaultValue={get("trustCriterion") ?? ""}
                placeholder="e.g. entailment"
              />
            </div>
            <div className="btn-row">
              <button className="btn" type="submit">
                Refine path
              </button>
              {activeFilterCount > 0 ? (
                <Link href={scopeHref(q, selectedInterests, knownNodeIds)}>Clear refinements</Link>
              ) : null}
            </div>
          </form>
        </details>
      </section>

      <section className="explore-ai-workspace" aria-label="Evidence graph exploration workspace">
        <div className="explore-ai-landscape">
          {hasExplicitLandscapeScope ? (
            <KnowledgeLandscape
              landscape={landscape}
              overviewHref={landscapeOverviewHref}
              focusHrefByNode={landscapeFocusHrefs}
              knownNodeIds={knownNodeIds}
              knownToggleHrefByNode={knownToggleHrefByNode}
              clearKnownHref={clearKnownHref}
              anchorsByGraphNodeId={anchorsByGraphNodeId}
              focus={
                q ??
                selectedInterests
                  .map(
                    (selected) =>
                      EXPLORATION_INTERESTS.find((interest) => interest.id === selected)?.label ??
                      selected,
                  )
                  .join(", ")
              }
            />
          ) : (
            <section className="knowledge-landscape-empty" aria-label="Guided knowledge landscape">
              <p className="home-eyebrow">Visible graph scope</p>
              <h2>Choose a topic, interest, or filter</h2>
              <p>
                The graph remains empty until you set an explicit scope. ORAtlas does not infer a
                hidden profile or silently fill this view with unrelated records.
              </p>
            </section>
          )}
        </div>
        <div className="explore-ai-discuss">
          <p className="home-eyebrow">Grounded lens</p>
          <h2 id="atlas-discuss-explore-title">Discuss the selected path with Atlas</h2>
          <p className="muted">
            Discuss compresses this bounded path after you can inspect it. Without an LLM key, Atlas
            returns a deterministic evidence summary; generated statements must resolve to exact
            claim–citation edges.
          </p>
          <DiscussClient
            initialQuestion={q ?? ""}
            scope={hasExplicitLandscapeScope ? landscapeResponse.query : undefined}
            embedded
          />
          {isEditor(user) && hasExplicitLandscapeScope && landscape.graphNodeCount >= 2 ? (
            <GraphCurationClient
              scope={landscapeResponse.query}
              initialQuestion={q ?? "Which graph relations are missing from this landscape?"}
            />
          ) : null}
        </div>
      </section>

      <SpecialistTools />

      <section className="explore-record-indexes" aria-labelledby="explore-record-indexes-title">
        <div>
          <p className="home-eyebrow">Complete indexes</p>
          <h2 id="explore-record-indexes-title">Need an exhaustive record list?</h2>
          <p>
            Explore is for connected traversal. The archive and claim explorer remain available for
            comprehensive lookup, deep links, and agent workflows.
          </p>
        </div>
        <nav aria-label="Complete scholarly indexes">
          <Link href={claimsIndexHref(parameters)}>Open claim explorer</Link>
          <Link href={archiveIndexHref(q)}>Open archive</Link>
        </nav>
      </section>
    </>
  );
}

function landscapeHref(
  parameters: SearchParameters,
  focusNodeId?: string,
  knownNodeIdsOverride?: readonly string[],
): string {
  const output = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (
      !GRAPH_SCOPE_PARAMETER_KEYS.has(key) ||
      key === "focus" ||
      (key === "known" && knownNodeIdsOverride !== undefined) ||
      !value
    ) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry) output.append(key, entry);
    }
  }
  for (const nodeId of knownNodeIdsOverride ?? []) output.append("known", nodeId);
  if (focusNodeId) output.set("focus", focusNodeId);
  return "/explore?" + output;
}

function scopeHref(q?: string, interests: string[] = [], knownNodeIds: string[] = []): string {
  const output = new URLSearchParams();
  if (q) output.set("q", q);
  for (const interest of interests) output.append("interest", interest);
  for (const nodeId of knownNodeIds) output.append("known", nodeId);
  return "/explore?" + output;
}

function claimsIndexHref(parameters: SearchParameters): string {
  const output = new URLSearchParams();
  for (const key of ["q", "reviewSlug", "claimType", "relationType", "trustCriterion"]) {
    const value = first(parameters, key);
    if (value) output.set(key, value);
  }
  return output.size > 0 ? `/claims?${output}` : "/claims";
}

function archiveIndexHref(q?: string): string {
  if (!q) return "/archive";
  return `/archive?${new URLSearchParams({ q })}`;
}

function normalizeKnownNodeIds(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value.length <= 200),
    ),
  ].slice(0, 100);
}
