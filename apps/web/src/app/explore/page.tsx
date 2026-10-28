import Link from "next/link";
import {
  CLAIM_EVIDENCE_RELATION_TYPES,
  CLAIM_TYPES,
  type KnowledgeRecommendationAnchor,
} from "@oratlas/contracts";
import { SpecialistTools } from "@/components/SpecialistTools";
import { ExplorationIntent } from "@/components/ExplorationIntent";
import { KnowledgeLandscape } from "@/components/KnowledgeLandscape";
import { DiscussClient } from "@/app/discuss/DiscussClient";
import { GraphCurationClient } from "./GraphCurationClient";
import { EXPLORATION_INTERESTS, normalizeExplorationInterests } from "@/lib/knowledge-landscape";
import { createKnowledgeLandscapeResponse } from "@/lib/knowledge-landscape-service";
import {
  hasDiscussableCanonicalClaimOccurrence,
  issueDiscussionTraversalScope,
} from "@/lib/discussion-scope";
import {
  canonicalReferenceKey,
  resolveCanonicalReferenceLabels,
  resolveDatabaseAnchors,
  type CanonicalNodeReference,
} from "@/lib/knowledge-recommendation-service";
import { getCurrentUser, isEditor } from "@/lib/auth";
import { exploreRobots } from "@/lib/crawl-policy";
import { type Metadata } from "next";
import { ClaimComparisonSelection } from "@/components/ClaimComparisonSelection";
import { getPublicComparisonClaim } from "@/lib/claim-comparison";
import {
  readClaimComparisonSelection,
  withClaimComparisonSelection,
} from "@/lib/claim-comparison-selection";

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
  "compareLeft",
  "replaceSide",
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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}): Promise<Metadata> {
  const robots = exploreRobots(await searchParams);
  return robots ? { robots } : {};
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const parameters = await searchParams;
  const requestedSelection = readClaimComparisonSelection(parameters);
  const selectedClaim = requestedSelection.compareLeft
    ? await getPublicComparisonClaim(requestedSelection.compareLeft)
    : null;
  const selection = selectedClaim
    ? { compareLeft: selectedClaim.reference, replaceSide: requestedSelection.replaceSide }
    : {};
  const unavailableSelection = parameters.compareLeft !== undefined && !selectedClaim;
  const selectedHref = (href: string) => withClaimComparisonSelection(href, selection);
  const currentParameters = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value])
      currentParameters.append(key, entry);
  }
  const currentHref = exploreHref(currentParameters);
  const get = (key: string) => first(parameters, key);
  const q = get("q")?.trim() || undefined;
  const selectedInterests = normalizeExplorationInterests(all(parameters, "interest"));
  const knownNodeIds = normalizeKnownNodeIds(all(parameters, "known"));
  const requestedLandscapeFocus = get("focus")?.trim() || undefined;
  const hasExplicitLandscapeScope = Boolean(
    q ||
    selectedInterests.length > 0 ||
    requestedLandscapeFocus ||
    get("reviewSlug") ||
    get("claimType") ||
    get("relationType") ||
    get("trustCriterion"),
  );
  const landscapeResponse = hasExplicitLandscapeScope
    ? await createKnowledgeLandscapeResponse({
        q,
        interests: selectedInterests,
        focusNodeId: requestedLandscapeFocus,
        reviewSlug: get("reviewSlug") || undefined,
        claimType: get("claimType") || undefined,
        relationType: get("relationType") || undefined,
        trustCriterion: get("trustCriterion") || undefined,
      })
    : undefined;
  const landscape = landscapeResponse?.landscape;
  const graphReferences: CanonicalNodeReference[] = [
    ...new Map<string, CanonicalNodeReference>(
      (landscape?.nodes ?? [])
        .filter((node) => node.graphNodeId && node.graphNodeVersionId)
        .map((node) => [
          `${node.graphNodeId}\u0000${node.graphNodeVersionId}`,
          { nodeId: node.graphNodeId!, nodeVersionId: node.graphNodeVersionId! },
        ]),
    ).values(),
  ];
  const resolvedAnchorsByGraphNodeId: ReadonlyMap<
    string,
    readonly KnowledgeRecommendationAnchor[]
  > =
    graphReferences.length > 0 && knownNodeIds.length > 0
      ? await resolveDatabaseAnchors(graphReferences, knownNodeIds)
      : new Map();
  const anchorsByLandscapeNodeId = Object.fromEntries(
    (landscape?.nodes ?? []).map((node) => [
      node.id,
      node.graphNodeId && node.graphNodeVersionId
        ? (resolvedAnchorsByGraphNodeId.get(node.graphNodeId) ?? []).filter(
            (anchor) => anchor.recommendedNodeVersionId === node.graphNodeVersionId,
          )
        : [],
    ]),
  );
  const anchoredKnownReferences: CanonicalNodeReference[] = [
    ...new Map<string, CanonicalNodeReference>(
      [...resolvedAnchorsByGraphNodeId.values()].flatMap((anchors) =>
        anchors.map((anchor) => {
          const reference = {
            nodeId: anchor.knownNodeId,
            nodeVersionId: anchor.knownNodeVersionId,
          };
          return [canonicalReferenceKey(reference), reference] as const;
        }),
      ),
    ).values(),
  ];
  const anchoredKnownLabels =
    anchoredKnownReferences.length > 0
      ? await resolveCanonicalReferenceLabels(anchoredKnownReferences)
      : new Map();
  const labelByGraphNodeVersionId = Object.fromEntries([
    ...(landscape?.nodes ?? []).flatMap((node) =>
      node.graphNodeVersionId ? [[node.graphNodeVersionId, node.label] as const] : [],
    ),
    ...anchoredKnownReferences.flatMap((reference) => {
      const label = anchoredKnownLabels.get(canonicalReferenceKey(reference));
      return label ? ([[reference.nodeVersionId, label]] as const) : [];
    }),
  ]);
  const landscapeOverviewHref = selectedHref(landscapeHref(parameters));
  const landscapeFocusHrefs = Object.fromEntries(
    (landscape?.nodes ?? []).flatMap((node) =>
      node.graphNodeId
        ? [[node.id, selectedHref(landscapeHref(parameters, node.graphNodeId))] as const]
        : [],
    ),
  );
  const knownToggleHrefByNode = Object.fromEntries(
    graphReferences.map(({ nodeId }) => [
      nodeId,
      selectedHref(
        landscapeHref(
          parameters,
          requestedLandscapeFocus,
          knownNodeIds.includes(nodeId)
            ? knownNodeIds.filter((knownNodeId) => knownNodeId !== nodeId)
            : [...knownNodeIds, nodeId],
        ),
      ),
    ]),
  );
  const clearKnownHref = selectedHref(landscapeHref(parameters, requestedLandscapeFocus, []));
  const activeFilterCount = ["reviewSlug", "claimType", "relationType", "trustCriterion"].filter(
    (key) => get(key),
  ).length;
  const preservedParameters = [
    "focus",
    "reviewSlug",
    "claimType",
    "relationType",
    "trustCriterion",
  ].flatMap((key): [string, string][] => (get(key) ? [[key, get(key)!]] : []));
  if (selection.compareLeft) preservedParameters.push(["compareLeft", selection.compareLeft]);
  if (selection.replaceSide) preservedParameters.push(["replaceSide", selection.replaceSide]);
  const clearFiltersHref = scopeHref(q, selectedInterests, knownNodeIds, requestedLandscapeFocus);
  const exampleHref = scopeHref("replay", [], knownNodeIds);
  const hasTraversableLandscape = Boolean(landscape && graphReferences.length > 0);
  const hasDiscussableLandscape = Boolean(
    hasTraversableLandscape && (await hasDiscussableCanonicalClaimOccurrence(graphReferences)),
  );
  const discussionScope =
    hasDiscussableLandscape && landscape
      ? issueDiscussionTraversalScope({ nodes: graphReferences, edges: landscape.edges })
      : undefined;
  const user = hasDiscussableLandscape ? await getCurrentUser() : null;

  return (
    <>
      <header className="explore-header">
        <p className="home-eyebrow">Find claims</p>
        <h1>Find claims for your question</h1>
        <p className="lead">
          Start with a topic or explicit interest, then inspect matching claims, their connections
          and preserved sources. This bounded graph view shows a path through available records; it
          is not a complete search of every publication.
        </p>
      </header>

      <ClaimComparisonSelection
        selection={selection}
        selectedText={selectedClaim?.text}
        unavailable={unavailableSelection}
        currentHref={currentHref}
      />

      <ExplorationIntent
        query={q}
        selectedInterests={selectedInterests}
        knownNodeIds={knownNodeIds}
        preservedParameters={preservedParameters}
      />

      <section className="explore-traversal-controls" aria-label="Refine graph traversal">
        <details className="explore-filter-panel" open={activeFilterCount > 0}>
          <summary>
            Refine graph entry{activeFilterCount > 0 ? " (" + activeFilterCount + ")" : ""}
          </summary>
          <form action="/explore" method="get" className="filters">
            {requestedLandscapeFocus ? (
              <input type="hidden" name="focus" value={requestedLandscapeFocus} />
            ) : null}
            {q ? <input type="hidden" name="q" value={q} /> : null}
            {selection.compareLeft ? (
              <input type="hidden" name="compareLeft" value={selection.compareLeft} />
            ) : null}
            {selection.replaceSide ? (
              <input type="hidden" name="replaceSide" value={selection.replaceSide} />
            ) : null}
            {selectedInterests.map((interest) => (
              <input type="hidden" name="interest" value={interest} key={interest} />
            ))}
            {knownNodeIds.map((nodeId) => (
              <input type="hidden" name="known" value={nodeId} key={nodeId} />
            ))}
            <div className="field">
              <label htmlFor="reviewSlug">Review slug</label>
              <input
                id="reviewSlug"
                type="text"
                name="reviewSlug"
                defaultValue={get("reviewSlug") ?? ""}
                placeholder="e.g. hippocampal-replay-review"
              />
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
                <Link href={selectedHref(clearFiltersHref)}>Clear refinements</Link>
              ) : null}
            </div>
          </form>
        </details>
      </section>

      <section className="explore-ai-workspace" aria-label="Evidence graph exploration workspace">
        <div className="explore-ai-landscape">
          {landscape ? (
            <KnowledgeLandscape
              landscape={landscape}
              comparisonSelection={selection}
              comparisonCurrentHref={currentHref}
              clearFiltersHref={activeFilterCount > 0 ? selectedHref(clearFiltersHref) : undefined}
              exampleHref={selectedHref(exampleHref)}
              overviewHref={landscapeOverviewHref}
              focusHrefByNode={landscapeFocusHrefs}
              knownNodeIds={knownNodeIds}
              knownToggleHrefByNode={knownToggleHrefByNode}
              clearKnownHref={clearKnownHref}
              anchorsByLandscapeNodeId={anchorsByLandscapeNodeId}
              labelByGraphNodeVersionId={labelByGraphNodeVersionId}
              focusedGraphNodeId={requestedLandscapeFocus}
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
              <p>
                Try <Link href={selectedHref(exampleHref)}>the topic &ldquo;replay&rdquo;</Link>:
                open a matching claim, follow its linked evidence, then inspect the preserved
                source. This is a topic example, not a scientific conclusion.
              </p>
            </section>
          )}
        </div>
        {hasDiscussableLandscape && landscapeResponse && landscape && discussionScope ? (
          <div className="explore-ai-discuss">
            <p className="home-eyebrow">Grounded lens</p>
            <h2 id="atlas-discuss-explore-title">Discuss the selected path with Atlas</h2>
            <p className="muted">
              Discuss compresses this bounded path after you can inspect it. Without an LLM key,
              Atlas returns a deterministic evidence summary; generated statements must resolve to
              exact claim–citation edges.
            </p>
            <DiscussClient initialQuestion={q ?? ""} scope={discussionScope} embedded />
            {isEditor(user) && landscape.graphNodeCount >= 2 ? (
              <GraphCurationClient
                scope={landscapeResponse.query}
                initialQuestion={q ?? "Which graph relations are missing from this landscape?"}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <SpecialistTools />

      <section className="explore-record-indexes" aria-labelledby="explore-record-indexes-title">
        <div>
          <p className="home-eyebrow">Other collections</p>
          <h2 id="explore-record-indexes-title">Browse claims and sources by collection</h2>
          <p>
            The claim explorer searches accepted archived reviews. The archive also offers
            research-object and synthesis result kinds. Registered external publication versions are
            listed separately under Sources; these collections do not share one search corpus.
          </p>
        </div>
        <nav aria-label="Complete scholarly indexes">
          <Link href={selectedHref(claimsIndexHref(parameters))}>Open claim explorer</Link>
          <Link href={archiveIndexHref(q)}>Open archive</Link>
          <Link href="/publications">Browse registered publications</Link>
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
  return exploreHref(output);
}

function scopeHref(
  q?: string,
  interests: string[] = [],
  knownNodeIds: string[] = [],
  focus?: string,
): string {
  const output = new URLSearchParams();
  if (q) output.set("q", q);
  if (focus) output.set("focus", focus);
  for (const interest of interests) output.append("interest", interest);
  for (const nodeId of knownNodeIds) output.append("known", nodeId);
  return exploreHref(output);
}

function claimsIndexHref(parameters: SearchParameters): string {
  const output = new URLSearchParams();
  for (const key of ["q", "reviewSlug", "claimType", "relationType", "trustCriterion", "focus"]) {
    const value = first(parameters, key);
    if (value) output.set(key, value);
  }
  for (const interest of normalizeExplorationInterests(all(parameters, "interest")))
    output.append("interest", interest);
  for (const nodeId of normalizeKnownNodeIds(all(parameters, "known")))
    output.append("known", nodeId);
  return output.size > 0 ? `/claims?${output}` : "/claims";
}

function archiveIndexHref(q?: string): string {
  if (!q) return "/archive";
  return `/archive?${new URLSearchParams({ q })}`;
}

function normalizeKnownNodeIds(values: readonly string[]): string[] {
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 200);
  return [...new Set(normalized)].slice(0, 100);
}

function exploreHref(parameters: URLSearchParams): string {
  const query = parameters.toString();
  return query ? `/explore?${query}` : "/explore";
}
