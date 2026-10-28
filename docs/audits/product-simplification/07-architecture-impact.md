# Product and architecture alignment

V/I/H: [diagnosis](01-product-diagnosis.md). Recommendation: compose a narrow public comparison path first. A private cross-tool workspace is a separate, substantial project.

## Minimum model and existing fit

| Need                 | Existing model / implementation (V)                                                                  | Gap and proposed treatment (I/R)                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact source         | `RepositorySnapshot`, `ReviewVersion`; `Publication`, `PublicationVersion`, `PublicationCapture`     | Retain both producer boundaries. UI “Source” is a projection, not a new authoritative Source table.                                                                     |
| Assertion in context | legacy `Claim`; external `PublicationClaimOccurrence`, including selector, source binding and target | Treat occurrences as immutable inputs. Unstructured notes/chat need a new, reviewed bounded capture contract; do not fake a publication or repository identity.         |
| Canonical identity   | `KnowledgeNode`, `KnowledgeNodeVersion`; explicit claim/occurrence bindings                          | Reuse canonical tuples for comparison. Equal text/local IDs/digests do not confer shared identity.                                                                      |
| Evidence             | `Citation`, `ClaimEvidenceRelation`, `NodeEdge`, canonical work aliases                              | Keep claim-evidence subjects and IDs stable. Citation count is not evidential strength or independence.                                                                 |
| Judgments            | immutable `TrustAssessment`, node-relation assessments, adjudications, challenges                    | Display protocol-scoped profiles separately; supersession keeps history. Never introduce a cross-assessment score.                                                      |
| Relationship review  | `NodeEdgeProposal`, `NodeIdentityProposal`, editor decisions, `AgentRun`                             | Adequate for existing governed public relations; no general user-owned saved comparison or shared decision notebook.                                                    |
| Checks               | `VerificationRun`, findings/artifacts, credential/lease lifecycle; separate certification records    | Contextual detail or headless API; no change to verifier ownership or protocol identity.                                                                                |
| Collaboration        | comments, passage annotations, challenges, editorial roles and rounds                                | Public/editorial collaboration exists. Team membership, invitations and private processing rights do not exist in production schema.                                    |
| Reuse                | exact links, graph and publication packets, review exports, lifecycle feed                           | MVP can copy exact comparison selection and source references. A new persisted comparison/decision/export format is a later additive contract, not an existing feature. |
| Workspace            | security ADR, prototypes, fixture adapters, G1 harness                                               | Not a label on a public query. Preserve separate storage/authority and existing gates before private use.                                                               |

References: [Prisma schema](../../../packages/db/prisma/schema.prisma), [publication contracts](../../../packages/contracts/src/publications.ts), [canonical graph](../../../packages/contracts/src/canonical-graph.ts), [materializer](../../../packages/db/src/publication-claim-materialization.ts), [claim identity](../../../packages/contracts/src/node-identity.ts).

## What requires backend work?

**No database/API change needed:** navigation, one Explore input, example entry, explicit source-type/coverage labels, contextual check panels, source links, folded raw identity, preservation of old URLs, and moving specialist destinations out of the header.

**Small server composition needed:** an exact public claim-pair view that combines canonical occurrence content, source links and existing evidence/assessment projections. Add a bounded application read adapter around current services; do not query the full corpus and join arbitrary JSON in the browser. Follow existing visibility and tombstone checks. Missing evidence is explicit, not a fallback to guessed relations.

**Not achievable by routing alone:** a generic searchable source catalog spanning both import paths; arbitrary text/chat imports; durable saved comparisons; non-editor relationship approval; private teams; delegated agent writes. Each needs explicit contracts/authority decisions. Do not silently extend `/api/claims` from legacy review semantics to a new universal response.

**V:** `buildKnowledgeIndex()` indexes latest published legacy reviews and rebuilds in process; `/compare` uses it. `/publications` independently queries at most 50 versions without a search/pagination UI. Canonical graph has the broader occurrence model. **R:** first compose two explicit canonical tuples, then add bounded discovery if the pilot needs it. Reuse existing relational storage; no graph-store migration is justified.

References: [index-builder](../../../apps/web/src/lib/index-builder.ts), [review comparison](../../../apps/web/src/lib/review-comparison.ts), [publications page](../../../apps/web/src/app/publications/page.tsx), [canonical query](../../../apps/web/src/lib/canonical-graph-query.ts), [public visibility](../../../apps/web/src/lib/public-snapshot-visibility.ts).

## Claim integration without identity loss

**V:** external materialization defaults to a distinct `claim:<occurrence stableKey>` node when there is no explicit binding; it can respect a pre-existing reviewed canonical binding. It does not discover equivalence. The current same-claim candidate scan is bounded at 2,000 claims and excludes rows without repository identity. Thus it is not a complete cross-format matching service. Confirming a `NodeIdentityProposal` records a decision/audit entry and does not merge source nodes or rewrite TRUST subjects.

**R:** preserve distinct occurrences and show a reviewed equivalence group as a derived view where supported. A user-facing “same assertion” judgment must carry the exact compared versions and rationale; do not turn a stable-node decision into a timeless claim that every future version is equivalent. Before using existing identity proposals for new comparison flows, verify that the stored text hashes/version context meet this requirement; add a versioned contract only if necessary.

| User interpretation     | Current storage fit                                                         | Safe first behavior                                                                                      |
| ----------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Semantically equivalent | same-claim proposal/decision, separate identities                           | Candidate first; explicit scoped human judgment; no automatic rebinding or merge                         |
| Related / complementary | `contextualizes`, `background`, `extends` where their defined semantics fit | Show relationship and rationale, not synonym equivalence                                                 |
| Opposing                | `contradicts` with exact edge endpoints                                     | Require comparison of population, method, outcome, time and conditions; retain unresolved disagreement   |
| Narrower / broader      | No dedicated narrower/broader enum in `NODE_RELATION_TYPES`                 | Show scope differences as comparison observations. Do not overload `extends` or silently add enum values |
| Low-confidence match    | proposal status and candidate signals                                       | Leave unconfirmed; allow reject/defer; disclose missing scope and lexical/shared-source reasons          |

Evidence: [identity lifecycle](../../../apps/web/src/lib/node-identity-lifecycle.ts), [edge lifecycle](../../../apps/web/src/lib/node-edge-lifecycle.ts), [relation enums](../../../packages/contracts/src/enums.ts), [node identity schema](../../../packages/contracts/src/node-identity.ts).

## Scientific integrity

Keep five distinct layers visible in a comparison:

1. Source assertion: what this source says at this location/version.
2. Evidence relation: what is claimed about a cited work/artifact and by whom.
3. Assessment: how a named assessor evaluated that relation under an exact protocol.
4. Verification finding: result of a specific external scientific check on bounded immutable input.
5. Certification: an attributable protocol conclusion, with lifecycle and limitations.

A structural capture/validation result belongs to provenance, not to layers 3–5 by implication. An AI summary is a derived interpretation. Two models repeating a source do not create additional evidence. Shared DOI/dataset/author facts should remain inspectable overlap facts. Conflicting assessment profiles remain separate, including current heads and accessible history; missing ratings are coverage gaps, per [ratified decisions §§1–3, 8, 11, 14](../../../ORATLAS_DECISIONS.md).

**Verified exception requiring correction:** [synthesis logic](../../../packages/knowledge/src/synthesis.ts) uses union-find over declared dataset/derivation identifiers and returns `independentSupportingFamilies`/`independentOpposingFamilies`. The claim passport renders those as independent evidence; the [disagreement map](../../../apps/web/src/app/synthesis/page.tsx) labels a rule-derived category “Genuine contradiction.” [Replication logic](../../../packages/knowledge/src/replication.ts) consumes the same counts in explanations. Lack of a declared overlap is not evidence of independence; matching declared scope does not establish substantive contradiction. **R:** immediately correct human-facing labels and explanatory claims, then inventory API/derived-output consumers and plan an explicit versioned correction if required. Do not silently rename fields, change existing protocol meaning, or rewrite stored assessments. The MVP should show raw overlap facts and a candidate relationship pending human examination.

## Privacy and authority are real blockers

**V:** production auth is signed-cookie local user plus USER/EDITOR/ADMIN roles. Prototype identity/session modules, private cache helper, synthetic source descriptors and G1 public-response tests do not provide an operational private workspace. No workspace/member schema is present. Source credit, ORCID control, repository ownership declarations and publication contributors are not access grants.

**R:** initial comparisons use public/synthetic content. Follow the accepted [security architecture](../../private-workspace-security-architecture.md), [owner register](../../private-workspace-owner-decisions.md) and [execution plan](../../private-workspace-execution-plan-2026-10-21.md). Private work requires separate store/client credentials, principal/member authorization, source entitlements, read/process/export/release rights, revocation/finalization fences, public non-interference, protection/audit/backup evidence and applicable enablement. This audit neither passes G1 nor waives G2/G3 or provisional D11 conditions.

Agents must receive only what the current principal can read **and process for this purpose**. Cross-project permission does not authorize disclosure to either project. Recheck origin rights before export, model processing and release, including derived outputs. Do not introduce private rows into public tables merely to reuse a UI component.

## Agent interfaces

| Interface                        | Existing state (V)                                                                                         | Cost / usefulness (I)                                                           | Recommendation                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| REST + OpenAPI + discovery links | 138 documented JSON operations; public graph, landscape, version packets, exports, lifecycle               | Lowest incremental cost; exact bounded interoperable records                    | Primary machine interface; improve one read/compare recipe first                                            |
| Portable manifests/packets       | pinned MyST manifests, review/node declarations, publication packets; producer fixtures                    | Excellent reproducibility; producer must supply a supported representation      | Preserve exact protocols/digests; no new generic importer without fixture, pin, negative tests and rollback |
| MCP                              | No ORAtlas MCP server implementation identified in inspected app/packages                                  | Convenient for clients but adds auth, tool surface and maintenance              | Defer; later a thin adapter over reviewed REST capabilities, with identical authority                       |
| Direct connectors                | CRT/Diggypaper offline descriptor observations; no live private connector                                  | Valuable for source capture but high authorization/revocation cost per producer | Defer until demonstrated source demand and private gates; retain source ownership                           |
| Browser/session automation       | User/editor writes use same-origin checks and sessions; worker credentials are verifier/certifier-specific | Poor general external-agent write model                                         | Do not hand external clients browser cookies or reuse worker tokens as universal API keys                   |

**Important distinction:** public agent reading is available; arbitrary delegated external-agent contribution is not a general supported flow. Existing attributable submission/editorial endpoints and specialized worker APIs do not constitute broad scoped agent authorization. An MVP external client may query and return a proposal for a human to submit; authenticated unattended proposal writes require a separately scoped design.

References: [agent guide](../../../apps/web/src/app/api-docs/agents/page.tsx), [OpenAPI](../../openapi.yaml), [discussion scope](../../../apps/web/src/lib/discussion-scope.ts), [registration](../../../apps/web/src/lib/external-publication-registration.ts), [dependencies and pins](../../../CROSS_REPO_DEPENDENCIES.md), [descriptor observations](../../private-project-descriptor-observations.md).

## What stays headless or advanced

Keep verifier/certifier registration, leases, artifacts, protocol catalogs, capture receipts, production provenance, execution passports, federation inbox/outbox, preservation exports and lifecycle APIs operational. Show their findings in context; expose operator controls only to existing authorized roles. Keep formal challenges reachable from their exact subjects. Keep synthesis and replication pages as specialist tools, but defer expansion.

Avoid a broad backend rewrite. The justified obstacles are heterogeneous projections, missing generic comparison persistence/authority, private isolation and incomplete source import. Existing immutable identity and evidence semantics are assets, not clutter to remove.

## Compatibility and operational constraints

- Preserve canonical IDs, DOI distinctions, source byte captures, hashes, exact deep links, TRUST/challenge subjects and immutable history.
- Keep old human routes working; UI redirects must preserve query/version/fragment semantics. API URLs are not migrated with UI labels.
- A change to rendered public contracts or robots may need reviewed G1 recapture; this is not necessarily “frontend only” in validation effort. Follow [G1 harness](../../private-workspace-g1-harness.md).
- Bound all comparison fetches; do not trigger corpus-wide matching on page load. [Issue 248](https://github.com/dhuzard/oratlas/issues/248) reports materialization latency; [243](https://github.com/dhuzard/oratlas/issues/243) reports crawler load. These are operator reports, not benchmarks from this audit.
- Producer acceptance must use pinned emitted bytes. Local schema/unit checks do not certify cross-repository interoperability. The observed source-credit digest failure remains unresolved; see [evidence](evidence/README.md).
