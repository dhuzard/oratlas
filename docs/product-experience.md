# ORAtlas product experience

This document explains the product model, information architecture, and scientific semantics. The
normative UI terminology and release gates live in [`UI_UX_RULES.md`](../UI_UX_RULES.md).

ORAtlas is an evidence comparison workbench for researchers examining scientific claims. It preserves
exact source records and exposes their claims, evidence relations, assessments, and provenance through
human and machine interfaces. Manuscript authoring, source protocols, and scientific computations
remain with their independent owners.

The initial public journey is **find relevant claims → select two exact occurrences → inspect scope,
evidence, and source context → reuse exact references**. A prepared synthetic pair demonstrates the
workflow without implying that example evidence is real. Copying a pair URL preserves its selection;
it does not save a personal judgment or create private workspace authority.

## Primary information architecture

| Surface                | User question                                                                    | Responsibility                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Find claims            | Which recorded claims relate to my question?                                     | Bounded discovery with explicit corpus, readable results, and contextual connections    |
| Compare                | What do these exact claims say, and what evidence or relationships are recorded? | Exact-pair inspection, scope differences, evidence, provenance, and reusable references |
| Sources                | Which source and version am I inspecting?                                        | Clearly separated publication, review, and research-object collections                  |
| Source or claim detail | What was captured here, and what remains unknown?                                | Preserved context, exact identity, evidence, checks, history, and governed actions      |
| API & agents           | How can software inspect the same records?                                       | Direct machine discovery, contracts, examples, and exact-record endpoints               |

Find claims, Compare, and Sources are the three primary destinations. API & agents remains a visible
utility; account and role-scoped Editorial retain their existing authority. Verification and
certification catalogs, discussion, graph, coverage, synthesis, and replication remain available
through contextual or specialist links. Their routes and records remain accessible.

### Available corpus and comparison scope

Find claims is the human entry to the existing bounded Explore projections. The legacy claim index
at `/claims` covers archived review claims; it is not a catalog of every external claim occurrence.
Sources groups separate collections: `/publications` lists up to 50 recently observed publication
versions, `/archive` retains its own search and filters, and `/nodes` provides research-object
discovery. These links do not implement a unified search, and a version count is not a study count.

The exact-pair view accepts exact legacy claim paths, canonical claim-version paths with a supported
claim-occurrence projection, and immutable external occurrence API references. An external occurrence
does not require a canonical graph binding. Unsupported, missing, or unavailable references remain
explicit; the comparison never guesses a replacement. The existing `left`/`right` review-slug mode
continues to compare review coverage. See the
[exact-pair fixture and supported references](audits/product-simplification/11-run-2-exact-pair.md).

Comparison distinguishes source-declared evidence relations from editor-confirmed graph relations.
Private editorial proposals are outside the public read. Unknown scope, absent evidence, and truncated
neighborhoods remain visible limitations. Selecting or copying a pair neither merges occurrences nor
confirms a relationship.

### Source preparation and participation

Public GitHub review deposit continues to complement the
[ComputationalReviewTemplate](https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate):
authors generate their review upstream, then select an exact source revision for inspection,
validation, and an editorial decision. The archived article and figures remain readable. Registered
external publications retain their producer-owned identities and original homes; ORAtlas exposes its
immutable observations and the captured content actually available.

Sources must keep preparation and deposit guidance reachable without implying arbitrary PDF, chat,
or private-source import. A developer preparation guide is not an import form, and existing
editor-only registration remains editor-only. Comments, formal challenges, assessment disagreements,
relation proposals, and later versions retain their distinct subjects, authority, and history.

### Compatibility and scope

Sources is a presentation grouping, not a new authoritative Source model. Publication identity, exact
version identity, source occurrence, and canonical graph identity remain separate. Equal text, local
IDs, digests, or similarity never confer shared identity. Version DOI and concept DOI remain distinct.

Navigation changes preserve existing route/query/fragment behavior, API URLs and schemas, machine
discovery, lifecycle checks, and source/evidence subjects. The website and API expose the same exact
records; agents never need to scrape the GUI. New producer integrations still require pinned contracts,
fixtures, negative tests, and rollback plans. ORAtlas neither changes producer bytes to pass import
nor owns the verifier's scientific algorithms.

Rendered public-contract changes follow the applicable
[G1 capture and review process](private-workspace-g1-harness.md). Reviewed navigation evidence does not
pass G1 or waive private-workspace gates. Saved team comparisons, general delegated agent writes,
cross-source search, and private collaboration require their own contracts and validation; this
positioning does not advertise them as implemented. Rollback restores prior presentation while
preserving scientific records and established routes.

## Scientific semantics

- Archive acceptance is curation, not peer review or endorsement.
- A missing claim, citation, or TRUST record means the deposit does not expose it to ORAtlas; it is
  not a negative quality judgment.
- Repository-declared and agent-proposed TRUST stays visibly distinct from human-reviewed or
  adjudicated TRUST.
- Comparison counts describe coverage only. They are not confidence or quality scores.
- Several reviews citing the same work are not independent replications.
- Shared DOI, dataset, author, laboratory, and derivation facts describe overlap. Missing overlap
  metadata does not establish independence, and a deterministic scope match does not adjudicate
  scientific contradiction.
- `published-structure` and `source-byte` describe structural provenance only. Neither is scientific
  confirmation, peer review, or certification. TRUST remains attached to an evidence relation;
  verification findings and certification conclusions retain their exact subjects and protocols.
- Comments are open discussion. Formal challenges are immutable, attributable objections to exact
  subjects. Neither silently mutates the review.

## Current safe-rendering boundary

The reader captures the Markdown and notebook files listed by the pinned `myst.yml` table of
contents and renders a sanitized MyST AST from the immutable database snapshot. Repository HTML,
JavaScript, styles, and plugins are never executed. Source TRUST v2 remains visually and
semantically distinct from Atlas verification. Selected-text comments use a version-bound page
path, preserved-source hash, and W3C TextQuote/TextPosition selectors whose positions count Unicode
code points in the canonical rendered-page text. The server accepts an anchor only when its quote,
context, positions, page path, and source hash match that immutable projection. The reader highlights
these threads and publishes them through a JSON-LD AnnotationPage for human and agent consumers.
Mutable upstream Pages output is never the archived record.
