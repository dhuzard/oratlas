# ORAtlas backlog — canonical tracker

This file is the **single canonical backlog** for `dhuzard/oratlas`. It supersedes `TODO.md`
(the KG-01…KG-20 backlog, fully shipped and retained as a historical record) and the PR-00…PR-10
list in `PLAN.md` (also fully shipped). Planning state lives here; governance and scientific
decision records live in `ORATLAS_DECISIONS.md`; upstream coupling lives in
`CROSS_REPO_DEPENDENCIES.md`.

ORAtlas is an immutable archive and open-review platform for AI-enriched computational reviews.
It owns submission pinning, manifest/artifact validation, immutable publication, claim/citation/
evidence ingestion, preservation of source-native assessments, ORAtlas-native assessments,
disagreement and adjudication, challenges and discussion, cross-review graphs and synthesis, and
editorial governance/provenance/security/exports. It does **not** own review generation,
literature search, MyST authoring, evidence-package generation, or the native Computational
Review TRUST methodology (see Non-goals at the end).

## Item format

Every item has a stable ID (`ORA-<workstream><nn>`) and these fields: Status, Priority, Size,
Agent (autonomous-agent suitability), Packages, External dep, Issue/PR, Goal, Scope, Non-goals,
Dependencies, Acceptance criteria.

- **Statuses:** `backlog` · `ready` · `in-progress` · `blocked` · `review` · `done` · `superseded`
- **Priorities:** `P0` security, immutability, provenance, data integrity, or misleading
  scientific representation · `P1` required for a reliable public proof of concept · `P2`
  valuable once the core workflow is stable · `P3` exploratory
- **Size:** S (≤ 1 focused PR day) · M (one substantial PR) · L (must be split or is a large PR)
- **Agent:** `yes` (an autonomous agent can complete it end-to-end) · `conditional` (agent can
  execute after a named human input) · `no` (human/governance work)

## What is already complete (do not re-open)

The following areas from the platform charter are **implemented and verified** in the current
`main`; new backlog items must not duplicate them. Evidence: `docs/development-log.md`, merged
PRs, and the cited code.

| Area                                                                                                                                                                             | Evidence                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Exact repository / release / tag-object / commit pinning; atomic inspection captures with SHA-256 payload hashes                                                                 | PR #13; `InspectionCapture`, `RepositorySnapshot` (`packages/db/prisma/schema.prisma`), `docs/data-model.md`      |
| Immutable versions, append-only lifecycle, corrections/withdrawals, safe tombstones                                                                                              | PRs #15, #16, #17; `ReviewLifecycleEvent`, `docs/article-lifecycle.md`                                            |
| Transactional acceptance (serializable compare-and-set, idempotency keys, unique constraints)                                                                                    | `IdempotencyKey`, acceptance transactions, `docs/data-model.md`                                                   |
| Source-native vs ORAtlas-native assessment separation: imports are publicly `unverified-import`; a separate hash-guarded `TrustVerification` marker fails closed on any mutation | PR #11; `docs/trust-model.md`, `TrustAssessment`/`TrustVerification`                                              |
| Original assessment unit preserved: TRUST attaches only to a claim–evidence relation (claim–citation or node-relation); no bare-node form exists                                 | `packages/trust`, `nodeRelationTrustRecordSchema`, `docs/trust-model.md`                                          |
| `not-assessed` / `not-applicable` excluded from aggregates, never counted as zero; aggregates optional, advisory, and method-labelled                                            | `packages/trust/src/index.ts` (`ordinal-mean-1.0`)                                                                |
| Knowledge nodes, typed edges, propose→confirm lifecycle, graph API/explorer                                                                                                      | KG-01…KG-10 (PRs #31–#50)                                                                                         |
| Grounded AI synthesis with editorial gate, packet hashes, staleness, diffs, coverage, governance policy, grounding-eval CI, full-pipeline e2e                                    | KG-11…KG-20 (PRs #51–#70), `docs/synthesis-*.md`                                                                  |
| Contradiction maps and evidence-independence–aware synthesis (shared-dataset awareness)                                                                                          | PR #21, `docs/synthesis-and-contradictions.md`                                                                    |
| Claim passports, lineage, citation-status evidence monitoring                                                                                                                    | PR #20, `docs/living-review.md`                                                                                   |
| Scholarly exports and COAR Notify federation                                                                                                                                     | PRs #15, #26; `packages/exports`, `packages/federation`, `docs/preservation-and-exports.md`, `docs/federation.md` |
| Execution Passports (offline-verified, `execution-attested` only), Atlas Check CI, Protocol Drift Radar, Replication Marketplace                                                 | PRs #23–#27                                                                                                       |
| SSRF-safe inspection, bounded fetches, escaped-text-only rendering, example-DOI flagging, same-origin mutation guards, audit trail, rate limits                                  | PR-03, PRs #9, #10; `packages/github`, `apps/web/src/lib/mutation-request.ts`                                     |
| Ops: Postgres portability + generated DDL, workers, observability, backup/restore, privacy/takedown                                                                              | PR #22; `docs/operations/`                                                                                        |

Charter areas listed as "required" that the table above covers (identity preservation,
non-transactional-publication prevention, source/native separation, assessment-unit
preservation, not-assessed semantics, contradiction maps, independence detection, evidence
packets, graph explorer, staleness/living review, synthesis diffs, exports/federation) get
**verification/audit items** below where confidence is warranted, not rebuild items.

---

## Recommended first tranche

At most five items, ordered. Rationale and dependencies:

1. **ORA-J01 — Security and immutable-publication audit** (P0, ready). Independent of
   everything; its findings may reprioritize the rest, so it goes first.
2. **ORA-A02 — Absent-artifact and per-facet compatibility reporting** (P0, ready). Fixes the
   remaining misleading-representation risk (empty states indistinguishable from absent
   artifacts). No dependencies; unblocks honest display for ORA-A03's fixture.
3. **ORA-A03 — Frozen Ethical Debt integration fixture** (P1, ready). First real-world review;
   exercises A02's report against genuine artifacts. Depends on choosing an exact
   release/commit pin (mechanical, recorded in `CROSS_REPO_DEPENDENCIES.md`); benefits from
   but does not hard-depend on ORA-A02.
4. **ORA-H01 — Verify source-native vs ORAtlas-native separation end-to-end** (P1, ready). The
   separation is implemented; this locks it in with e2e/regression coverage so later
   assessment work (ORA-D01/D02) cannot silently erode it. No dependencies.
5. **ORA-D01 — Multiple-assessment contract** (P1, ready). Defines coexistence of several
   assessments per relation without overwrite. Everything in workstreams D and E that involves
   disagreement, adjudication, or challenge-of-assessment builds on it. Schema already permits
   multiple rows; the contract and read semantics are the work.

---

## A — Ingestion and compatibility

### ORA-A01 — Per-facet compatibility model (article / citations / evidence-package / claim-graph / assessments)

- **Status:** backlog · **Priority:** P0 · **Size:** M · **Agent:** conditional (contract shape
  should be reviewed by a maintainer before the UI consumes it)
- **Packages:** `packages/contracts`, `packages/extractor`, `apps/web` · **External dep:**
  template structure (read-only) · **Issue/PR:** none
- **Goal:** A repository can be article-compatible yet lack a claim graph, or carry TRUST
  records without an evidence package. Today `COMPATIBILITY_LEVELS` is one structural scalar
  (`packages/contracts/src/enums.ts:28`); facet truth is buried in signals and extraction
  notes. Make compatibility a per-facet report so each capability is independently and
  honestly classified.
- **Scope:** Add a facet-compatibility structure to contracts (facets: article/prose review,
  citations/bibliography, evidence package, claim graph (claims/relations/nodes/edges),
  assessments (TRUST records)); derive it deterministically in
  `packages/extractor/src/compatibility.ts` from existing signals + artifact reports; persist
  alongside the existing scalar level (keep the scalar for back-compat); expose in the
  submission wizard, editorial view, and public review page.
- **Non-goals:** No LLM involvement (invariant); no change to the accept/reject rules
  themselves; no re-classification of already-accepted versions (their stored reports are
  immutable).
- **Dependencies:** none (ORA-A02 pairs well and can share the contract change).
- **Acceptance criteria:** Contracts tests for the facet schema; extractor unit tests proving
  determinism and each facet's rules (fixture repos: prose-only, nodes-only, claims-without-TRUST,
  full); existing scalar level unchanged for existing fixtures; `pnpm schema:check` passes; UI
  shows facet status with evidence, escaped text only.

### ORA-A02 — Report absent optional artifacts instead of empty successful features

- **Status:** ready · **Priority:** P0 · **Size:** M · **Agent:** yes
- **Packages:** `packages/extractor`, `packages/contracts`, `apps/web` · **External dep:** none
  · **Issue/PR:** none
- **Goal:** "No claims were extracted for this review" (`apps/web/src/app/reviews/[slug]/page.tsx:488`)
  currently renders identically whether the repository never declared a claims artifact, declared
  one that failed validation, or declared one that legitimately contained zero records. That
  conflation can misrepresent a review. Every optional artifact must surface one of:
  **not declared** / **declared but invalid (with reasons)** / **declared and loaded (n records,
  m skipped)**.
- **Scope:** Extend the extraction/compatibility report contracts with per-artifact
  `discovered | loaded | skipped | invalid` outcomes and record counts (line-level skip detail
  already exists in `packages/extractor/src/knowledge.ts` — lift it into the typed report);
  store in the immutable submitted payload as today; render distinct empty states on review,
  node, and claim pages and in the editorial view.
- **Non-goals:** No inference of why an author omitted an artifact; no change to acceptance
  rules; no retroactive mutation of stored reports for published versions (render "unknown —
  report predates per-artifact outcomes" for legacy rows rather than guessing).
- **Dependencies:** none. Coordinate the contract shape with ORA-A01 if both are in flight.
- **Acceptance criteria:** Unit tests for all four outcomes per artifact type (claims,
  citations, relations, TRUST, nodes, edges); e2e asserting the three empty-state renderings
  differ; legacy published versions still render without error; counts in the report equal
  rows ingested.

### ORA-A03 — Frozen Ethical Debt integration fixture

- **Status:** ready · **Priority:** P1 · **Size:** M · **Agent:** yes (pin and artifact layout
  ratified in `ORATLAS_DECISIONS.md` §13 and `CROSS_REPO_DEPENDENCIES.md`)
- **Packages:** `apps/web` (e2e fixtures), `packages/extractor` (fixtures), `scripts` ·
  **External dep:** `dhuzard/ethical-debt-AI-review` (exact release or commit) · **Issue/PR:** none
- **Goal:** The first reference review has **no presence in this repository** (zero references
  found). Freeze an exact release/commit of `dhuzard/ethical-debt-AI-review` as a
  checked-in, deterministic integration fixture proving the real production pipeline —
  inspect → extract → compatibility → submit → accept → public rendering — against a genuine
  ComputationalReviewTemplate-derived review.
- **Scope:** A capture script that snapshots the pinned tree/files into bounded, checked-in
  fixture data (respecting existing size caps); a mock-transport integration test running the
  full extractor + compatibility path; a Playwright journey reusing the KG-20 interception
  pattern with the frozen bytes; document the pin (owner, repo id, release tag, commit SHA,
  tree hash) in `CROSS_REPO_DEPENDENCIES.md`.
- **Non-goals:** Never fetch the live repo in CI (offline invariant); no cloning or code
  execution; do not "fix" the review's content — if its artifacts are partially compatible,
  the fixture must assert the honest report (this is the point).
- **Dependencies:** pin decision (above). Pairs with ORA-A02 so the fixture asserts honest
  absent-artifact reporting.
- **Acceptance criteria:** CI-green fully-offline integration + e2e run; fixture bytes hashed
  and the hash asserted; the resulting compatibility/extraction report snapshot-tested;
  updating the pin is a one-script re-capture with a reviewable diff.

### ORA-A04 — Ingest and surface template TRUST.md / FAIR.md assessment documents

- **Status:** ready · **Priority:** P2 · **Size:** M · **Agent:** yes (preservation-only
  extraction boundary ratified in `ORATLAS_DECISIONS.md` §12; upstream suggestions remain
  human communication)
- **Packages:** `packages/extractor`, `packages/contracts`, `apps/web` · **External dep:**
  `AllenNeuralDynamics/ComputationalReviewTemplate` (file conventions),
  `Neuronautix/TRUST.md` (versioned convention and schemas) · **Issue/PR:** issue #18
- **Goal:** Template repositories may carry `TRUST.md`/`FAIR.md` describing their assessment
  methodology. Detect them, preserve them as source-native provenance documents, and link them
  from the review's assessment display — without interpreting or scoring them.
- **Scope:** Deterministic detection in inspection/extraction; store as escaped, size-bounded
  source documents with field provenance; surface as "methodology declared by source" next to
  imported assessments; a short findings note (for the maintainer to relay upstream) on what
  the template files would need for structured ingestion.
- **Non-goals:** No parsing of prose into scores; no crosswalk from FAIR/TRUST prose to
  ORAtlas criteria (see ORA-D04); ORAtlas does not edit upstream files.
- **Dependencies:** none hard; semantics input from the TRUST fork (see
  `CROSS_REPO_DEPENDENCIES.md`).
- **Acceptance criteria:** Extraction tests (present/absent/oversized/unsafe-path); rendered
  escaped-only; provenance recorded; issue #18 updated with the findings note reference.

### ORA-A05 — Verify end-to-end identity preservation (repo id, release, tag object, commit, tree)

- **Status:** backlog · **Priority:** P0 · **Size:** S · **Agent:** yes
- **Packages:** `packages/db`, `packages/github`, `packages/extractor` · **External dep:** none
  · **Issue/PR:** builds on PR #13
- **Goal:** Pinning is implemented (immutable GitHub repository id, source-selection key,
  tag object, commit SHA, capture hashes). This is an audit item: confirm the **tree** identity
  is either captured or derivable for every published version, and that no path (legacy rows,
  reconciliation, node materialization) can publish content whose identity tuple is incomplete.
- **Scope:** Trace every publication path; add invariant regression tests; if tree identity is
  genuinely absent where needed, propose (not implement) the additive schema change in a
  findings note appended to this item.
- **Non-goals:** No schema change without maintainer sign-off; no re-derivation for historical
  rows beyond fail-closed behavior already in place.
- **Dependencies:** none.
- **Acceptance criteria:** A written findings note (docs/development-log.md entry) mapping each
  publication path to its identity tuple; new regression tests for any gap that is testable
  today; zero behavior change.

## B — Immutable publication and lifecycle

### ORA-B01 — Transactional-publication audit across review, node, and synthesis acceptance

- **Status:** review (integration train 1) · **Priority:** P0 · **Size:** S · **Agent:** yes
- **Packages:** `apps/web`, `packages/db` · **External dep:** none · **Issue/PR:** train 1;
  source PR #78; builds on PRs #13, #16, #17, KG-04, KG-13
- **Goal:** Acceptance paths use serializable compare-and-set, idempotency keys, and unique
  constraints. Audit that **no** acceptance path (prose review, node selection, node-edge
  confirmation, synthesis decision, lifecycle events) can leave partially-public state under
  crash, retry, or concurrent-editor interleavings.
- **Scope:** Enumerate every write path that flips something public; add concurrency/crash-
  injection tests (transaction abort mid-path, double-submit, conflicting retries with
  different payloads); verify audit events are written in the same transaction as the decision.
- **Non-goals:** No redesign of the CAS pattern; no new features.
- **Dependencies:** none. Findings feed ORA-J01.
- **Acceptance criteria:** Test suite covering each path's retry/conflict/crash matrix; any
  discovered gap gets a failing test plus a minimal fail-closed fix (fix itself is a separate
  PR if non-trivial); findings recorded in `docs/development-log.md`.

### ORA-B02 — Platform release versioning and changelog

- **Status:** review (integration train 1) · **Priority:** P2 · **Size:** S · **Agent:** yes
- **Packages:** repo root, `docs` · **External dep:** none · **Issue/PR:** train 1; source PR #93
- **Goal:** The archive asserts immutability of scholarly records, but the platform itself has
  no tagged releases or changelog, making "which code produced this record" harder to answer
  than it should be for a preservation system.
- **Scope:** Adopt tagged releases + `CHANGELOG.md`; record the platform version in new audit
  events and exports (additive field).
- **Non-goals:** No semantic-versioning ceremony beyond what provenance needs; no backfill of
  historical events.
- **Dependencies:** none.
- **Acceptance criteria:** First tagged release; changelog wired into the release flow;
  platform version present in new audit events and export metadata.

## C — Claims and evidence graph

### ORA-C01 — Cross-review same-claim proposals surfaced end-to-end

- **Status:** backlog · **Priority:** P2 · **Size:** M · **Agent:** yes
- **Packages:** `packages/knowledge`, `apps/web` · **External dep:** none · **Issue/PR:**
  builds on KG-06 (PR #38)
- **Goal:** Deterministic same-claim detection (alias + normalized-text hash) exists and emits
  proposals. Verify, and where missing complete, the loop: proposals visible in the editorial
  dashboard, confirmable/rejectable with audit, and confirmed identity visible on claim
  passports and node pages ("also asserted in …").
- **Scope:** Inspect current surfacing; fill UI/API gaps; keep confirmation editorial-only.
- **Non-goals:** No automatic merging (invariant: proposals, never merges); no LLM identity
  decisions; no cross-protocol assessment mixing on matched claims.
- **Dependencies:** none.
- **Acceptance criteria:** e2e: seeded near-identical claims in two reviews → proposal →
  editor confirms → both passports cross-link; reject leaves no public link; determinism test
  unchanged.

### ORA-C02 — Evidence-independence audit for imported claim–citation reviews

- **Status:** backlog · **Priority:** P2 · **Size:** S · **Agent:** yes
- **Packages:** `packages/knowledge` · **External dep:** none · **Issue/PR:** builds on PR #21
- **Goal:** Independence-aware synthesis and shared-dataset detection shipped for the graph
  (PR #21). Audit that legacy claim–citation reviews get the same shared-source detection
  (same DOI/dataset cited across relations) in contradiction and synthesis views, and close
  small gaps.
- **Scope:** Verify coverage; add tests; fill only deterministic-rule gaps.
- **Non-goals:** No probabilistic independence scoring (open decision — see
  `ORATLAS_DECISIONS.md` §8).
- **Dependencies:** none.
- **Acceptance criteria:** Tests demonstrating shared-source flagging on legacy-review
  evidence; docs updated if behavior was already complete (then close as verified).

## D — Assessments and TRUST

### ORA-D01 — Multiple-assessment contract (coexistence without overwrite)

- **Status:** ready · **Priority:** P1 · **Size:** M · **Agent:** yes (identity, replay,
  singleton, supersession, and ordering contract ratified in `ORATLAS_DECISIONS.md` §11)
- **Packages:** `packages/contracts`, `packages/trust`, `packages/db`, `apps/web` ·
  **External dep:** none · **Issue/PR:** none
- **Goal:** `TrustAssessment` has no uniqueness on its relation, so multiple rows can exist,
  but nothing defines their semantics: reads and displays assume effectively one assessment
  per relation. Define the contract: several assessments per relation (different assessors,
  assessor types, protocols, or times) **coexist**; none is overwritten, none silently wins;
  each keeps its own verification marker; ingestion of a newer source record never mutates an
  older row.
- **Scope:** Contract types for assessment sets per relation; deterministic, documented
  ordering for display (e.g. assessedAt + assessor, never rating-based); re-ingestion rules
  (same source record ⇒ idempotent, changed ⇒ new row with supersession pointer as source
  provenance); list rendering in review/node/editorial views showing every assessment with its
  assessor and protocol; same for `NodeRelationTrustAssessment`.
- **Non-goals:** No aggregation across assessors (blocked — `ORATLAS_DECISIONS.md` §2); no
  crosswalk between protocols (ORA-D04); no adjudication flow (ORA-D02); no ranking of
  assessors.
- **Dependencies:** none. Prerequisite for ORA-D02, ORA-D03, ORA-E01 (challenges referencing a
  specific assessment), ORA-I01.
- **Acceptance criteria:** Contract tests (coexistence, idempotent re-ingest, supersession
  provenance, per-assessment verification independence); UI shows n assessments distinctly
  with assessor + protocol provenance; no code path selects a "best" assessment; existing
  single-assessment fixtures unaffected.

### ORA-D02 — Explicit disagreement and adjudication records

- **Status:** ready · **Priority:** P1 · **Size:** L · **Agent:** yes (authority, display, and
  non-compensation boundaries ratified in `ORATLAS_DECISIONS.md` §§2–5)
- **Packages:** `packages/contracts`, `packages/trust`, `packages/db`, `apps/web` ·
  **External dep:** none · **Issue/PR:** none
- **Goal:** When two assessments of the same relation disagree, the disagreement must be a
  first-class, visible fact — never averaged away — and an adjudication must be a separate,
  attributed record referencing the assessments it weighs, with rationale.
- **Scope:** Deterministic disagreement detection **within one protocol only** (criterion-level
  rating divergence above a defined ordinal distance); disagreement badge on profiles;
  `Adjudication` record (adjudicator, role snapshot, rationale, referenced assessment ids +
  hashes, outcome) that never edits the underlying assessments; editorial queue for open
  disagreements.
- **Non-goals:** No cross-protocol disagreement computation (that requires a crosswalk —
  forbidden, ORA-D04); no auto-resolution; no hiding minority assessments after adjudication.
- **Dependencies:** ORA-D01; decisions §2, §5.
- **Acceptance criteria:** Unit tests for detection determinism and protocol-scoping;
  adjudication is append-only, hash-binds its subjects, and fails closed if a referenced
  assessment mutates; UI shows all assessments + the adjudication, never a merged value.

### ORA-D03 — Assessment profile display without a mandatory aggregate

- **Status:** backlog · **Priority:** P1 · **Size:** S · **Agent:** yes
- **Packages:** `apps/web`, `packages/ui` · **External dep:** none · **Issue/PR:** builds on
  PR-05, `docs/trust-model.md`
- **Goal:** Aggregates are already optional/advisory/method-labelled. Verify and harden the
  display contract: a criterion profile (all ten criteria with rating + status, including
  explicit `not-assessed`) renders fully and legibly when no aggregate exists, and no view
  invents, requires, or visually privileges an aggregate.
- **Scope:** Audit all TRUST renderings (review page, node view, editorial queue, claim
  passports, synthesis evidence context); regression tests asserting `not-assessed` is shown
  as such (never as 0, blank, or omitted); consistent profile component in `packages/ui` if
  drift is found.
- **Non-goals:** No new aggregate methods; no change to `ordinal-mean-1.0`.
- **Dependencies:** none; extend to multi-assessment lists once ORA-D01 lands.
- **Acceptance criteria:** e2e for an aggregate-free assessment rendering all criteria;
  regression test that a `null` aggregate never becomes a number or a bar at zero.

### ORA-D04 — Protocol-crosswalk guard: never translate between assessment protocols

- **Status:** backlog · **Priority:** P0 · **Size:** S · **Agent:** yes
- **Packages:** `packages/trust`, `packages/contracts`, `docs` · **External dep:**
  `Neuronautix/TRUST.md` and `Neuronautix/ComputationalReviewTemplate_trust-knowledge`
  (distinct protocol identities; no implicit crosswalk) · **Issue/PR:** none
- **Goal:** `protocolVersion` is stored per assessment, but nothing structurally prevents a
  future feature from comparing, averaging, or converting ratings across different protocols.
  Make "no invented crosswalk" an enforced, tested property, not just a convention.
- **Scope:** A single guard used by every comparison/aggregation entry point that refuses
  mixed-protocol inputs; contract documentation of protocol identity (name + version string
  equality, nothing fuzzier); tests that mixed-protocol aggregation/disagreement calls throw;
  `docs/trust-model.md` section. Crosswalks, if ever, are an explicit editorial artifact —
  policy parked in `ORATLAS_DECISIONS.md` §7.
- **Non-goals:** Not building any crosswalk; not blocking same-protocol version-to-version
  display side-by-side (display is not translation).
- **Dependencies:** none; ORA-D02 must consume the guard.
- **Acceptance criteria:** Guard exists with tests; grep-provable single entry point for any
  cross-assessment computation; docs updated.

## E — Challenges and discussion

### ORA-E01 — Challenge records targeting exact immutable subjects

- **Status:** ready · **Priority:** P1 · **Size:** L · **Agent:** conditional (schema and API
  are agent-suitable; the resolution-authority field defaults to editors pending
  `ORATLAS_DECISIONS.md` §5 — build with editors-resolve and keep it swappable)
- **Packages:** `packages/contracts`, `packages/db`, `apps/web` · **External dep:** none ·
  **Issue/PR:** none
- **Goal:** Today's `ReviewComment` (typed, claim-anchored, one-level replies,
  visible/removed) is discussion, not challenge. Add a formal **Challenge**: a structured,
  attributed objection targeting an exact immutable subject — a claim (version-scoped), a
  claim–evidence relation, or a specific assessment criterion instance — with a lifecycle,
  never mutating the target.
- **Scope:** `Challenge` model + contracts: subject type + immutable subject reference
  (ids **and** canonical subject hash, fail-closed like `TrustVerification`), challenger,
  grounds (typed: entailment, source-access, methodology, identity, other), body (escaped
  text, bounded), status lifecycle `open → author-responded → resolved | dismissed | withdrawn`
  (append-only transitions with audit); public listing on the subject's page; rate limits,
  same-origin, auth per existing mutation conventions.
- **Non-goals:** Challenges do not change TRUST values, compatibility, or lifecycle state of
  the target; no anonymous challenges (POC: GitHub identity); no scientific-truth ruling —
  "resolved" records an outcome note, not a verdict of correctness; moderation policy details
  beyond existing remove-semantics are `ORATLAS_DECISIONS.md` §5/§9.
- **Dependencies:** ORA-D01 (to reference a specific assessment among several).
- **Acceptance criteria:** Contract + lifecycle unit tests (all transitions, illegal ones
  rejected); subject-hash fail-closed test (target version superseded ⇒ challenge stays bound
  to the original); e2e: file → author responds → editor resolves, all audited; challenges
  visible but visually distinct from assessments and comments.

### ORA-E02 — Author responses, moderation, and resolution workflow for challenges

- **Status:** backlog · **Priority:** P1 · **Size:** M · **Agent:** conditional (same
  authority default as ORA-E01)
- **Packages:** `apps/web`, `packages/contracts`, `packages/db` · **External dep:** none ·
  **Issue/PR:** none
- **Goal:** Complete the challenge exchange: attributed author/contributor responses, editor
  moderation (remove with retained tombstone + audit, consistent with comment semantics), and
  resolution records with rationale.
- **Scope:** Response records bound to a challenge (contributor-of-record detection from
  `ReviewContributor`); moderation actions; resolution record (resolver, role snapshot,
  rationale, outcome); editorial queue tab for open challenges; notification-free POC (no
  email).
- **Non-goals:** No reputation effects; no auto-close by age; no resolution without a human.
- **Dependencies:** ORA-E01.
- **Acceptance criteria:** e2e for the full exchange incl. moderation; removed content never
  served (body empty, status visible); every transition audited.

### ORA-E03 — Keep discussion visibly separate from formal assessment

- **Status:** backlog · **Priority:** P1 · **Size:** S · **Agent:** yes
- **Packages:** `apps/web`, `packages/ui` · **External dep:** none · **Issue/PR:** none
- **Goal:** Three registers now coexist on a review: formal assessments (TRUST), formal
  challenges (ORA-E01), and open discussion (comments, Atlas Discuss). Audit and enforce that
  the UI never lets discussion visually or structurally bleed into assessment — distinct
  sections, distinct labelling, no comment content in assessment summaries or exports.
- **Scope:** UI audit + labels; exports check (comments/discussion excluded from scholarly
  exports unless explicitly a challenge-with-resolution — confirm current export behavior);
  e2e assertions.
- **Non-goals:** No removal of existing comment features.
- **Dependencies:** ORA-E01 (for the three-register final state); auditable now for two.
- **Acceptance criteria:** e2e proving section separation and labelling; export snapshot test.

### ORA-E04 — Atlas Discuss improvements

- **Status:** backlog · **Priority:** P2 · **Size:** M · **Agent:** yes
- **Packages:** `packages/knowledge`, `apps/web` · **External dep:** none · **Issue/PR:** none
- **Goal:** Incremental quality on the grounded discussion assistant: citations that deep-link
  into claim passports/node pages, answer provenance (packet hash) surfaced to readers, and
  graceful degraded mode messaging when only the deterministic composer is available.
- **Scope:** Small, verified UX/grounding improvements only; grounding validator untouched or
  strengthened.
- **Non-goals:** No relaxation of the identifier whitelist (invariant); no memory across
  threads; no autonomous actions from discussion.
- **Dependencies:** none.
- **Acceptance criteria:** Existing grounding-eval suite still green plus new fixtures for any
  changed prompt/validator surface; e2e for citation deep-links.

## F — Editorial governance

### ORA-F01 — Assessor and protocol provenance in editorial queues

- **Status:** backlog · **Priority:** P1 · **Size:** S · **Agent:** yes
- **Packages:** `apps/web` · **External dep:** none · **Issue/PR:** none
- **Goal:** Editors deciding on TRUST verification should always see who/what assessed
  (assessor type, id, protocol + version, source assertions) without expanding raw JSON.
  Verify current queue detail and close gaps, including for node-relation assessments.
- **Scope:** Queue/detail UI; no data-model change (fields exist).
- **Non-goals:** No assessor identity resolution beyond stored strings; no assessor rating.
- **Dependencies:** none; re-check after ORA-D01.
- **Acceptance criteria:** e2e asserting provenance fields visible in both queues; screenshot/
  a11y check.

### ORA-F02 — Conflict-of-interest representation

- **Status:** ready · **Priority:** P2 · **Size:** M · **Agent:** yes (public provenance,
  recusal, and audited-override contract ratified in `ORATLAS_DECISIONS.md` §6)
- **Packages:** `packages/contracts`, `packages/db`, `apps/web` · **External dep:** none ·
  **Issue/PR:** none
- **Goal:** Assessments, adjudications, and challenge resolutions carry no declared-interest
  field. Decide (governance) what COI declaration looks like, then represent it as stored,
  displayed provenance — never as an automatic disqualifier.
- **Scope (post-decision):** COI declaration fields + display.
- **Non-goals:** No COI inference; no blocking logic without governance sign-off.
- **Dependencies:** decision §6; ORA-D01.
- **Acceptance criteria:** defined post-decision.

### ORA-F03 — Editorial-data visibility audit (public vs private)

- **Status:** backlog · **Priority:** P1 · **Size:** S · **Agent:** yes
- **Packages:** `apps/web` · **External dep:** none · **Issue/PR:** none
- **Goal:** The synthesis governance work established a strict public allowlist/private
  denylist for synthesis records. Audit the same property for the rest of the editorial
  surface: submission notes, overrides, rejected/changes-requested payloads, capture bytes,
  challenge moderation rationales — verify none leak into public APIs, pages, exports, or
  JSON-LD. Boundary policy questions go to `ORATLAS_DECISIONS.md` §9.
- **Scope:** Endpoint-by-endpoint audit + leakage regression tests.
- **Non-goals:** No new visibility features.
- **Dependencies:** none; feeds ORA-J01.
- **Acceptance criteria:** Findings note; regression tests asserting private fields absent
  from every public serialization.

## G — Cross-review intelligence

### ORA-G01 — Contradiction-map coverage audit for legacy claim–citation reviews

- **Status:** backlog · **Priority:** P2 · **Size:** S · **Agent:** yes
- **Packages:** `packages/knowledge`, `apps/web` · **External dep:** none · **Issue/PR:**
  builds on PR #21
- **Goal:** Contradiction maps shipped graph-first. Verify legacy prose-review claims
  (via their optional node backlinks and link proposals) participate; document or close gaps.
- **Scope:** Audit + tests; deterministic rules only.
- **Non-goals:** No text-inference of contradiction (only typed relations count).
- **Dependencies:** none.
- **Acceptance criteria:** Test with a seeded legacy-review contradiction; docs note.

### ORA-G02 — Cross-archive claim matching beyond one ORAtlas instance

- **Status:** backlog · **Priority:** P3 · **Size:** L · **Agent:** no (needs federation
  policy and a real second instance)
- **Packages:** `packages/federation`, `packages/knowledge` · **External dep:** external
  archives · **Issue/PR:** builds on PR #26
- **Goal:** Exploratory: whether COAR Notify federation can carry same-claim proposals
  between archives with identity evidence, keeping confirmation local and editorial.
- **Scope/criteria:** design note first; no implementation before review.
- **Non-goals:** No trust import from remote archives.
- **Dependencies:** ORA-C01; federation deployment experience.

## H — Interface and accessibility

### ORA-H01 — Verify source-native vs ORAtlas-native separation end-to-end in the UI

- **Status:** ready · **Priority:** P1 · **Size:** S · **Agent:** yes
- **Packages:** `apps/web` · **External dep:** none · **Issue/PR:** builds on PR #11,
  `docs/trust-model.md`
- **Goal:** The separation (imported = `unverified-import`, platform markers separate,
  fail-closed) is implemented server-side. Lock it in at the presentation layer: every place
  an assessment appears (review page, node view, edge API consumers, claim passports,
  editorial, exports, JSON-LD) must label source assertions as source-native and never render
  an imported status with platform-verification styling; the fallback for unknown statuses
  must stay the warning path.
- **Scope:** Systematic render audit; e2e regression suite pinning the labels and the
  fail-closed fallback; shared badge component if drift is found.
- **Non-goals:** No semantic changes; presentation-lock only.
- **Dependencies:** none. Protects ORA-D01/D02 work from regressing the boundary.
- **Acceptance criteria:** e2e matrix (imported-unverified, human-reviewed marker, stale-hash
  fail-closed, unknown status) × (review, node, passport, editorial) all asserting the exact
  badge/label; axe checks pass.

### ORA-H02 — Deep-link, accessibility, and responsive audit

- **Status:** backlog · **Priority:** P1 · **Size:** M · **Agent:** yes
- **Packages:** `apps/web`, `packages/ui` · **External dep:** none · **Issue/PR:** none
- **Goal:** Claim passports gave claims stable URLs. Verify every scholarly object renders at
  a stable, documented deep link (review version, claim, citation, relation+assessment, node
  version, edge, synthesis version, challenge once ORA-E01 lands), and pass an accessibility +
  responsive sweep on the newer pages (graph explorer, synthesis reader, coverage).
- **Scope:** Link inventory in docs; missing anchors added; axe + keyboard + small-viewport
  e2e for the newer pages.
- **Non-goals:** No redesign; no URL scheme breaking changes (additive anchors only).
- **Dependencies:** none.
- **Acceptance criteria:** Documented URL inventory; e2e link-resolution suite; axe clean on
  audited pages.

## I — APIs and interoperability

### ORA-I01 — Assessment and challenge representation in exports

- **Status:** ready · **Priority:** P2 · **Size:** M · **Agent:** yes (uncollapsed assessment,
  challenge, source-native, and verification boundaries ratified in
  `ORATLAS_DECISIONS.md` §§1–2, §9, §§11–12)
- **Packages:** `packages/exports`, `packages/federation` · **External dep:** consuming
  services · **Issue/PR:** builds on PRs #15, #26
- **Goal:** Once multiple assessments (ORA-D01) and challenges (ORA-E01) exist, scholarly
  exports and COAR Notify payloads must represent them without collapsing them: every
  assessment with assessor + protocol, disagreement uncollapsed, challenges with lifecycle
  state, source-native vs platform-verified always distinguished.
- **Scope:** Export schema extension (additive); federation announcement types if applicable.
- **Non-goals:** Never export an aggregate without its method; never export imported
  assertions as verification.
- **Dependencies:** ORA-D01, ORA-E01.
- **Acceptance criteria:** Export snapshot tests incl. a disagreement case; schema documented
  in `docs/preservation-and-exports.md`.

### ORA-I02 — OpenAPI and route-parity maintenance for new surfaces

- **Status:** backlog · **Priority:** P2 · **Size:** S · **Agent:** yes
- **Packages:** `apps/web`, `docs`, `scripts` · **External dep:** none · **Issue/PR:** none
- **Goal:** `scripts/check-openapi-routes.ts` enforces parity. Standing item: every backlog
  item adding routes (D/E workstreams) updates `docs/openapi.yaml`; this item covers the sweep
  after tranche one lands.
- **Scope:** Doc sweep + parity check remains green.
- **Non-goals:** No spec-first rewrite.
- **Dependencies:** after ORA-D01/E01.
- **Acceptance criteria:** `check-openapi-routes` green; new endpoints documented with typed
  error shapes.

## J — Security and reliability

### ORA-J01 — Security and immutable-publication audit (standing P0)

- **Status:** ready · **Priority:** P0 · **Size:** M · **Agent:** yes (audit + regression
  tests; exploit-fixing PRs separately, smallest-first)
- **Packages:** all, focus `apps/web`, `packages/github`, `packages/db` · **External dep:**
  none · **Issue/PR:** builds on PRs #9, #10, #11
- **Goal:** A single sweep re-verifying, with tests, the full defensive posture:
  authorization matrix per route (role snapshots vs current role), same-origin + Fetch
  Metadata enforcement on every mutation, optimistic-concurrency coverage (every revision/CAS
  guard actually guards), input sanitization and escaped-only rendering (incl. new graph and
  synthesis surfaces), SSRF protections in `packages/github`/`packages/zenodo` (redirect,
  DNS-rebinding, IP-literal, size/timeout bounds), audit-event completeness (every state
  transition), tombstone fail-closed behavior on all read paths, and private-data leakage
  (with ORA-F03).
- **Scope:** Checklist-driven audit; a findings report in `docs/development-log.md`; a
  regression test per verified property so the posture stays pinned; `SECURITY.md` refreshed.
- **Non-goals:** No new security features beyond closing found gaps; no pen-test theater.
- **Dependencies:** none. ORA-B01 and ORA-F03 findings roll up here.
- **Acceptance criteria:** Published checklist with per-item evidence (test or code cite);
  every gap has an issue + failing test; no criticals left open at close.

### ORA-J02 — Backup/restore and disaster-recovery drill

- **Status:** review (integration train 1) · **Priority:** P2 · **Size:** S · **Agent:** yes
- **Packages:** `scripts`, `docs/operations` · **External dep:** none · **Issue/PR:** train 1;
  source PR #82; builds on `scripts/backup.ts`/`restore.ts`
- **Goal:** Scripts and docs exist; prove them. A CI job that backs up a seeded database,
  destroys it, restores, and byte-compares public API output before/after.
- **Scope:** Drill job (SQLite now, Postgres with ORA-K01); document RPO/RTO expectations.
- **Non-goals:** No production infra automation.
- **Dependencies:** none; extend under ORA-K01.
- **Acceptance criteria:** CI drill green; divergence fails the job.

### ORA-J03 — Abuse controls for public-write surfaces (challenges, comments)

- **Status:** backlog · **Priority:** P2 · **Size:** S · **Agent:** yes
- **Packages:** `apps/web` · **External dep:** none · **Issue/PR:** none
- **Goal:** Challenges (ORA-E01) add a new authenticated public-write surface. Extend the
  existing rate-limit/body-bound conventions with per-subject caps and duplicate-challenge
  detection (same challenger, same subject hash, open state ⇒ reject with typed error).
- **Scope:** Limits + tests; consistent with existing comment limits.
- **Non-goals:** No CAPTCHA/heuristics; no shadow-banning.
- **Dependencies:** ORA-E01.
- **Acceptance criteria:** Limit tests; duplicate rejection test; audit on limit rejections
  not required (noise).

## K — Testing and developer experience

### ORA-K01 — Postgres CI matrix

- **Status:** review (integration train 1) · **Priority:** P1 · **Size:** M · **Agent:** yes
- **Packages:** `.github`, `packages/db` · **External dep:** none · **Issue/PR:** train 1;
  source PR #79; builds on PR #22
- **Goal:** CI's existing `postgres` job already proves schema generation, push, and seed
  against a real Postgres 16 service on every PR. The remaining gap: the unit/integration
  test suite — in particular the serialization-sensitive acceptance-transaction tests — still
  runs on SQLite only. Run those suites against Postgres in CI.
- **Scope:** Extend the existing `postgres` job (or a sibling) with test execution; test
  bootstrap against `DATABASE_URL`; document divergence policy (SQLite dev remains supported).
- **Non-goals:** No dropping SQLite for dev; no migration of dev workflow.
- **Dependencies:** none; unblocks stronger ORA-B01 concurrency tests.
- **Acceptance criteria:** Green Postgres job in `ci.yml`; serializable-transaction tests run
  on Postgres; wall-time budget documented.

### ORA-K02 — Fixture-capture tooling for frozen external repositories

- **Status:** review (integration train 1) · **Priority:** P1 · **Size:** S · **Agent:** yes
- **Packages:** `scripts`, test fixtures · **External dep:** any pinned external repo ·
  **Issue/PR:** train 1; source PR #77; generalizes the KG-20 interception pattern
- **Goal:** ORA-A03 needs to freeze a real repository deterministically; future reference
  reviews will too. Provide one reusable capture script: given `owner/repo` + commit/release,
  fetch the bounded file set the inspector would read, write hashed fixture bytes, and emit
  the mock-transport wiring.
- **Scope:** Capture script (runs locally, never in CI), fixture format doc, hash manifest.
- **Non-goals:** No live-network tests; no full-tree mirroring (bounded set only, matching
  inspector caps).
- **Dependencies:** none; ORA-A03 consumes it (can be built inside ORA-A03 and extracted).
- **Acceptance criteria:** Re-running the script against the same pin is byte-identical;
  fixture hash manifest asserted in tests.

### ORA-K03 — E2E wall-time and flake budget

- **Status:** review (integration train 1) · **Priority:** P2 · **Size:** S · **Agent:** yes
- **Packages:** `apps/web`, `.github` · **External dep:** none · **Issue/PR:** train 1; source PR #83
- **Goal:** The Playwright surface has grown (KG-20 journey + suites). Measure wall time,
  set a budget, deduplicate overlapping journeys, and track flakes before they normalize.
- **Scope:** Timing report; seed reuse; retire redundant specs only with coverage proof.
- **Non-goals:** No coverage reduction for invariants.
- **Dependencies:** none.
- **Acceptance criteria:** Documented budget in CI; no invariant e2e removed without an
  equivalent assertion elsewhere.

## L — Documentation and releases

### ORA-L01 — Reconcile planning and status documentation with implementation

- **Status:** review (integration train 1) · **Priority:** P1 · **Size:** S · **Agent:** yes
- **Packages:** repo root, `docs` · **External dep:** none · **Issue/PR:** train 1; source PR #88
- **Goal:** `PLAN.md` still frames KG-01…KG-20 as "the next phase"; `TODO.md` is a completed
  tracker that reads as active; README should point newcomers at the current model and this
  backlog. Bring the narrative docs in line with shipped reality and this file (partially done
  by the commit introducing this backlog: `TODO.md` now carries a superseded banner).
- **Scope:** PLAN.md status note; README pointer; `docs/development-log.md` entry; sweep for
  "planned"/"future" wording that shipped (e.g. living-review automation scope notes vs
  issue references #3/#7 that live outside this repo's issue tracker — verify and fix or
  annotate).
- **Non-goals:** No rewriting of history; logs stay append-only.
- **Dependencies:** none.
- **Acceptance criteria:** No planning doc contradicts implemented behavior; cross-references
  resolve; this backlog linked from README and PLAN.
- **Note (found during backlog audit):** `docs/living-review.md` cites issues #3 and #7 and
  KG-era docs cite issue numbers (#56, #60, #66) that do not match the repository's visible
  issue tracker (only #18 is open; most numbers are PRs). Verify whether these were issues
  later converted/closed or numbering drift, and annotate.

### ORA-L02 — Contributor guide for this backlog and agent workflow

- **Status:** review (integration train 1) · **Priority:** P2 · **Size:** S · **Agent:** yes
- **Packages:** repo root · **External dep:** none · **Issue/PR:** train 1; source PR #81
- **Goal:** CONTRIBUTING.md predates this tracker. Add the ORA-scoped commit and integration-train
  workflow, status field updates, verification bar, and agent rules below so human and agent
  contributors follow the same loop.
- **Scope:** CONTRIBUTING.md section; link from README.
- **Non-goals:** No process beyond what this file defines.
- **Dependencies:** none.
- **Acceptance criteria:** CONTRIBUTING.md documents the loop; verification-bar commands match
  CLAUDE.md.

### ORA-L03 — Resolve open governance and scientific decisions

- **Status:** review (decision slate ratified 2026-07-22; dependent implementation now
  unblocked) · **Priority:** P1 · **Size:** M · **Agent:** no
- **Packages:** `docs` · **External dep:** `Neuronautix/TRUST.md` for protocol-semantics
  questions · **Issue/PR:** integration train
- **Goal:** Several backlog items (ORA-D02, ORA-F02, parts of ORA-E01/E02) are blocked on the
  questions in `ORATLAS_DECISIONS.md`. Decisions are made by the maintainer/editorial group,
  recorded there with rationale and date, and unblock items here.
- **Scope:** Decision records only; each resolved decision flips the dependent items'
  statuses in this file.
- **Non-goals:** Agents must not resolve these by implementation default beyond the explicitly
  named safe defaults (e.g. ORA-E01 "editors resolve, swappable").
- **Dependencies:** none.
- **Acceptance criteria:** Each decision recorded with rationale; dependent items unblocked
  explicitly.

---

## Rules for autonomous agents

1. **Code in ORA-scoped commits; review in integration trains.** Keep one backlog item per
   commit series and prefix commits with the item ID, but group 5–10 related items into one
   outcome-based integration branch and PR. `INTEGRATION_TRAINS.md` is the canonical mapping.
   Do not open an item-level PR unless isolation is required for an urgent security fix.
2. **Never weaken immutability, provenance, or fail-closed behavior.** If a test gets in your
   way, the test is probably the specification.
3. **Do not alter scientific semantics incidentally.** A refactor that changes what a rating,
   status, relation, or badge means is out of scope for any item that doesn't name it.
4. **Never invent a crosswalk between assessment protocols** (see ORA-D04). Mixed-protocol
   computation is a bug, not a feature request.
5. **Never promote imported assertions to platform verification.** Public state of any import
   is `unverified-import` until a platform-owned, hash-valid marker says otherwise.
6. **Never mutate an accepted review version, node version, or synthesis version.** New facts
   are new records.
7. **Preserve historical records and hashes.** Migrations are additive; reconciliation aborts
   on ambiguity rather than choosing a scholarly record.
8. **Add tests for contracts, migrations, permissions, and public behavior** in every ORA
   commit that touches them. Every integration train runs the complete verification bar:
   `pnpm lint && pnpm typecheck && pnpm test && pnpm schema:check`, plus
   `pnpm --filter @oratlas/web build`, plus e2e when `apps/web` changes.
9. **Use frozen fixtures for deterministic tests.** No live network in CI, ever.
10. **Mark work `blocked` when governance or scientific judgment is required** and record the
    question in `ORATLAS_DECISIONS.md` instead of deciding it in code.
11. **Prefer small, reversible commits inside bounded trains.** Preserve a green state after
    each ORA commit where practical. Keep at most two integration PRs under active human
    review and use independent semantic and security reviews before requesting approval.
12. **Update this backlog with the integration PR reference** on completion
    (`done (integration PR #N)`), while the train manifest preserves source-PR and commit
    provenance.

## Non-goals (platform charter — binding for every item)

ORAtlas must **not**:

- Determine scientific truth, or present archive acceptance as peer review.
- Rank authors, journals, laboratories, or institutions.
- Use citation counts or p-values as direct trust measures.
- Treat agent consensus as validation.
- Hide disagreement behind an average, or convert missing assessment into a low score.
- Translate assessment protocols silently.
- Mutate accepted reviews, or let discussion alter archived source material.
- Publish AI synthesis without the human editorial gate.
- Duplicate review-generation, MyST authoring, evidence-package generation, or native
  Computational Review TRUST methodology code owned by the upstream repositories (see
  `CROSS_REPO_DEPENDENCIES.md`).
