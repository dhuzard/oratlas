# Architecture audit and incremental refactoring plan

Tracking issue: [#142](https://github.com/dhuzard/oratlas/issues/142)

Baseline: `origin/main` at `8074e84` (2026-08-06)

Status: initial code-grounded audit; first boundary-enforcement increment proposed in
[#143](https://github.com/dhuzard/oratlas/pull/143). Merge the implementation PR before this
documentation update.

## Executive summary

ORAtlas has a sound high-level shape: a TypeScript workspace, a thin Next.js transport layer,
runtime-validated contracts, framework-free domain packages, and a single persistence package. The
workspace package manifests form a directed acyclic graph, and critical scientific/editorial
invariants already have unusually strong integration coverage.

The main maintainability problem is below that package diagram. `apps/web/src/lib` has become the
de facto application, persistence-adapter, policy, and query layer at once. Its 76 production
modules contain about 24,600 lines; 46 of them access the database directly or import Prisma types.
Several critical workflows are concentrated in files between 1,100 and 2,300 lines. This makes the
documented package boundaries less useful to a maintainer working on publication, challenges,
synthesis, or graph traversal.

The recommended direction is not a rewrite or a new framework. Preserve the existing public
contracts and transactions, introduce explicit seams inside each vertical workflow, move only
code with demonstrated non-web consumers into an existing package, and add lightweight dependency
checks after the intended direction is explicit.

## Audit method and inventory

This pass inspected package manifests, TypeScript imports, runtime entry points, the Prisma schema,
the largest production modules, and the integration tests protecting the representative flows.
Generated Prisma code and dependency directories were excluded.

| Surface                                                      |    Baseline observation |
| ------------------------------------------------------------ | ----------------------: |
| Workspace packages under `packages/`                         |                      14 |
| TypeScript/TSX files under `apps`, `packages`, and `scripts` |                     576 |
| Next.js API route handlers                                   |                      76 |
| Next.js pages                                                |                      25 |
| Non-test root operational/maintenance scripts                |                      19 |
| Application-owned CLI entry points                           |                       1 |
| Production modules in `apps/web/src/lib`                     | 76 / about 24,600 lines |
| Production web-lib modules coupled to the DB boundary        |                      46 |

The inventory can be reproduced with `rg --files`, filtering `*.test.*` and `*.spec.*`, and with
the workspace dependency declarations in each `package.json`. Counts are a navigation aid, not a
quality metric.

## Current boundaries

### Workspace-level dependency graph

The declared workspace dependencies currently have no package cycle.

| Boundary                                                                                          | Responsibility and outgoing workspace dependencies                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`                                                                              | Public/internal DTOs, Zod schemas, canonical JSON, JSON Schema; no workspace dependency                       |
| `packages/config`                                                                                 | Environment and runtime configuration; no workspace dependency                                                |
| `packages/trust`                                                                                  | TRUST validation, provenance, aggregation; depends on contracts                                               |
| `packages/github`, `packages/zenodo`                                                              | Bounded external adapters; depend on contracts                                                                |
| `packages/extractor`                                                                              | Deterministic extraction and compatibility; depends on contracts, GitHub, and Zenodo                          |
| `packages/knowledge`                                                                              | Pure search, graph/synthesis preparation, discussion, and replication logic; depends on contracts and trust   |
| `packages/db`                                                                                     | Prisma client, schema, integrity guards, seed and deployment support; depends on config, contracts, and trust |
| `packages/exports`, `packages/federation`, `packages/execution-passports`, `packages/atlas-check` | Bounded capabilities built primarily on contracts                                                             |
| `packages/protocols`                                                                              | Offline protocol adapters/comparison; no ORAtlas workspace dependency                                         |
| `packages/ui`                                                                                     | Reusable React primitives; no workspace dependency                                                            |
| `apps/web`                                                                                        | Composition root and Next.js transport; consumes nearly every capability package                              |

This is a useful macro-architecture. The pressure is in `apps/web`: its flat `src/lib` directory
contains application use cases, direct Prisma queries, authorization helpers, integrity policy,
projection mapping, and infrastructure utilities without machine-enforced sub-boundaries.

### Runtime entry points

- `apps/web/src/app/**/page.tsx`: server-rendered and client-assisted user interfaces.
- `apps/web/src/app/api/**/route.ts`: HTTP transport, request validation, authorization/rate
  limiting, and calls into `apps/web/src/lib` services.
- `apps/web/src/middleware.ts`: request middleware and security policy.
- `scripts/*`: ingestion, schema/OpenAPI validation, backup/restore, canonical-graph migration,
  synthesis refresh, evaluation, smoke, and release operations.
- root/package scripts: development/build/test and Prisma schema/seed/deployment commands.

Sampled route handlers are generally thin. For example, the submission, editorial-decision,
synthesis-generation, and canonical-graph routes validate transport input and delegate to a
service. The refactoring target is therefore the service layer, not a route-controller rewrite.

## Representative data flows

### Submission and publication

```text
POST /api/submissions
  -> createSubmission
  -> consume and verify the inspection capture in a transaction
  -> persist immutable repository/submission records

POST /api/editorial/decision
  -> acceptSubmission / decideSubmission
  -> compare-and-set editorial state in a transaction
  -> materializeReviewPublication
  -> materializeKnowledge
  -> materializeCanonicalReviewGraph
  -> audit or roll back the complete operation
```

The orchestration, validation, persistence mapping, idempotency, retry handling, and publication
materialization all live in `apps/web/src/lib/submissions.ts`. Its existing facade is a valuable
compatibility seam and should remain stable while internals are separated.

### Canonical graph reads

```text
GET /api/graph
  -> queryCanonicalGraph
  -> direct Prisma traversal and cursor projection

/graph page
  -> queryPublicGraph
  -> direct Prisma traversal, proposal projection, TRUST provider, and signed cursor
```

The codebase currently has two graph contracts (`contracts/src/canonical-graph.ts` and
`contracts/src/graph.ts`) and two database query modules (`canonical-graph-query.ts` and
`graph-query.ts`). They serve different current consumers, but the ownership and intended
long-term relationship are not explicit. Consolidating them before characterizing their semantic
differences would be unsafe.

### Synthesis generation and publication

```text
POST /api/editorial/syntheses/generate
  -> generateSynthesisDraft
  -> loadPreparedSynthesisPacket (direct Prisma reads)
  -> generateSynthesisReview (packages/knowledge)
  -> persist AgentRun and private draft transactionally

editorial decision
  -> decideSynthesisDraft
  -> publish immutable review/version records
  -> materializeCanonicalReviewGraph
  -> audit or roll back
```

Pure packet and writer behavior is already in `packages/knowledge`; orchestration, leases,
database loading, editorial policy, public projection, and publication remain combined in
`synthesis-editorial.ts`.

## Findings

### F1 — Architecture documentation has drifted from the shipped graph implementation

**Evidence:** `docs/architecture.md` said canonical-graph runtime and database implementation had
not shipped. The current Prisma schemas define `KnowledgeNode`, `KnowledgeNodeVersion`, and
`CanonicalGraphContractState`; the web app contains materialization and query services; `/api/graph`
and graph pages consume them; integration tests cover dual-write, traversal, cursor, and visibility
behavior.

**Impact:** maintainers cannot reliably tell whether canonical graph code is target design or live
compatibility surface. Migration advice may be applied to a system already beyond that phase.

**Action:** correct the status immediately, then keep this audit linked from the main architecture
document. Treat graph IDs, exact versions, cursor semantics, and dual-write behavior as shipped
compatibility constraints.

### F2 — `apps/web/src/lib` is an implicit application layer with unclear ownership

**Evidence:** 76 production modules and about 24,600 lines sit in one flat directory; 46 touch the
database boundary. `db` has 41 inbound relative imports and is the dominant internal dependency.
`submissions.ts`, `challenges.ts`, `synthesis-editorial.ts`, and `editorial-lifecycle.ts` combine
authorization/policy, queries, commands, mapping, integrity checks, and transaction orchestration.

**Impact:** a change to one workflow requires understanding unrelated responsibilities, unit tests
need broad mocks or a real database, and ownership is communicated mostly by filename convention.

**Action:** organize by vertical feature and role while preserving current exported facades. Start
with private functions and types; do not introduce generic repositories or a service framework.

### F3 — Critical workflows are concentrated in very large transactional modules

**Evidence:** production line counts are approximately: `challenges.ts` 2,297,
`submissions.ts` 1,932, `synthesis-editorial.ts` 1,904, `editorial-lifecycle.ts` 1,164, and
`node-publication.ts` 951. Each exposes several commands and reads in addition to integrity and
mapping helpers.

**Impact:** review surface and regression radius are high. Transaction boundaries are harder to
see, and extracting a helper can accidentally move work outside the atomic operation.

**Action:** split one workflow at a time behind its existing public functions. Separate pure
validation/projection first, then transaction-scoped command helpers, then read models. Keep the
top-level transaction and idempotency key in the facade until characterization tests prove the
new seam.

### F4 — Maintenance scripts depend on private Next.js application internals

**Baseline evidence:** `materialize-seed-canonical-graph.ts` and `backfill-canonical-graph.ts` import
`apps/web/src/lib/canonical-graph-materialization`; `refresh-syntheses.ts` imports the web app's
staleness service and Prisma singleton.

**Impact:** CLI operations are coupled to the web source layout and Next/server-only build
assumptions. This contradicts the documented goal that reusable code lives in framework-free
packages.

**Action:** move the canonical materializer to the persistence boundary (or a narrowly justified
workflow module) without changing its transaction-client API. Split synthesis staleness into pure
selection/policy in `packages/knowledge` plus explicit DB adapters for web and CLI callers.

**First increment ([#143](https://github.com/dhuzard/oratlas/pull/143)):** the canonical materializer
now belongs to and is exported by `packages/db`;
the web path is a temporary forwarding facade. Canonical backfill/seed scripts consume the package
export. The synthesis refresh CLI moved under `apps/web/src/cli`, accurately keeping the current
application-owned composition in the app until its pure policy can be extracted.

### F5 — Two graph projections have overlapping, undocumented ownership

**Evidence:** `/api/graph`, Explore, and occurrence pages use the canonical graph query/contract,
while `/graph` uses `queryPublicGraph` and the separate public graph contract. Both query Prisma,
implement traversal/filtering, and have independent integration suites.

**Impact:** visibility rules, filtering, cursors, relation semantics, and TRUST projection can
drift. A premature merge could instead break intentional distinctions.

**Action:** add a decision record and a parity/intent matrix first. Decide whether one is a stable
record API and the other a presentation projection, then share only proven common loading or policy.

### F6 — Dependency direction is documented but not enforced

**Evidence:** workspace manifests currently form a DAG, but ESLint has no restricted-import or
boundary rules and TypeScript configs do not declare project references. The script-to-web imports
already bypass the intended direction.

**Impact:** architectural drift is detected by reviewer memory, not CI.

**Action:** after target paths are agreed, add a small deterministic import-boundary test. Enforce
only high-value rules: packages must not import apps; domain packages must not import Prisma/Next;
scripts must compose package exports rather than private web modules.

**First increment ([#143](https://github.com/dhuzard/oratlas/pull/143)):**
`scripts/architecture-boundaries.test.ts` enforces those three rules and also checks that workspace
package dependencies remain acyclic.

### F7 — Persistence and integrity utilities are repeated at workflow level

**Evidence:** retry/serializable wrappers recur in submissions, editorial lifecycle, claim
monitoring, synthesis editorial, and synthesis staleness even though `db-retry.ts` exists. SHA-256,
stored-JSON parsing, and canonical comparison helpers also have multiple local implementations.

**Impact:** retry budgets, error mapping, corruption handling, and deterministic ordering can
diverge in behavior that is part of fail-closed guarantees.

**Action:** inventory semantics before deduplicating. Consolidate only byte-for-byte-equivalent
helpers at the narrowest existing boundary; keep context-specific error mapping local.

### F8 — A few presentation modules also have excessive review surface

**Evidence:** the review page is about 1,080 lines, `KnowledgeLandscape.tsx` about 600, and several
page/client components are above 400 lines.

**Impact:** UI changes can mix data loading, policy copy, and presentation, but this is lower risk
than the transactional application layer.

**Action:** split stable presentational sections and view-model builders after server workflow
boundaries are clearer. Do not change URLs, server/client boundaries, or accessible behavior as
part of the architecture audit.

## Existing safety net and missing characterization

The existing integration suites are the main enabler for incremental work:

- `atomic-publication.integration.test.ts` covers capture ownership/tampering, upstream
  immutability, snapshot deduplication, concurrent/idempotent acceptance, rollback, selected-node
  publication, TRUST materialization, and graph publication.
- `challenges.integration.test.ts` covers subject integrity, permissions, the lifecycle ledger,
  tampering, publication visibility, and concurrent active-challenge constraints.
- `synthesis-editorial.integration.test.ts` covers generation leases/idempotency, atomic
  publication, DOI uniqueness, staleness, corruption, and concurrent decisions.
- `editorial-lifecycle.integration.test.ts` covers atomic formal decisions, recusal, process
  history, resubmission lineage, and role changes.
- canonical/public graph integration tests cover exact-version traversal, dual-write,
  visibility, signed cursors, contradictions, proposals, and TRUST scoping.
- route tests protect transport validation, rate limiting, error mapping, and cache headers.

Before structural changes, add or make explicit these characterization cases:

1. A facade-level test recording the exact success/error result of each exported submission
   command, including transaction call count and rollback ownership.
2. A graph intent matrix covering the same seed against both graph projections and documenting
   every expected difference.
3. CLI smoke tests proving canonical materialization and synthesis refresh run without importing
   `apps/web`.
4. An import-boundary test over production sources.
5. Focused tests for retry classification/budgets before consolidating retry helpers.

## Target boundaries

```text
Next.js routes/pages/middleware
        |
        v
web feature facades (transport-neutral use-case entry points)
        |
        +--> pure domain policy and projections in existing packages
        |
        +--> explicit Prisma/external adapters at the composition boundary
                       |
                       v
            packages/db and bounded external packages

packages/contracts remains dependency-bottom.
scripts compose public package exports and never import apps/web internals.
```

Design rules for the next iteration:

1. Preserve HTTP, OpenAPI, schema, deep-link, CLI, hash, and database behavior by default.
2. Keep transaction ownership visible at a single use-case facade; extracted helpers accept the
   transaction client when atomicity is required.
3. Put scientific/editorial policy in pure functions where possible; keep authorization,
   persistence, clocks, randomness, and providers explicit at the edge.
4. Prefer vertical feature folders over a generic `utils`, `services`, or repository hierarchy.
5. Move code to a workspace package only when at least two composition roots need it or it is
   independently meaningful domain/persistence behavior.
6. Enforce dependencies after the intended exceptions are documented.

## Prioritized refactoring backlog

Implemented in the first reviewable batch:

- [x] Export canonical graph materialization from `packages/db` without changing its
      transaction-client contract.
- [x] Remove all root-script imports of `apps/web` internals.
- [x] Re-home the application-owned synthesis refresh CLI under `apps/web/src/cli` while preserving
      the root `pnpm refresh:syntheses` command.
- [x] Add deterministic import-boundary and workspace-cycle tests.
- [ ] Characterize and decide the ownership of the two graph projections.
- [ ] Split the large transactional workflow modules behind their existing facades.

| Priority | Increment                                                                            | Problem addressed | Impact                                                 | Risk   | Dependencies / verification                                                          |
| -------- | ------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------ |
| P0       | Keep architecture status and this inventory current                                  | F1                | High clarity                                           | Low    | Documentation review; no runtime change                                              |
| P1       | Add production import-boundary test                                                  | F4, F6            | Stops new drift                                        | Low    | Agree allowed dependency rules; run in `pnpm test`                                   |
| P1       | Characterize the two graph projections and record their intended ownership           | F5                | Prevents contract drift and unsafe merge               | Low    | Existing graph integration suites plus new intent matrix                             |
| P1       | Remove canonical-graph scripts' imports from `apps/web`                              | F4                | Reusable migration/maintenance path                    | Medium | Preserve transaction-client API; canonical graph integration and backfill validation |
| P1       | Split `submissions.ts` behind its current exports                                    | F2, F3            | Reduces highest publication regression radius          | High   | Atomic-publication suite; no route/API signature changes                             |
| P1       | Split `challenges.ts` into subject resolution, commands/ledger, and read projections | F2, F3            | Clearer integrity and authorization ownership          | High   | Challenge integration suite; keep transaction boundaries                             |
| P1       | Split synthesis generation, editorial decision, public reads, and staleness          | F2-F4             | Clarifies AI/editorial lifecycle and enables CLI reuse | High   | Synthesis editorial/staleness suites and AgentRun invariants                         |
| P2       | Consolidate equivalent DB retry/transaction helpers                                  | F7                | Consistent contention behavior                         | Medium | First characterize codes, budgets, and error mapping                                 |
| P2       | Extract shared graph loading/visibility only where the intent matrix proves parity   | F5                | Reduces duplicate traversal policy                     | Medium | Decision record; both graph suites and API contracts                                 |
| P2       | Organize remaining web server modules into vertical feature folders                  | F2                | Discoverability and ownership                          | Medium | Mechanical moves in small PRs; import-boundary CI                                    |
| P3       | Split large page/component presentation surfaces                                     | F8                | Easier UI review/testability                           | Medium | Snapshot/accessibility/E2E behavior; no URL changes                                  |

## Incremental migration strategy

1. **Baseline:** land this audit, correct factual documentation drift, and freeze compatibility
   surfaces in a decision/intent matrix.
2. **Characterize:** add only the missing facade, CLI, graph-difference, and retry tests.
3. **Create seams in place:** extract pure helpers and transaction-scoped collaborators inside the
   same feature without moving public exports.
4. **Move demonstrated reusable code:** change one caller at a time to package-level public exports;
   retain temporary forwarding exports when necessary.
5. **Enforce direction:** add import checks once violations are removed or explicitly allowlisted.
6. **Contract:** delete forwarding modules and duplicated helpers only after all callers and
   compatibility tests use the target boundary.

Each increment should be independently reviewable and reversible. Schema changes, public contract
changes, hash changes, or semantic changes are separate follow-up issues and must not be hidden in
file moves.

## Compatibility surfaces that must not move accidentally

- Prisma schema/data, uniqueness constraints, compare-and-set transitions, and transaction scope.
- Immutable record bytes, canonical JSON, hashes, provenance, and audit idempotency.
- Review-manifest, Zod, JSON Schema, and OpenAPI contracts.
- Public routes, deep links, cursor semantics, cache/rate headers, and error codes.
- Exact graph node/version identity, relation status, visibility, and TRUST subject binding.
- Submission capture single-use semantics and the no-re-read GitHub boundary.
- CLI arguments/output/exit behavior and operational backup/migration gates.
- Editor-controlled AI generation, AgentRun provenance, and fail-closed publication rules.

## Follow-up issue slices

Create implementation issues from the P1/P2 rows only after the graph intent and dependency rules
are reviewed. Each issue should name the facade it preserves, the exact tests that gate it, and any
temporary forwarding export. The first safe implementation issue is the import-boundary test; the
first behavior-adjacent issue is removing canonical-graph maintenance imports from `apps/web`.
