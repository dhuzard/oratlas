# Agent backlog — node-first publication & AI-written reviews

This is the machine-consumable todo list for the autonomous agent team (auto-issue and PR
loops). It describes the work needed to evolve Open Review Atlas from a repo-based review
archive (PLAN.md, all PR-00…PR-10 slices shipped) toward the target model:

> Experimental and theoretical labs publish **nodes in a knowledge graph** — claims, figures,
> datasets, code — instead of crafting long prose papers. **AI writes regular long-form
> reviews** of the state of knowledge and data. **Humans consume research knowledge mostly
> through those reviews.**

## How the agent loop must use this file

1. **One item = one GitHub issue = one PR.** Use the item's `id` as the issue/PR title prefix
   (e.g. `KG-02: Knowledge-node data model`). Copy the item's full body into the issue.
2. **Respect `depends_on`.** Do not open a PR for an item whose dependencies are not merged.
   Items with no unmet dependencies are claimable in parallel.
3. **Never violate the repository invariants** in `CLAUDE.md`. In particular:
   - Version DOI and concept DOI stay distinct fields end to end.
   - Structural compatibility and identity matching are deterministic, never an LLM decision.
   - TRUST attaches to a claim–citation relation; aggregates are optional and carry their method.
   - All repository content is untrusted: escaped text only, no raw HTML, no code execution,
     no clone. Example identifiers (`10.5555/…`) are flagged and never linked.
   - LLM output is Zod-validated and rejected if it cites identifiers absent from its packet.
   - **Publication always passes the human editorial gate.** AI drafts and proposes; it never
     autonomously publishes. This applies to synthesis reviews exactly as it does to
     submissions today.
4. **Verification bar for every PR:**
   `pnpm lint && pnpm typecheck && pnpm test && pnpm schema:check` must pass, plus
   `pnpm --filter @oratlas/web build`, plus `pnpm --filter @oratlas/web test:e2e` when the item
   touches `apps/web`. New behavior needs unit tests; new user flows need an e2e spec.
5. **Keep the layering.** Domain logic in `packages/*` (framework-free, no Prisma/React);
   schemas/types in `@oratlas/contracts` first; persistence via `packages/db`; UI/API in
   `apps/web`. Keep the Prisma schema Postgres-portable (String enums, `…Json` columns).
6. When an item changes scope during implementation, update this file in the same PR and note
   the change in `docs/development-log.md`.

## Status legend

`todo` → `in-progress (issue #N)` → `done (PR #N)`. Agents update the `status` field in place.

## Milestones

- **M1 — Node-first publication** (KG-01…KG-05): nodes are first-class, versioned, publishable.
- **M2 — Knowledge graph** (KG-06…KG-10): typed cross-lab edges, identity, query, browsing.
- **M3 — AI review synthesis** (KG-11…KG-14): grounded long-form reviews generated from the graph.
- **M4 — Human consumption** (KG-15…KG-17): reading, diffing, freshness, discovery.
- **M5 — Governance & evaluation** (KG-18…KG-20): policy, grounding evals, end-to-end CI.

---

## Epic A — Node-first publication model (M1)

The unit of publication today is a `ReviewVersion` extracted from a whole repository; claims and
citations exist only as its children. This epic makes individual knowledge nodes — claim,
figure, dataset, code — first-class, versioned, immutable publication objects.

### KG-01 — Contracts: knowledge-node schemas

```yaml
id: KG-01
epic: A
status: done (PR #31)
depends_on: []
size: M
labels: [contracts, schema]
packages: [packages/contracts]
```

**Why.** Everything downstream (DB, extractor, UI, synthesis) validates against contracts;
contracts has no dependencies, so it goes first.

**Scope.**

- Zod schemas + TS types for `KnowledgeNode` with `kind: claim | figure | dataset | code`,
  shared envelope (stable node id, title, abstract/text, contributors, license, provenance,
  optional version DOI + concept DOI as distinct fields), and kind-specific payloads
  (claim statement + qualifiers; figure artifact path + caption; dataset format/size/DOI;
  code entry points/language/release ref).
- A `node-manifest` JSON Schema (sibling of `review-manifest.schema.json`) describing how a
  repository declares its nodes (e.g. `nodes/*.json` or a `nodes.jsonl`), reusing the existing
  artifact-path safety rules (no traversal, bounded size).
- Typed edge schema: `NodeEdge` with `relationType: supports | contradicts | replicates |
extends | uses-dataset | uses-code | derives-from`, provenance (`asserted-by-author`,
  `proposed-by-agent`, `confirmed-by-editor`), and status lifecycle.

**Acceptance criteria.**

- Schemas exported from `@oratlas/contracts` with unit tests covering valid/invalid payloads,
  path-safety rejection, and DOI field distinctness.
- `pnpm schema:check` validates the new JSON Schema and a reference example.
- No dependency added to contracts.

### KG-02 — DB: knowledge-node data model

```yaml
id: KG-02
epic: A
status: done (PR #34)
depends_on: [KG-01]
size: M
labels: [db, prisma]
packages: [packages/db]
```

**Scope.**

- Prisma models: `KnowledgeNode` (concept identity, kind, owning lab/repository),
  `KnowledgeNodeVersion` (immutable content snapshot bound to a `RepositorySnapshot` and
  commit SHA, distinct `versionDoi`/`conceptDoi`, `isExample`), `NodeEdge`
  (`(sourceNodeVersionId, targetNodeId, relationType)` unique, status + provenance columns),
  and back-links from existing `Claim` rows to node identities (nullable FK; no destructive
  migration of existing data).
- Seed: a small cross-lab graph — two labs, ≥6 nodes covering all four kinds, edges including
  one `contradicts` and one `replicates`, one example-DOI node.

**Acceptance criteria.**

- String enums validated by contracts, JSON payloads as `…Json` columns, Postgres-portable.
- `db:push` + `db:seed` + `db:reset` work; existing seed and all existing tests still pass.
- Data-model doc table in `docs/data-model.md` extended.

### KG-03 — Extractor: node extraction from repositories

```yaml
id: KG-03
epic: A
status: done (PR #35)
depends_on: [KG-01]
size: M
labels: [extractor]
packages: [packages/extractor, packages/github]
```

**Scope.**

- Deterministic extraction of node manifests from an inspected repository (bounded fetch via
  the existing `GithubTransport`, size caps, no clone), with field-level provenance like the
  existing metadata extraction.
- Figure/dataset/code nodes reference in-repo artifact paths (validated) or DOIs (validated by
  `packages/zenodo` rules); never fetch or execute artifact content.
- Structured extraction report: per-node status (`ok | invalid | skipped`) with reasons —
  errors vs warnings, mirroring the compatibility-report style.

**Acceptance criteria.**

- Unit tests with a mock transport: happy path, malformed manifest, unsafe path, oversized
  file, example DOI flagged.
- Extraction is pure/deterministic (same inputs → same report).

### KG-04 — Node submission and editorial acceptance

```yaml
id: KG-04
epic: A
status: done (PR #39)
depends_on: [KG-02, KG-03]
size: L
labels: [web, editorial, api]
packages: [apps/web, packages/db]
```

**Scope.**

- Extend the submission flow so an inspected repository that declares nodes produces node
  candidates alongside (or instead of) a prose review: wizard step showing extracted nodes with
  per-field provenance, included in the immutable `submittedPayloadJson`.
- Editorial dashboard shows node candidates; acceptance materializes immutable
  `KnowledgeNodeVersion` rows bound to the capture, with the same idempotent
  compare-and-set transaction pattern and audit events as review acceptance.
- API routes with the existing conventions: typed structured errors, rate limits, body-size
  limits, server-side role checks.

**Acceptance criteria.**

- E2e: submit a node-bearing repo (mock auth) → editor accepts → nodes visible publicly.
- Rejected/changed-requested submissions leave no public nodes; audit log records the decision.
- Re-acceptance of the same selection is idempotent (unique constraints, no duplicates).

### KG-05 — Node pages: public UI + API

```yaml
id: KG-05
epic: A
status: done (PR #43)
depends_on: [KG-04]
size: M
labels: [web, ui]
packages: [apps/web, packages/ui, packages/contracts]
```

> Package-scope note: `packages/contracts` is required for the public node list/detail/history
> query and response contracts shared by the API, UI query layer, and OpenAPI documentation.

**Scope.**

- `nodes/[id]` public page per node: kind badge, content (escaped text only), version history,
  provenance panel, DOI links (example DOIs marked, never linked), owning repository/lab,
  incoming/outgoing edges, attached TRUST context.
- Archive/search integration: nodes discoverable next to reviews, filterable by kind.
- Schema.org JSON-LD for nodes (Dataset/SoftwareSourceCode/CreativeWork as appropriate).

**Acceptance criteria.**

- E2e covering a claim node and a dataset node page, edge display, and example-DOI marking.
- Lighthouse/axe-level accessibility parity with existing pages (labels, landmarks, contrast).

---

## Epic B — Knowledge graph across labs (M2)

### KG-06 — Cross-lab claim identity and deduplication

```yaml
id: KG-06
epic: B
status: done (PR #38)
depends_on: [KG-02]
size: M
labels: [knowledge, identity]
packages: [packages/knowledge, packages/contracts, docs]
```

**Scope.**

- Extend `docs/evidence-identity.md` rules to nodes: canonical identity from
  `(repositoryId, localNodeId)` plus alias resolution via DOI/PMID/OpenAlex where declared.
- Deterministic duplicate/same-claim detection (normalized-text hash + shared identifiers) that
  emits _proposals_, never merges. An LLM must not decide identity.
- `NodeAlias` table or equivalent in `packages/db` (small schema addition allowed here).

**Acceptance criteria.**

- Unit tests: same DOI ⇒ same work; near-identical text ⇒ proposal not merge; distinct claims
  untouched. Determinism test (stable output ordering/hashing).

### KG-07 — Typed edge lifecycle (assert → propose → confirm)

```yaml
id: KG-07
epic: B
status: done (PR #42)
depends_on: [KG-02, KG-03, KG-04, KG-06]
size: M
labels: [knowledge, editorial]
packages: [packages/contracts, packages/knowledge, packages/db, apps/web]
```

**Scope.**

- Generalize `KnowledgeLinkProposal` to node edges: author-asserted edges arrive via the node
  manifest; agent-proposed edges come from the knowledge layer; editors confirm/reject in the
  dashboard. Confirmed edges become public; proposals are visibly labelled as proposals.
- Contradiction edges surface symmetrically on both endpoints.

**Acceptance criteria.**

- Lifecycle unit tests (all transitions; illegal transitions rejected).
- Editorial e2e: propose → confirm → edge public; propose → reject → edge never public.
- Audit events for every transition.

### KG-08 — Graph query API

```yaml
id: KG-08
epic: B
status: done (PR #47)
depends_on: [KG-05, KG-07]
size: M
labels: [api, knowledge]
packages: [apps/web, packages/knowledge]
```

**Scope.**

- `GET /api/graph`-style routes: subgraph by seed node (depth-bounded), by topic/keyword (via
  the existing `SearchProvider`), filtered by node kind, edge type, edge status, TRUST
  presence. Cursor pagination; hard caps on depth and result size; typed responses defined in
  contracts; documented in `docs/openapi.yaml`.

**Acceptance criteria.**

- Unit tests over seeded graph; bounds enforced (oversized depth/limit ⇒ 400 typed error);
  rate limiting consistent with existing routes.

### KG-09 — Graph explorer UI

```yaml
id: KG-09
epic: B
status: done (PR #50)
depends_on: [KG-08]
size: L
labels: [web, ui]
packages: [apps/web, packages/ui]
```

**Scope.**

- A `graph` page: navigate the neighborhood of a node, filter by kind/edge type/status,
  distinguish confirmed vs proposed edges and supports vs contradicts visually, click through
  to node pages. Server-rendered fallback list view for accessibility/no-JS; any visualization
  renders escaped text only.

**Acceptance criteria.**

- E2e: seed graph is navigable; proposed edges visibly distinct from confirmed; contradiction
  visible from both ends. Keyboard navigable.

### KG-10 — TRUST attachment for non-claim nodes

```yaml
id: KG-10
epic: B
status: done (PR #46)
depends_on: [KG-05]
size: M
labels: [trust, contracts]
packages: [packages/trust, packages/contracts, docs]
```

**Scope.**

- Define how TRUST-style assessment applies to dataset/code/figure nodes **without breaking the
  invariant** that TRUST attaches to a claim–citation relation: model these as assessments on
  the _relation between a claim node and its evidence node_ (claim ← uses-dataset — dataset,
  etc.), imported as `unverified-import` with the existing verification/hash machinery.
- Update `docs/trust-model.md`.

**Acceptance criteria.**

- Contracts + trust unit tests; hash-guarded verification works on node relations; no schema
  path allows TRUST attached to a bare node with no relation.

---

## Epic C — AI-written long-form reviews (M3)

### KG-11 — Subgraph evidence packets

```yaml
id: KG-11
epic: C
status: done (PR #51)
depends_on: [KG-08]
size: M
labels: [knowledge]
packages: [packages/knowledge, packages/contracts]
```

**Scope.**

- Extend the evidence-packet builder to take a topic or seed subgraph and produce a bounded,
  deterministic packet: nodes (with kinds), confirmed edges, TRUST summaries with method,
  identifiers whitelist, contradiction pairs, and per-item provenance. Stable ordering and a
  packet hash for reproducibility/audit.

**Acceptance criteria.**

- Unit tests: bounded size, deterministic hash, identifiers whitelist exactly matches packet
  contents, contradictions always included when present in the subgraph.

### KG-12 — Long-form review generator

```yaml
id: KG-12
epic: C
status: done (PR #54)
depends_on: [KG-11]
size: L
labels: [knowledge, llm]
packages: [packages/contracts, packages/knowledge, packages/db, apps/web]
```

**Scope.**

- A `SynthesisWriter` behind the existing provider-neutral `LlmProvider` interface producing a
  sectioned long-form review (background, state of knowledge, agreements, contradictions &
  open questions, data & code availability, limitations) as a Zod-validated structure where
  **every citation is a node/identifier from the packet** — output citing anything outside the
  whitelist is rejected, mirroring the Atlas Discuss grounding rule.
- Deterministic fallback composer (template from packet contents) when no LLM is configured,
  so CI and e2e never require an API key.
- Every generation recorded as an `AgentRun` (model, provider, prompt hash, packet hash,
  output).

**Acceptance criteria.**

- Unit tests with a mock LLM: valid output accepted; out-of-packet citation rejected; malformed
  JSON rejected; fallback path produces a valid grounded document from the seed graph.

### KG-13 — Synthesis review records + editorial gate

```yaml
id: KG-13
epic: C
status: done (PR #58)
depends_on: [KG-12, KG-04]
size: L
labels: [web, editorial, db]
packages: [packages/contracts, packages/db, apps/web]
```

**Scope.**

- New review kind `ai-synthesis` reusing the Review/ReviewVersion machinery: immutable
  versions, distinct DOI fields, contributors = the pipeline (AgentRun-linked) plus the
  approving editor. Generation lands as a **draft in the editorial queue**; an editor
  accepts/rejects/requests-regeneration. Nothing is public before acceptance
  (per `docs/agent-governance.md` — autonomous publication stays out of scope).
- Draft view for editors: rendered sections, every citation resolvable to its node, packet
  hash, AgentRun provenance.

**Acceptance criteria.**

- E2e: trigger generation (fallback composer) → draft in queue → accept → published synthesis
  review visible and labelled AI-generated; reject leaves nothing public. Audit events for all
  transitions; acceptance idempotent under retry.

### KG-14 — Staleness detection and regeneration proposals

```yaml
id: KG-14
epic: C
status: done (PR #61)
depends_on: [KG-13]
size: M
labels: [knowledge, scripts]
packages: [packages/knowledge, scripts, apps/web]
```

**Scope.**

- Deterministic staleness check: a published synthesis review stores its packet hash and node
  set; when new/updated nodes or newly confirmed edges intersect its topic subgraph, mark it
  `stale` with a machine-readable delta (added/changed nodes).
- A `scripts/refresh-syntheses.ts` CLI that scans, marks stale, and (optionally) generates a
  new **draft** for the editorial queue — never auto-publishes.
- Stale badge on the public synthesis page ("newer evidence exists").

**Acceptance criteria.**

- Unit tests: unaffected reviews untouched; affected review marked with correct delta; CLI is
  idempotent. E2e or integration test for the stale badge.

---

## Epic D — Human consumption (M4)

### KG-15 — Synthesis reading experience

```yaml
id: KG-15
epic: D
status: todo
depends_on: [KG-13]
size: L
labels: [web, ui]
packages: [apps/web, packages/ui]
```

**Scope.**

- Long-form reading page: typographic layout for sustained reading, table of contents, every
  inline citation a popover/link into the underlying node (with kind, TRUST context, and
  provenance), contradictions rendered as explicit "disputed" callouts, prominent persistent
  "AI-generated, editor-approved" labelling with generation date, model, and packet hash.
- Print/reader-mode friendly; JSON-LD (`ScholarlyArticle` with `author` reflecting the
  AI-pipeline + editor attribution policy from KG-18).

**Acceptance criteria.**

- E2e: citation drill-down to node page; disputed callout renders for the seeded
  contradiction; AI labelling always visible. Accessibility parity with existing pages.

### KG-16 — Generation-to-generation diffs

```yaml
id: KG-16
epic: D
status: todo
depends_on: [KG-15]
size: M
labels: [web, knowledge]
packages: [apps/web, packages/knowledge]
```

**Scope.**

- "What changed" view between two versions of a synthesis review: section-level text diff plus
  structured evidence delta (nodes added/removed/re-assessed, edges confirmed, contradictions
  resolved/opened) computed from packet hashes and node sets — the structured delta is the
  primary artifact, the text diff secondary.

**Acceptance criteria.**

- Unit tests for the delta computation; e2e rendering a diff between two seeded generations.

### KG-17 — Freshness, coverage, and discovery

```yaml
id: KG-17
epic: D
status: todo
depends_on: [KG-15, KG-14]
size: M
labels: [web]
packages: [apps/web]
```

**Scope.**

- Archive filters distinguishing repo-based reviews, nodes, and AI syntheses; per-synthesis
  freshness indicator (up-to-date / stale + delta size); a topic coverage view listing
  published nodes not yet covered by any synthesis (feeds the KG-14 loop and tells editors
  where a new review is warranted).

**Acceptance criteria.**

- E2e for filters and freshness badge; coverage list correct against the seed graph.

---

## Epic E — Governance, evaluation, and end-to-end hardening (M5)

### KG-18 — Governance & policy documentation

```yaml
id: KG-18
epic: E
status: todo
depends_on: [KG-13]
size: S
labels: [docs, governance]
packages: [docs]
```

**Scope.**

- Update `docs/agent-governance.md`, `docs/editorial-governance.md`, and
  `docs/poc-limitations.md`: attribution policy for AI-authored syntheses (pipeline + editor,
  never a fabricated human author), labelling requirements, editor responsibilities and
  liability boundaries, what acceptance does and does not mean for AI syntheses, correction/
  retraction flow for a published synthesis, and the explicit non-goal that remains:
  **no autonomous publication and no automated knowledge consensus** — syntheses summarize
  and attribute; they do not adjudicate truth.
- Update `PLAN.md` non-goals and `README.md` to describe the node/synthesis model.

**Acceptance criteria.**

- Docs consistent with the shipped behavior of KG-04/07/13/14; cross-references resolve.

### KG-19 — Grounding evaluation harness in CI

```yaml
id: KG-19
epic: E
status: done (PR #57)
depends_on: [KG-12]
size: M
labels: [testing, ci, llm]
packages: [packages/knowledge, scripts, .github, docs]
```

**Scope.**

- An automated grounding suite that runs in CI without API keys: adversarial mock-LLM fixtures
  (out-of-packet citations, fabricated DOIs, example-DOI leakage, prompt-injection strings
  embedded in node text) asserting the validator rejects or neutralizes each; injection
  strings in repository content must never alter generator behavior (they are data, not
  instructions).
- A `scripts/eval-grounding.ts` runner usable locally against a real provider (opt-in via env)
  producing a pass/fail report; report format documented.

**Acceptance criteria.**

- Suite wired into `ci.yml`; all fixtures pass; adding a new fixture is a one-file change.

### KG-20 — Full-pipeline e2e and CI coverage

```yaml
id: KG-20
epic: E
status: todo
depends_on: [KG-05, KG-09, KG-13, KG-15]
size: M
labels: [testing, ci, e2e]
packages: [apps/web, .github]
```

**Scope.**

- One Playwright journey covering the whole target model against the seed: lab repo with node
  manifest → inspect → submit → editorial accept (nodes public) → agent proposes an edge →
  editor confirms → synthesis draft generated (fallback composer) → editor accepts → human
  reads the synthesis and drills down to a node → a new node lands → synthesis flagged stale.
- Keep total e2e wall-time reasonable (reuse seeds; no external network).

**Acceptance criteria.**

- Journey green in CI alongside all existing suites; documented in
  `docs/development-log.md`.

---

## Dependency graph (merge order)

```
KG-01 ──► KG-02 ──► KG-04 ──► KG-05 ──► KG-08 ──► KG-09
   │         │        ▲          │         ▲
   └──► KG-03 ────────┘          └─► KG-10 │
             KG-02 ──► KG-06 ──► KG-07 ────┘
KG-08 ──► KG-11 ──► KG-12 ──► KG-13 ──► KG-14 ──► KG-17
                       │         ├────► KG-15 ──► KG-16 ─┐
                       │         └────► KG-18            │
                       └──► KG-19                        │
KG-05 + KG-09 + KG-13 + KG-15 ──► KG-20 ◄────────────────┘
```

Parallel-safe starting set: **KG-01** alone first (everything depends on contracts), then
**KG-02 + KG-03** in parallel, then the epics fan out.
