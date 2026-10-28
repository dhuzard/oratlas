# Prioritized simplification roadmap

Design only. No tasks below have been implemented or filed as new issues. All are R, grounded in the V findings cited; expected benefits are H. Complexity is relative engineering effort, not an estimate or delivery promise. Existing owner/security decisions remain in force.

## Sequence and review gates

```text
Review positioning + scientific wording decisions
  → P0-1 scientific interpretation corrections
  → P0-2 access/entry repair
  → P0-3 exact comparison fixture
  → P0-4 bounded claim-pair view
  → P0-5 reuse + first-session study
  → P1 navigation / Sources / import / editorial consolidation
  → P2 durable work, authorized contributions, private workflows if justified
  → P3 optional formats, visualizations and publishing expansion
```

First five concrete implementation tasks are P0-1 through P0-5. They deliver a complete public comparison outcome rather than a platform-wide refactor. Review the proposed change to [UI_UX_RULES](../../../UI_UX_RULES.md) before replacing its navigation/visual-first requirements; this audit is not an approved replacement contract. No permission is needed to finish the audit itself.

## P0 — essential clarity and first outcome

### P0-1 — correct unsupported scientific conclusions

- **Problem / V:** claim passports render computed “independent families”; disagreement UI calls deterministic candidates “Genuine contradiction”; home can call a publication “verified” based only on run presence. This conflicts with the intended distinctions and, for independence, [decision §8](../../../ORATLAS_DECISIONS.md).
- **Change / benefit H:** show declared source-overlap groups, candidate disagreements and named check outcomes. Readers can inspect what was actually measured without mistaking structure for scientific authority.
- **Files:** `apps/web/src/app/claims/[versionId]/[localClaimId]/page.tsx`, `app/synthesis/page.tsx`, `app/page.tsx`; `packages/knowledge/src/synthesis.ts`, `replication.ts`; downstream assessment/replication presentations. [Architecture analysis](07-architecture-impact.md).
- **Backend:** initial presentation correction can preserve fields/calculation; inventory API and derived-output semantics before any explicit versioned correction. **Complexity:** M. **Dependencies:** governance definitions already exist; reviewed migration if machine semantics change.
- **Risks:** merely renaming a score could retain the unsupported implication; historical outputs must not be rewritten.
- **Acceptance / validation:** paired fixture shows shared-work/dataset facts and missing metadata, never inferred independence; unmatched declared scope is not labeled established contradiction; completed/failed/pending check examples display exact outcomes. Review text against governance and inspect relevant public outputs; preserve existing IDs/wire fields.

### P0-2 — repair Explore entry and keyboard semantics

- **Problem / V:** two topic forms and one serious axe violation in the interactive SVG; [observations](evidence/README.md).
- **Change / benefit H:** one topic input, explicit result coverage, worked-example empty state and clear-filters recovery; fix SVG/list semantics. Lower entry effort with reliable keyboard access.
- **Files:** `app/explore/page.tsx`, `components/ExplorationIntent.tsx`, `components/KnowledgeLandscape.tsx`, `apps/web/e2e/explore-frontend.spec.ts`, `accessibility.spec.ts`.
- **Backend:** none for entry/accessibility. **Complexity:** S–M. **Dependencies:** P0-1 wording; current query semantics preserved.
- **Risks:** losing filter/known/focus state; treating hidden graph as fixed accessibility.
- **Acceptance / validation:** one intent submission; retained query after no match; current graph query links still work; no serious/critical axe violations on scoped Explore, full keyboard focus/return and 390px/200% zoom checks. Targeted browser regression, no redundant broad refactor tests.

### P0-3 — prepare an honest exact-pair demonstration

- **Problem / V:** default seed's flagship publication has no completed check/certification outcome; comparison defaults are review-level.
- **Change / benefit H:** select existing public/synthetic claims with exact sources and a useful scope difference; present one fixture-driven comparison from home. First value is inspectable without import/login.
- **Files:** `app/page.tsx`, existing `packages/db/src/seed/` fixtures, claim/graph service tests; supporting fixture description under `docs/`.
- **Backend:** no new schema. Use existing captured records; any added fixture stays synthetic and explicit. **Complexity:** S. **Dependencies:** P0-1, selected tuple availability.
- **Risks:** hand-picked success only; pretending missing evidence is present; stale hard-coded database-generated IDs.
- **Acceptance / validation:** stable fixture resolution to exact versions; known context/evidence and unknown fields visible; fallback when unavailable; fixture includes a tempting false match and same-source repetition. Do not alter pinned producer bytes to fit the demo.

### P0-4 — implement one bounded claim comparison

- **Problem / V:** `/compare` compares review coverage; legacy claim index does not cover all external occurrences.
- **Change / benefit H:** exact A/B tuple selection with assertion, scope, provenance, evidence and current recorded relation status. A researcher can explain a difference in one place.
- **Files:** `app/compare/page.tsx`, `lib/review-comparison.ts`, `lib/canonical-graph-query.ts`, `lib/claim-monitoring.ts`, `lib/publication-version-packet.ts`, existing source/evidence components; a narrowly scoped comparison read module if needed.
- **Backend:** application read composition, no new database or API contract for the first server-rendered slice. **Complexity:** M. **Dependencies:** P0-3; explicit supported source-kind matrix.
- **Risks:** mixing current and exact versions; leaking withheld content; silently substituting legacy/global search for missing evidence; treating relationship suggestion as confirmation.
- **Acceptance / validation:** two exact occurrences survive refresh/back; source/evidence drill-down works; unknown scope/no evidence is explicit; no automatic merge; same-source evidence is not counted twice as corroboration. Meaningful fixture tests cover exact-versus-latest, tombstone, absent binding, external occurrence, same text/different scope, and legacy query compatibility. Browser flow uses no model key.

### P0-5 — complete reuse and test the vertical slice

- **Problem / I:** inspection alone may not produce a reusable result or a reason to return.
- **Change / benefit H:** copy exact pair URL and source references with existing relationship status and limitations; link back to exact records. Test against current workflow with representative users.
- **Files:** comparison UI, `lib/hypermedia-links.ts`, `lib/public-discovery.ts`, existing export helpers; [evaluation protocol](../../first-time-exploration-evaluation.md) as a separate comparison study rather than overwriting its results.
- **Backend:** none for copy/link; do not advertise saved judgments. **Complexity:** S–M. **Dependencies:** P0-4.
- **Risks:** copied references hide withdrawal, omit source type or imply a stable link stores a personal conclusion.
- **Acceptance / validation:** another browser opens the same exact pair; lifecycle rechecked; clipboard failure has manual-copy fallback; both provenance views reachable; researcher explains what is known/unknown. Run [09](09-validation-plan.md); predeclare go/revise/stop decision rules and publish no invented outcomes.

## P1 — consolidation after the outcome works

### P1-1 — align navigation, labels and normative product contract

- **Problem / V:** runtime header, README and normative UI rules disagree; Discuss is a detour.
- **Change / benefit H:** Find claims / Compare / Sources; developer/editor/account utilities; contextual checks and Q&A. One task vocabulary across entry points.
- **Files:** `app/layout.tsx`, `components/SpecialistTools.tsx`, breadcrumbs, home and docs; `UI_UX_RULES.md`, `docs/product-experience.md`, README after product review.
- **Backend:** none. **Complexity:** S, validation M. **Dependencies:** P0 study and product decision.
- **Risks:** breaking discoverability for existing operators or public snapshot expectations.
- **Acceptance / validation:** [route map](05-information-architecture.md) preserved; exact links/anchors/query state pass; developer API access remains visible; reviewed G1 public-contract recapture where required. Reversible composition switch; no API redirects.

### P1-2 — unify source/claim presentation without hiding coverage gaps

- **Problem / V:** review, external publication, node and occurrence pages repeat context but use different read models; `/claims` and `/publications` are not one catalog.
- **Change / benefit H:** shared kind-aware source/claim detail patterns and explicit Sources tabs; later bounded cross-source discovery only when needed.
- **Files:** `app/publications/`, `app/archive/`, `app/nodes/`, `app/claims/`, `app/graph/occurrences/`, `lib/archive-search.ts`, `lib/index-builder.ts`, `lib/canonical-graph-query.ts`.
- **Backend:** none for tabs/layout; M for a bounded generic search projection, requiring separate contract review if exposed externally. **Complexity:** M. **Dependencies:** P0-4 source-kind adapter and P1-1.
- **Risks:** duplicate versions masquerading as distinct studies; incomplete “all sources”; aliases changing stable identity.
- **Acceptance / validation:** each source kind accurately identifies origin and exact version; counts reflect bounded coverage; no hidden latest-version substitution; schema/API identities unchanged. Test one legacy and one pinned external source plus lifecycle denial.

### P1-3 — simplify supported-source import and recovery

- **Problem / V:** six steps and separate GitHub/manifest paths; connect page is a guide, not import.
- **Change / benefit H:** three visible goals, type-specific routing, required corrections first, durable success/next-step message. Own-source users understand what is supported and what happens after submission.
- **Files:** `app/submit/SubmitWizard.tsx`, `app/connect/page.tsx`, `lib/inspection-captures.ts`, `lib/submission-creation.ts`, editorial registration handler.
- **Backend:** none for GitHub composition; editor MyST form can call current API; persistent import jobs/drafts are separate work. **Complexity:** M. **Dependencies:** P1-2 and user evidence of source demand.
- **Risks:** conflating capture, graph materialization and publication; reinspection changes source; accidental unsupported private import.
- **Acceptance / validation:** supported URL/version completes inspect→submit→editorial outcome on fixture; expired capability/invalid metadata/rate limit/unsupported format recover without changing source or bypassing validation. No claim of arbitrary PDF/chat extraction.

### P1-4 — put review actions in context, editorial work in queues

- **Problem / V:** editorial page spans many unrelated workflows; ordinary readers cannot tell informal discussion from formal review.
- **Change / benefit H:** task-filtered editorial queue with exact comparison context; separate comment, challenge, relationship proposal and adjudication actions.
- **Files:** `app/editorial/page.tsx`, proposal/challenge/TRUST panels, `lib/node-identity-lifecycle.ts`, `lib/node-edge-lifecycle.ts`, `lib/challenge-authorization.ts`.
- **Backend:** none for composition; team-review authority explicitly excluded. **Complexity:** M. **Dependencies:** P0-4, role/subject matrix.
- **Risks:** widening authorization through shared UI; suppressing disagreement/history; lost concurrent decisions.
- **Acceptance / validation:** current authorized actors retain their actions; unauthorized/recused actors denied; stale revision shows conflict; source assertion/proposal/confirmed relation distinguishable. Role-specific integration tests plus queue task study.

## P2 — reinforce proven use

### P2-1 — durable comparisons and bounded agent contribution

- **Problem / I:** copy/link alone may not support team continuity; generic external agent writes lack delegated authority.
- **Change / benefit H:** only if repeated use justifies it, add a minimal versioned comparison/decision record and scoped proposal-write API with human review. Provide read/inspect/reuse REST examples first.
- **Files:** `packages/contracts/src/`, `lib/canonical-graph-query.ts`, `lib/node-edge-lifecycle.ts`, `lib/agent` only if a focused module is justified, OpenAPI/docs; an additive persistence migration only after review.
- **Backend:** yes for durable user-owned decisions and delegated writes; not required for read-only examples. **Complexity:** L. **Dependencies:** observed retention, explicit authority/ownership/retention design; private G2/G3 if any private content.
- **Risks:** duplicate event systems, universal agent credentials, implicit confirmation and source-version drift.
- **Acceptance / validation:** exact scoped record replay; attributable idempotent proposal submission; no confirmation permission; concurrent change/revocation denied; old clients unchanged. Contract/negative auth tests and external-client replay. MCP follows a proven API, not vice versa.

### P2-2 — private projects and producer connectors under existing gates

- **Problem / V:** team/private scenarios exceed shipped storage and auth; descriptors are offline observations.
- **Change / benefit H:** continue the existing [201 program](https://github.com/dhuzard/oratlas/issues/201), with separate private authority and source entitlements, if comparison demand merits it. Secure own-source work, not a generic project manager.
- **Files:** private-workspace ADR/plans, identity/session adapters, `lib/private/`, future separate private store; source-credit/descriptor contracts and producer fixtures.
- **Backend:** substantial, separate from navigation simplification. **Complexity:** L. **Dependencies:** independently reviewed G1, applicable G2/G3 and later gates, D11/hosted conditions, source-owner grants; existing approvals are not re-requested.
- **Risks:** cross-project existence leakage, derived-output leakage, revoked caches, mistaking ORCID/credit for authority.
- **Acceptance / validation:** A-only/B-only/A+B/anonymous matrices, denied inference, read/process/export/release separation, concurrent revocation/finalization, no public projection leakage, exact producer pins/negative tests/rollback. Use existing gate evidence, not an audit checkbox.

### P2-3 — make return visits useful and operations bounded

- **Problem / V/I:** lifecycle/monitoring exists but no generic saved-comparison follow-up; reported crawler/materialization costs constrain scaling.
- **Change / benefit H:** show changes relevant to the selected comparison; optimize demonstrated read/write hot paths; use existing lifecycle API before adding new synchronization infrastructure.
- **Files:** `lib/claim-monitoring.ts`, lifecycle feed, `lib/index-builder.ts`, `packages/db/src/canonical-graph-materialization.ts`, `app/robots.ts`; existing issues [178](https://github.com/dhuzard/oratlas/issues/178), [243](https://github.com/dhuzard/oratlas/issues/243), [248](https://github.com/dhuzard/oratlas/issues/248).
- **Backend:** measured caching/batching and, later, versioned change feed; no new service by default. **Complexity:** M–L. **Dependencies:** observed repeated-use job and protected visibility/invalidation rules.
- **Risks:** stale permissions/withdrawals, changing graph output while batching, unbounded URL combinations.
- **Acceptance / validation:** lifecycle changes visible without stale content; benchmark declared corpus/limits; byte-identical canonical output after optimization; reviewed robots/G1 changes. Operator incidents remain separate from UX success metrics.

## P3 — optional or deferred

### P3-1 — expansion only after demonstrated demand

- **Problem / I:** new formats, autonomous extraction, graph personalization, replication marketplace and synthesis expansion compete with the unproven core outcome.
- **Change / benefit H:** freeze new user-facing expansion; maintain existing endpoints/records. Evaluate JATS/Quarto, arbitrary chat/PDF import, embeddings, MCP, personal recommendations or additional certification protocols one at a time against a measured task failure.
- **Files:** `packages/publications/`, `packages/knowledge/`, extraction contracts, `app/connect/`, synthesis/replication/verification features.
- **Backend:** none to defer; each later integration needs explicit contract fixture, source pin, negative tests and rollback. **Complexity:** variable/L. **Dependencies:** core activation/retention evidence and producer/authority readiness.
- **Risks:** preserving maintenance burden indefinitely; prematurely removing capabilities used by operators.
- **Acceptance / validation:** no unsupported capability promoted as live; existing data/API still readable; investment case identifies user, frequency, input contract and cheaper alternative. Usage/support evidence is required before actual deprecation/removal.

## Migration rules across all slices

Never merge occurrences by text, change canonical IDs, reinterpret pinned schemas, rewrite historical assessments or delete original content to simplify a screen. Keep review and generic-publication storage adapters; share presentation. Retain old route/query/fragment behavior and API discovery. For a later additive schema, use the established expand/backfill/contract discipline and explicit rollback, not an incidental UX migration.

Before release, run the relevant route/role/lifecycle checks plus repository-required lint/typecheck/tests/schema/OpenAPI/agent checks; record failures and separately pinned producer acceptance. Review public snapshot deltas using the G1 harness where required. A label-only implementation can still affect protected public contracts. Roll back UI via composition/visibility switch; any new records stay interpretable and old APIs remain supported.
