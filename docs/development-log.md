# Development log

Chronological record of implementation slices, decisions, and verification outcomes.

## PR-00 — Repository initialization

**Objective:** initialize the pnpm TypeScript monorepo with shared tooling so every later
slice can lint, typecheck, and test.

- Created workspace (`apps/*`, `packages/*`), root `package.json` with pinned toolchain,
  strict base `tsconfig`, flat ESLint config (typescript-eslint + react-hooks + prettier),
  Prettier, Vitest root config, `.env.example`, `.gitignore`.
- Wrote `PLAN.md` (backlog + reference-template findings) and `docs/architecture.md`.
- Decision: internal packages export TypeScript source directly (`"main": "src/index.ts"`)
  and are consumed via `transpilePackages` in Next.js — avoids per-package build steps in a
  POC while keeping clean package boundaries.
- Decision: pnpm 10 `onlyBuiltDependencies` allowlist for prisma/esbuild/sharp/tailwind
  oxide so postinstall scripts run.

## PR-01 — Shared contracts and schemas

**Objective:** dependency-free `@oratlas/contracts` package every other package builds on.

- Zod schemas + types: enums (statuses, roles, compatibility levels, relation types,
  TRUST ordinals/criteria, identifier schemes), identifier syntax (DOI, ORCID, commit SHA,
  GitHub owner/name), safe repo-relative path validation, review manifest v1.0.0,
  extracted-metadata document with field-level provenance and separate manual edits,
  inspection + compatibility reports, structured DOI validation report, knowledge
  artifact records (claims/citations/relations/TRUST JSONL) with bounded JSONL parser,
  evidence packet + grounded answer schema + grounding validator, search queries,
  API error envelope.
- Matching JSON Schema: `packages/contracts/schemas/review-manifest.schema.json`.
- Added `@oratlas/config` (validated server env; refuses mock auth in production,
  requires SESSION_SECRET in production).
- Verified: `pnpm install` ok; vitest 19/19 pass; typecheck clean for both packages.

## PR-02 — Database model and seed data

**Objective:** normalized Prisma schema (spec §9) + realistic seed data (spec §20).

- Schema: User, Repository, RepositorySnapshot (repo+commitSha unique), Review,
  ReviewVersion (separate versionDoi/conceptDoi/zenodoRecordId + isExample flag), Person,
  ReviewContributor, Submission (immutable submittedPayloadJson), Identifier,
  Claim, Citation, ClaimEvidenceRelation (unique claim+citation+relation), TrustAssessment
  (attached to the relation; per-criterion JSON columns; optional aggregate + method),
  TrustVerification (separate hash-bound platform marker),
  AgentRun, DiscussionThread, DiscussionMessage, KnowledgeLinkProposal, AuditEvent.
- SQLite provider; Postgres-compatible by construction (enums→String validated by
  contracts, JSON→String columns, arrays→JSON strings). SQLite file resolves
  schema-relative to `packages/db/prisma/dev.db`, stable across web app and scripts.
- Seed loads: DOI review (release + example Zenodo DOI), repository-only review,
  template structural demo, pending submission, 5 claims, 4 citations, 5 relations
  (incl. a `contradicts`), 5 repository TRUST assertions + 1 Atlas structural-review marker, 1
  cross-review link proposal. All DOIs use reserved `10.5555/` and are flagged
  `isExample` / `example-not-resolvable` so the UI never links them out.
- Verified: `prisma validate` ok; `db:push` ok; `db:seed` ok; counts confirmed;
  typecheck clean. Added `packages/db/.env` (gitignored) for Prisma CLI.

## PR-03 — GitHub repository inspection

**Objective:** SSRF-safe URL handling and bounded, mockable repository inspection (spec §6).

- `parseGithubRepoUrl`: normalizes canonical/shorthand/.git/deep-path forms to
  `https://github.com/{owner}/{repo}`; rejects non-GitHub hosts, look-alike hosts,
  embedded credentials, `@`, api./raw. hosts, localhost/loopback/link-local/private IPs,
  non-standard ports, non-http(s) schemes, and reserved GitHub paths. Single SSRF choke point.
- `inspectRepository`: server-side REST inspection with explicit per-request timeouts,
  `redirect: "error"`, max file bytes/total bytes/file count/tree-entry caps, permitted
  textual extensions, partial-inspection warnings. Fetches repo metadata, license, topics,
  default branch, latest commit, tags, releases (+ DOIs parsed from release bodies), Pages
  URL, and well-known files (manifest, CITATION.cff, .zenodo.json, codemeta, myst.yml,
  package.json/pyproject, README, bibliography, knowledge JSONL, provenance). Never clones,
  never executes code.
- `IngestionRunner` interface + `SynchronousIngestionRunner` (queue-replaceable, spec §6).
- Mockable `GithubTransport`; `createFakeTransport` fixture + realistic template fixtures
  reused by later slices.
- Verified: typecheck clean; 22 unit tests (URL normalization + SSRF rejection matrix +
  bounded inspection + size limits) pass with zero network access.

## PR-04 — DOI and Zenodo validation

**Objective:** DOI normalization, resolution, and structured Zenodo matching (spec §3).

- `normalizeDoi`: handles `doi:`, `DOI:`, `https://doi.org/`, `dx.doi.org`, raw, trailing
  punctuation; lower-cases (DOIs are case-insensitive). Zenodo detection + record-id
  extraction. Reserved `10.5555/*` example DOIs flagged and never resolved outward.
- Mockable `DoiResolver` (doi.org HEAD + Zenodo record GET, both with timeouts).
- `validateDoi`: structured `DoiValidationReport` — per-check outcomes (syntax, resolution,
  zenodo-metadata, repository-match, title-match, release-match), hard errors vs warnings
  vs confidence, version-vs-concept DOI discrimination (discovers concept DOI from a
  version record). Slight metadata differences produce warnings, never rejection.
- Verified: typecheck clean; 12 unit tests (normalization forms, example short-circuit,
  invalid/unresolvable, high-confidence match, concept vs version, warnings-not-errors,
  metadata-unavailable) pass with no network access.

## PR-05 — Extraction pipeline, compatibility, TRUST

**Objective:** deterministic extraction with provenance, artifact ingestion, transparent
compatibility classification (spec §7, §12), and TRUST validation/aggregation (spec §11).

- `@oratlas/extractor`: priority-ordered source parsers (manifest → CITATION.cff →
  .zenodo.json → codemeta → MyST → repo metadata → README heuristics). `extractMetadata`
  sets each field from the first source that supplies it and stamps field-level provenance
  (source, file, pointer, commit, extractor version, timestamp, confidence). Version DOI and
  concept DOI stay separate. `extractKnowledge` ingests claims/citations/relations/TRUST
  JSONL (manifest-guided, path re-validated) and enforces referential integrity (drops
  relations/TRUST referencing unknown claims/citations). `assessCompatibility` produces the
  transparent report — every signal a deterministic rule with plain-language evidence and a
  level rationale; levels verified-template / compatible / partially-compatible / unsupported
  / inspection-failed. No LLM decisions in structural compatibility.
- `@oratlas/trust`: `validateTrustRecord`, `computeAggregate` (mean of _assessed_ ordinals
  only, never treating not-assessed/not-applicable as zero, always tagged
  `ordinal-mean-1.0`), `ordinalAtLeast`. Aggregate is optional; criterion record authoritative.
- Added `@oratlas/github/fixtures` subpath so extractor tests reuse GitHub fixtures.
- Verified: typecheck clean; 12 new tests; full suite 65/65 passing, zero network.

## PR-06 — Knowledge layer (search, packets, discussion, links)

**Objective:** search provider, evidence packets, deterministic + LLM discussion with
grounding, and cross-review link proposals (spec §14–16).

- Framework-free denormalized types (`IndexedReview/Claim/Citation`) so the layer has no DB
  dependency; the web app maps Prisma rows into them.
- `SearchProvider` interface + `InProcessSearchProvider` (lexical, deterministic) with all
  archive/claim filters (DOI/TRUST/evidence availability, domain, keywords, author, relation
  type, TRUST criterion, human-reviewed state) and sorts.
- `buildEvidencePacket`: knowledge-unit packets (claims + anchors + relations + TRUST status
  - review identity/commit/DOI + only-cited citations); `hashEvidencePacket` stable hash.
- `discussDeterministic`: groups matched claims by evidence relation, returns a structured
  summary, refuses to fabricate prose, warns that shared-source citations ≠ replication.
- `discussWithLlm`: provider-neutral `LlmProvider`; parses Zod answer schema and
  rejects/retries answers referencing unknown identifiers; returns provider/model/prompt
  version + grounding result for persistence. Versioned prompt; no chain-of-thought.
- `createAnthropicProvider`: the single concrete adapter (isolated), model gets only the packet.
- `proposeCrossReviewLinks`: conservative shared-citation + lexical-similarity proposals,
  cross-review only, emitted as drafts.
- Verified: typecheck clean; 13 tests incl. grounding rejection/retry; full suite green.

## PR-07 & PR-08 — Web application (archive, submission, review, claims, discussion, editorial)

**Objective:** the full Next.js App Router surface plus API routes, auth, and the editorial
workflow (spec §5, §8, §13, §14, §19).

- `@oratlas/ui`: accessible primitives + the provenance visual system (repository-fact /
  extracted / curated / agent-proposed / human-reviewed / warning / error), each colour- AND
  text/icon-coded so distinctions never rely on colour alone.
- Server library: singleton Prisma; SSRF-safe ingest service (inspect → extract → validate);
  submission service (immutable snapshot + submission; editorial acceptance materializes a
  versioned Review with contributors, identifiers, claims, citations, relations, TRUST);
  knowledge-index builder (Prisma → framework-free index); review-detail loader; discussion
  service (deterministic + optional Anthropic LLM, persists AgentRun); audit log; rate limiter;
  signed httpOnly session cookies; dev-only mock auth (refused in production) + optional GitHub OAuth.
- Pages: home (search + recent + domain/DOI/TRUST filters + provenance legend), archive
  (full-text + all filters + sorts), review page (repository/commit/release/version DOI/concept
  DOI/Zenodo/provenance/claims/citations/TRUST/limitations/version history + schema.org JSON-LD +
  canonical/OG), claim explorer (search + relation/type/TRUST filters), 5-step submission wizard
  (repository → inspect → editable metadata with per-field provenance → validation → submit),
  Atlas Discuss (deterministic + LLM), editorial dashboard (validation reports, extracted-vs-edited
  metadata diff, accept/reject/request-changes, audit log), sign-in.
- API routes: health, inspect, validate-doi, submissions, editorial/decision, search, reviews/[slug],
  claims, discuss, GitHub OAuth start/callback — all with typed structured errors (no stack traces),
  rate limiting, body-size limits, and server-side role checks.
- Security headers (CSP, X-Frame-Options, nosniff) via next.config; all repository content rendered
  as escaped text (never raw HTML); example DOIs never rendered as outbound links.
- Verified: `pnpm build` succeeds (all 20 routes); server smoke test — home/archive/review/claims 200,
  search + claims + deterministic discuss APIs return correct data, editorial redirects unauth (307),
  health ok. Lint clean; 78 unit tests pass; all 10 typechecks pass.

## PR-09 — Scripts, CI, and end-to-end tests

**Objective:** maintenance/validation CLIs, GitHub Actions, and essential Playwright flows
(spec §21, §22).

- Scripts: `scripts/validate-json-schemas.ts` (compiles the review-manifest JSON Schema with
  Ajv 2020, validates the reference example, and asserts unsafe artifact paths are rejected);
  `scripts/validate-doi.ts` (CLI structured DOI report; example DOIs never resolved);
  `scripts/ingest.ts` (read-only inspect+extract of a repo URL).
- `db:reset` rewritten to delete the SQLite file then push+seed (`src/seed/reset.ts`),
  avoiding Prisma 6.19's interactive consent gate on `--force-reset`.
- Seeded pending submission now carries a `submittedPayloadJson` so an editor can accept it
  offline (used by the editorial e2e).
- GitHub Actions `ci.yml`: two jobs — `verify` (install → prisma generate/validate → JSON
  Schema check → lint → format:check → typecheck → unit tests → db push+seed → production
  build) and `e2e` (db push+seed → Playwright chromium). pnpm cache; no deployment secrets
  required for PR validation.
- Playwright: dev-server webServer (so mock auth works; refused under production), absolute
  SQLite path, pre-installed-Chromium fallback. Suites: archive browsing (home/archive/review
  with version-vs-concept DOI, example-DOI marking, contradicting relation, TRUST), claim
  explorer, deterministic discussion (grounded summary + insufficient-evidence), and the
  editorial workflow (submitter + editor mock sign-in, dashboard + audit log, accept → review
  appears in the archive).
- Debugging notes: added a webpack `extensionAlias` so Next resolves `.js`→`.ts`; made the CSP
  allow `'unsafe-eval'` in development only (Next HMR) while production stays strict.
- Verified: 9/9 e2e pass; JSON Schema check passes; lint/format/typecheck/build all green.

## PR-10 — Documentation, security pass, final verification

**Objective:** complete documentation, community files, OpenAPI, and a final full verification.

- Docs: README (purpose, screenshots placeholders, architecture, setup, env vars, db commands,
  seeding, testing, deployment, how to submit, how Zenodo linking works, what the platform does
  not verify), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE` (MIT),
  `CLAUDE.md`, and `docs/{data-model, review-manifest, trust-model, submission-workflow,
doi-and-versioning, agent-governance, editorial-governance, deployment, poc-limitations}.md`
  plus `docs/openapi.yaml`.
- Documented the required cautions: acceptance ≠ peer review; TRUST is relation-specific; agent
  links/assessments are proposals; DOI presence is not quality; default-branch may differ from a
  deposited release; exact versions are tied to commit SHAs; shared-source citations ≠ replication.
- Security posture (SECURITY.md): SSRF choke point, bounded inspection, no clone/execute,
  untrusted-content-as-text, server-side secrets, signed httpOnly cookies + OAuth state,
  server-side authorization, input/size/rate limits, grounded LLM output.
- Final verification: `pnpm install` ok; format/lint/typecheck clean; 78 unit tests pass;
  `schema:check` passes; production build succeeds (20 routes); 9/9 Playwright e2e pass.

## KG-01 — Knowledge-node contracts (issue #30)

**Objective:** establish dependency-free publication-node and typed-edge contracts for every
database, extraction, graph, editorial, and synthesis slice that follows.

- Added strict, discriminated `KnowledgeNode` schemas for claim, figure, dataset, and code
  objects. The shared envelope preserves stable repository-local identity, bounded text,
  contributors, license, repository provenance, and distinct version/concept DOI fields.
- Added the typed `NodeEdge` relation, provenance, and editorial lifecycle enums required by
  the graph model. Confirmed edges remain explicitly distinguishable from proposals.
- Added `node-manifest.schema.json`, a matching Zod contract, and a checked reference example.
  Repositories may enumerate individual JSON records or declare one JSONL stream; all source
  and artifact paths reuse the traversal-safe repository path contract, and exported byte/file
  caps are ready for the bounded KG-03 transport.
- Exported the new runtime schemas and TypeScript types from `@oratlas/contracts` without adding
  a package dependency.
- Verified: changed files pass Prettier; repository lint and all 15 workspace typechecks pass;
  10 new contract tests and all 318 non-database-integration tests pass; `pnpm schema:check` and
  the production web build pass. The full test run completed 333 tests successfully before the
  final dataset-locatability test was added, but five
  pre-existing integration suites cannot launch their extensionless Prisma shell shim on
  Windows (`spawnSync …/.bin/prisma ENOENT`); their 24 tests remain skipped on this platform.

## KG-02 — Knowledge-node data model (issue #32)

**Objective:** persist first-class, versioned knowledge nodes and typed graph edges without
destructively migrating the existing review-claim archive.

- Added stable `KnowledgeNode` identities scoped by `(repositoryId, localNodeId)`, immutable
  `KnowledgeNodeVersion` content snapshots bound to exact `RepositorySnapshot` commits, and
  typed `NodeEdge` rows from source versions to stable target identities. Enum-like values remain
  contract-validated strings; contributors, provenance, and kind-specific payloads use portable
  `…Json` string columns.
- Kept version and concept DOI fields separate and added the node-version `isExample` guard.
  Existing `Claim` rows gain only a nullable node-identity backlink, so no historical data needs a
  destructive backfill.
- Added nullable source-submission, inspection-capture, and capture-hash provenance on node
  versions. One editorial acceptance can therefore trace all materialized nodes to the exact
  immutable capture while retry deduplication remains anchored by node identity and snapshot.
- Seeded six valid nodes across an existing review lab and an independent node-publishing lab,
  covering claim, figure, dataset, and code kinds. The connected graph includes confirmed
  cross-lab `replicates` and `contradicts` edges and one explicitly flagged `10.5555/…` node.
- Hardened legacy GitHub repository reconciliation for node identities, snapshot-bound versions,
  edge endpoints, and duplicate edge tuples, preserving the pre-existing rename/merge workflow.
  Reconciliation now fails closed on kind mismatches or any content, DOI, example-marker, capture,
  lifecycle, provenance, rationale, assertion-time, or record-time difference; it deduplicates only
  rows proven semantically identical inside the transaction.
- Added `assertKnowledgeNodeMaterializationBinding` for KG-04's acceptance transaction. Prisma
  cannot encode repository equality across node, snapshot, submission, and capture tables, so this
  guard verifies the immutable GitHub id, selected snapshot/capture, commit SHA, and capture hash
  before a materialized node version is written.
- Added fixture contracts, adversarial reconciliation cases, cross-table binding tests, and a
  cross-platform SQLite persistence test for identities, immutable-version constraints, typed-edge
  uniqueness, JSON round-trips, nullable claim backlinks, and exact capture provenance.
- Verified: Prisma validate/generate, SQLite `db:push` + `db:seed` + `db:reset`, deterministic
  PostgreSQL schema/DDL regeneration, repository lint, all 15 workspace typechecks, schema checks,
  31 focused database/fixture tests, and the production web build pass. The full Windows test run
  completes 361 tests successfully; 24 tests in five pre-existing suites remain skipped because their direct
  extensionless Prisma shim launch fails with `ENOENT`. Changed files pass Prettier; the repository-
  wide Windows check continues to report the checkout's existing CRLF/LF normalization across
  unrelated files.

## KG-03 — Repository node extraction (issue #33)

**Objective:** deterministically extract first-class node publications from an immutable,
bounded GitHub repository capture without cloning, executing, or fetching referenced artifacts.

- Extended GitHub inspection with a two-phase, commit-pinned fetch: `node-manifest.json` is
  fetched and validated first, then only its declared JSON/JSONL node and edge sources are
  fetched. The manifest-specific 1 MB cap and existing shared file-count, per-source, total-byte,
  and tree-entry budgets all remain enforced. Exhausting the source-file budget marks inspection
  partial exactly once. With a valid node manifest, ambiguous tree-discovered legacy content is
  suppressed fail-closed; well-known metadata and explicit node/edge sources remain available,
  but mixed repositories cannot rely on filename heuristics for legacy artifacts.
- Added structured node extraction reports with per-record `ok` / `invalid` / `skipped` status,
  stable error and warning codes, field-level file/pointer/commit provenance, distinct normalized
  DOI references, and deterministic counts and ordering.
- Node extraction validates author-declared provenance against the inspected repository and
  commit, confirms figure/dataset/code paths exist in the captured tree without fetching their
  content, preserves version and concept DOI separation after normalization, and flags reserved
  `10.5555/*` examples without resolving them. A DOI accepted by the contract but rejected by
  normalization is now a stable `doi-invalid` record error rather than being silently omitted.
- Typed edges are extracted after nodes, with schema, endpoint, and duplicate checks. Invalid
  records never enter the successful node or edge sets.
- Exported the extraction-report Zod schema and wired it into the strict inspection-capture
  runtime schema, so immutable submission capabilities preserve and validate node results.
  Node-only repositories with valid declarations are now deterministically classified as
  compatible, and their declared DOIs contribute to the transparent compatibility signal.
- Added an all-kinds publication fixture and mock-transport coverage for commit pinning, malformed
  and unsafe manifests, source size limits, artifact non-fetching, JSON and JSONL extraction,
  example DOI handling, missing artifacts, duplicates, edge integrity, and determinism.
- Verified: all KG-03 changed files pass Prettier; lint, all 15 workspace typechecks, JSON Schema
  and OpenAPI checks, and the production web build pass. The 30 focused GitHub/extractor tests and
  all 351 tests outside the five Windows-incompatible Prisma-shim suites pass. The full test command
  reaches the same 351 passes, while those five pre-existing suites cannot launch the extensionless
  `packages/db/node_modules/.bin/prisma` shim on Windows (`ENOENT`) and skip their 24 tests.

## KG-06 — Cross-lab claim identity and deduplication (issue #36)

**Objective:** identify shared scholarly works and near-identical claim nodes deterministically
without changing the durable repository-local identity of any published node.

- Added scheme- and role-preserving DOI/PMID/OpenAlex alias contracts plus deterministic
  same-work/same-claim proposal reports with stable proposal and report hashes.
- Added identity-specific claim normalization that keeps negation, numbers, and qualifiers, and
  excludes example identifiers from all matching signals. The knowledge layer is pure and emits
  proposals only; it never mutates or merges nodes. Negated contractions and `cannot` normalize to
  an explicit protected negation, and near-similarity fails closed when qualifier semantics differ.
- Added portable `NodeAlias` persistence with non-global alias uniqueness and fail-closed legacy
  repository reconciliation. Shared aliases are evidence for editorial review, not database merge
  instructions. A single validated upsert boundary canonicalizes DOI resolver/case, PMID prefixes
  and leading zeroes, and OpenAlex URL/case forms before applying the compound unique key.
- Verified Prisma validation/generation, SQLite push/seed/reset, deterministic PostgreSQL
  schema/DDL regeneration, repository lint, all 15 workspace typechecks, schema checks, 37 focused
  identity/database tests, and the production web build. The full Windows test run completes 383
  tests successfully; 24 tests in five pre-existing suites remain skipped because they directly
  launch the extensionless Prisma shell shim and fail with `ENOENT` on Windows.

## KG-07 — Typed edge lifecycle (issue #41)

**Objective:** retain author and agent edge assertions as attributable proposals, require a
human editorial decision before a typed edge becomes authoritative, and expose contradictions
symmetrically without duplicating scholarly records.

- Started implementation after KG-02, KG-03, KG-04, and KG-06 merged. Expanded the recorded
  package scope to include contracts and persistence because repository declarations must be
  separated from platform lifecycle state and proposal origin must survive editorial decisions.
- Split repository edge declarations from Atlas lifecycle projections. Older captures that carry
  repository-supplied `confirmed`/`confirmed-by-editor` values remain parseable, but extraction
  discards that authority before submission or persistence.
- Added revisioned `NodeEdgeProposal` records for accepted author assertions and deterministic
  AgentRun proposals. They retain exact source and target versions, capture/run provenance and
  independent origin keys; editorial confirmation alone creates or reuses a confirmed `NodeEdge`.
- Added pure transition/typed-endpoint guards, serializable CAS decisions with exact-retry
  idempotency, current-role enforcement, per-transition audits, the editorial queue, a minimal
  confirmed-edge API, and symmetric contradiction projection without reverse-row duplication.
- Hardened the lifecycle after adversarial audit: immutable cross-lab author addresses now resolve
  exactly once or roll back acceptance; confirmed seed/public rows carry a frozen target version,
  editor and timestamp; reciprocal contradictions canonicalize to one tuple; stable endpoint
  provenance survives repository reconciliation; concurrent independent confirmations safely
  reuse the winning edge; and agent candidates must match a canonical, hashed output recorded by
  a succeeded node-edge AgentRun.
- Verified contract/extractor/lifecycle and publication integration coverage (62 focused tests),
  all 15 workspace typechecks, lint, JSON schemas, OpenAPI route parity, Prisma validation and
  generation, deterministic PostgreSQL schema/DDL generation, isolated SQLite reset/seed, the
  production web build, and the real Playwright author-proposal confirm/reject flow. The full
  Windows Vitest run completes 444 tests; 10 tests in three pre-existing suites remain skipped
  because they launch the extensionless Unix Prisma shell shim and fail with `ENOENT`.

## KG-04 — Node submission and editorial acceptance (issue #37)

**Objective:** let submitters finalize immutable node candidates and let editors select and
atomically publish node versions from the exact captured repository state.

- Started implementation and corrected KG-07's backlog dependency to include KG-03 and KG-04:
  edge lifecycle work consumes extracted node declarations and editorially materialized node
  identities, so it cannot safely begin from the database model and identity layer alone.
- Versioned inspection captures and finalized submission payloads at `1.1.0`. New payloads retain
  the complete structured node-extraction report plus server-derived prose/node publication
  targets; canonical `1.0.0` captures and submissions normalize to empty-node legacy behavior.
- Added the wizard's node review step and editorial candidate cards with escaped content and
  field-level extraction provenance. Editors select a subset in both direct decisions and formal
  review-round decisions; request schemas enforce local node ids, shared body limits, same-origin
  integrity, per-user rate limits, and server-side editor roles.
- Acceptance now re-verifies the submitted candidate report against the consumed capture inside
  one serializable compare-and-set transaction. The sorted selection and its SHA-256 are persisted,
  so an identical retry returns the original result and a different retry conflicts.
- Materialized each selected candidate as an immutable `KnowledgeNodeVersion`, invoking KG-02's
  repository/snapshot/submission/capture binding guard before every write. Node-only submissions
  create no review, mixed submissions keep the existing review path, author edge declarations stay
  private for KG-07, and claim backlinks are populated only when exact legacy claim ids coincide.
- Derive the example-identifier safety marker from every validated DOI-bearing node field itself,
  including envelope and kind-specific payload DOI fields. Materialization therefore remains safe
  even if a schema-valid extraction report omits or incompletely describes its DOI references.
- Re-check the actor's current editor/admin role at the formal-round decision service boundary,
  before acceptance or any other transition. A previously assigned editor whose role is downgraded
  cannot publish, close the round, write a decision letter, or emit publication/decision audits.
- Added per-node and aggregate audit events, conditional review events, and a minimal public
  `/nodes` listing sufficient to prove editorial publication without preempting KG-05's node detail,
  history, DOI-linking, graph, and API scope.
- Added integration coverage for all four node kinds, node-only and exact-subset publication,
  legacy capture normalization, identical/different retries, candidate tampering, cross-capture,
  repository, commit, and hash mismatch rollback, and reject/change-request privacy. The browser
  flow covers real submission/finalization and editorial APIs, role rejection, oversized bodies,
  default selection, public visibility, and escaped markup.
- Verified: lint, all 15 workspace typechecks, Prisma validate/generate and deterministic PostgreSQL
  schema/DDL generation, JSON schema checks, the production web build, 19 focused atomic
  publication tests, three formal-lifecycle integration tests, and the focused node-publication e2e
  pass. The repository test run completed 401 tests successfully; 10 tests in three pre-existing
  integration suites remain skipped/failing on Windows because they launch the extensionless Prisma shell shim directly
  (`spawnSync packages/db/node_modules/.bin/prisma ENOENT`). The complete browser suite passes all
  33 tests against a clean seeded database,
  including existing accessibility and editorial flows plus the new node-publication flow.

## KG-05 — Node pages: public UI + API (issue #40)

**Objective:** make accepted knowledge nodes independently discoverable and inspectable while
preserving immutable version identity, identifier roles, graph visibility, and relation-scoped
TRUST provenance.

- Expanded the declared package scope to `packages/contracts` for strict public node list,
  detail, history, archive-query, and response DTOs shared by server mapping, API routes, tests,
  and OpenAPI. The knowledge package was not expanded.
- Added stable `/nodes/{KnowledgeNode.id}` URLs plus exact historical version URLs and list,
  current-detail, history, and historical-detail JSON APIs. Stored contributor, provenance, and
  kind payload JSON is parsed against strict schemas; capture/submission payloads are never read
  or returned.
- Rendered claim, figure, dataset, and code payloads as escaped React text with accessible
  landmarks, labels, version history, repository/commit provenance, contributors, and machine
  endpoints. Safe schema.org metadata maps datasets and code to their specific types and passes
  through the existing script-safe JSON serializer.
- Preserved version, concept, and dataset-artifact DOI roles independently. Each `10.5555/*`
  value is marked and withheld from resolver links and JSON-LD without suppressing a real DOI in
  another role on the same node.
- Reused KG-07's centralized public edge predicate: publication requires confirmed status and
  provenance, an editorial confirmer who still holds that role, a confirmation timestamp, and an
  immutable target version owned by the stable target node. Outgoing relations bind the selected
  source version to that exact confirmed target version; inbound projection is limited to symmetric
  contradictions whose confirmed target version is the selected version. TRUST is shown only for
  an exact linked claim–citation relation in the selected snapshot, never as a node-level score.
- Integrated nodes into archive search with content-type and node-kind filters. Review and node
  candidates are merged, sorted deterministically, and only then paginated, preventing skipped or
  duplicated records at mixed-content page boundaries.
- Added strict-contract, JSON-LD, temporary-database integration, dynamically discovered browser,
  and axe coverage for payload validation, current/history selection, confirmed/proposed edges,
  TRUST scope, DOI safety, combined pagination, claim and dataset pages, and stable database ids.
- Bounded public request expansion to 2,000 archive node candidates, 200 listed versions, 200 edges
  per direction, 200 total claim–citation TRUST relations, and 50 assessments per relation. These
  are deliberate POC ceilings pending KG-08's database-native graph/search cursors:
  archive totals and history lists are capped, while an exact older version URL remains resolvable
  through a bounded point lookup. The standalone edge endpoint is likewise capped at 200 records,
  uses Node runtime/error handling, and returns an explicit no-store policy.
- Verified repository lint, all 15 workspace typechecks, JSON schemas, OpenAPI route coverage, and
  the production web build with the required build-only session secret. Nine focused contract,
  JSON-LD, and temporary-database tests pass, as do all 11 focused browser checks, including axe
  scans of the claim and dataset node pages. The reserved citation DOI regression proves that a
  `10.5555/*` DOI stays unlinked when raw citation metadata is absent or malformed.

## KG-10 — TRUST attachment for non-claim nodes (issue #45)

**Objective:** extend multidimensional TRUST assessment to dataset, code, and figure evidence
without ever turning TRUST into a score attached to a bare knowledge node.

- Preserved the original claim–citation `trustRecordSchema` and validator unchanged for existing
  consumers. Added a separately discriminated, strict node-relation record plus a combined import
  parser that routes every typed record through the new schema and rejects malformed hybrid
  records instead of falling back to the legacy shape.
- Required every node assessment to name both the claim and evidence endpoints, evidence kind,
  and semantic relation. Dataset/code relations use their specific `uses-*` edge or
  `derives-from`; figures use `derives-from`. Optional cross-repository targets are frozen by
  numeric GitHub repository ID and commit SHA. No bare-node contract exists.
- Added node-relation import normalization that retains source assessor, review-status, evidence,
  and aggregate assertions, but always exposes `unverified-import` and recomputes the advisory
  aggregate from criterion-level data.
- Added optional node-manifest JSONL routing for node-only TRUST. Mixed repositories fetch both
  routing manifests first and combine distinct node/review TRUST streams; the node route does not
  make a node-only capture publish prose.
- Added separate mandatory `NodeRelationTrustAssessment` and verification models in both SQLite
  and PostgreSQL schemas. Acceptance binds a record to exactly one accepted author proposal,
  including immutable cross-repository identity, while partial/prose-only selection skips it.
- Added a canonical node-relation reviewed subject whose SHA-256 covers the parsed raw assessment,
  all normalized fields, proposal and confirmed edge, both complete immutable node versions,
  stable ownership, repositories, snapshots, captures, submissions, and current confirmer role.
  Endpoint and relation-kind inconsistencies are rejected before hashing.
- Added an independent revision/hash CAS verification transaction, editorial queue support with
  exact version links, and a shared fail-closed public projection for node detail and standalone
  edge reads. Proposed/rejected/superseded or otherwise non-authoritative predicates remain
  private; compact summaries omit aggregates when criteria are not expanded.
- Documented the two subject forms, relation semantics, cross-repository addressing, import
  provenance, aggregate handling, and hash invalidation behavior in the TRUST model.
- Added focused contract, extractor, inspector, canonical-hash/lifecycle, database acceptance,
  CAS, queue, and public-projection coverage. The temporary SQLite integration proves node-only,
  partial/prose-only, local and cross-repository acceptance, confirmed publication, rejection and
  supersession preservation, stale markers, and standalone API parity. Lint, all 15 workspace
  typechecks, changed-file formatting, both Prisma schema validations, JSON schemas, OpenAPI route
  coverage, and 125 focused tests pass. The full repository run passed 509 tests and skipped 10;
  its three failures are pre-existing Windows-only suites that execute the extensionless Prisma
  shell shim and fail with `ENOENT`.

## KG-08 — Graph query API (issue #44)

**Objective:** provide a typed, bounded graph API for exact-version public nodes, confirmed
relations, and visibly labelled privacy-minimal proposals.

- Added strict graph query, node, edge, cursor-page, and response contracts. Requests require a
  stable seed node or keyword query, cap traversal depth at 3 and pages at 50 edges, and support
  node-kind, relation-type, edge-status, and exact-edge TRUST-presence filters. The contracts
  package is included because the public API needs one runtime-validated DTO shared by the web and
  future graph consumers.
- Extended the existing dependency-free `SearchProvider` with deterministic node-topic search.
  Only the newest strictly valid public node version enters its bounded 1,000-node POC index; a
  malformed current version is withheld rather than falling back to older content.
- Added `GET /api/graph` with the configured public-route rate budget, typed errors, no-store
  responses, HMAC-SHA256 signed keyset cursors, a 500-edge traversal-work ceiling, at most 10 topic
  seeds, and stable exact-version node/edge identifiers. Cursor verification is constant-time and
  binds the query, canonical last edge id, and complete candidate-set hash, rejecting tampering,
  query mismatch, and graph mutation. Node DTOs retain authoritative snapshot id, commit SHA,
  public provenance, and distinct DOI roles for KG-09 and later graph consumers.
- Reused KG-07's authoritative confirmed-edge predicate and KG-05's strict version parser.
  Confirmed traversal requires current editor/admin confirmation and an owned frozen target
  version. Directed edges are traversable from either endpoint, so contradictions are symmetric
  without reversing or duplicating their canonical id.
- Added an explicit `proposed` view for graph exploration. It reads only currently proposed
  `NodeEdgeProposal` rows and exposes exact endpoints, relation type, safe origin, rationale, and
  proposal time. Rejected/superseded proposals, evidence JSON, agent-run payloads, review notes,
  editor/reviewer identities, and audit data are neither selected for the DTO nor serialized.
  Existing node pages remain confirmed-only.
- Removed the earlier bare-node TRUST-presence approximation. Optional typed TRUST summaries now
  exist only on confirmed edges and include protocol, effective review status, and verification
  state. Aggregates are omitted because the compact graph projection does not expose the criteria
  needed to interpret them. The production batch provider is keyed by exact source version,
  target version, and relation type; it reconstructs KG-10's authoritative subject and selects the
  preferred current assessment. A single 10,001-row sentinel fails the optional projection closed
  above 10,000 rows, and any exact key with more than 50 assessments is omitted without truncating
  before status-precedence selection. Proposed edges can never carry TRUST.
- Converted all work ceilings to fail-closed typed errors: 1,001 topic rows reject the query, 501
  rows at a traversal frontier reject the query, and more than 500 unique cumulative edges reject
  rather than silently truncating. Stored nodes, edges, and provider TRUST values are safe-parsed
  independently so one malformed row is omitted without invalidating unrelated projections.
- Every success and error response carries `Cache-Control: no-store`; rate-budget headers report
  limit, remaining requests, and reset time on normal and error responses, with `Retry-After` on
  429 responses.
- Added contract/search unit coverage and a seeded SQLite integration graph covering symmetric
  contradictions, cursor pagination and query binding, topic seeds, exact provenance, filters,
  confirmed/proposed separation, and adversarial proposal privacy. The Windows test setup retains
  Prisma `db push` as its primary path and uses generated Prisma DDL through SQLite only when the
  known local schema-engine failure occurs.

## KG-09 — Graph explorer UI (issue #48)

**Objective:** make KG-08's bounded public graph navigable in an accessible, server-rendered
interface without creating a second query or privacy path.

- Added `/graph`, which calls `queryPublicGraph` directly in the server component and renders its
  validated public DTO. There is no internal HTTP round-trip, browser-side database query, or
  duplicate Prisma traversal. Invalid inputs and bounded-query failures receive safe, useful error
  states without leaking storage details.
- The ordered relation list is the authoritative view and works without JavaScript. Confirmed and
  proposed relations use text, filled versus hollow symbols, and solid versus dashed borders;
  contradictions additionally use a bar symbol and double border. Meaning therefore never depends
  on color. Every endpoint links to its exact immutable node version and can become a new seed.
- Filters cover node kind, relation type, publication status, depth, page size, and exact-relation
  TRUST presence. Signed KG-08 cursors and all bound query values are preserved in pagination links.
- Added narrow-screen layout, visible keyboard focus, reduced-motion compatibility, empty and error
  states, a primary-navigation entry, and node-page links into the explorer. All text is rendered as
  escaped React content. Identifiers are informational only in this compact view, and synthetic
  example DOIs are explicitly marked “example — not linked”.
- Added one deterministic, privacy-minimal proposed-edge seed fixture so confirmed/proposed
  presentation is exercised end to end. It contains no AgentRun, evidence, reviewer, audit, or
  editorial-note payload.

## KG-11 — Subgraph evidence packets (issue #49)

**Objective:** prepare reproducible, bounded graph-native evidence for long-form synthesis without
changing the legacy Atlas Discuss packet.

- Added a separate strict `SubgraphEvidencePacket` 1.0 contract and bounded-source contract. The
  shared contract package is intentionally in scope so KG-12 and later verification can validate
  the same exact references; Atlas Discuss `EvidencePacket` remains at 1.1.0 unchanged.
- Added a framework- and persistence-free builder over a trusted loader's supplied bounded domain.
  It validates selector-bound fingerprints, internal closure/counts, unique ownership, full exact
  node versions and per-node snapshot/commit provenance, confirmed/editor edges, contradiction
  inventory, and relation-bound TRUST state. The public paginated graph DTO is not treated as proof
  of complete topic selection.
- Added canonical node and identifier references bound to exact node versions. The internally
  derived citeable DOI whitelist preserves version/concept/artifact roles, normalizes DOI equality,
  excludes flagged and reserved-prefix examples, and prevents identifier-to-node laundering.
- Added canonical contradiction pairs with editor-confirmation provenance and TRUST summaries with
  criterion data, protocol/status/verification state, and a recomputed documented aggregate method.
  Stale/unverified TRUST cannot retain an authoritative review status.
- Added strict caps for nodes, edges, identifiers, UTF-8 text, and final canonical packet bytes;
  canonical sorting, strict JSON, SHA-256 preparation, no clock fields, and typed errors. Hostile
  source prose remains inert data and no artifact, network, code, private editorial, or AgentRun
  path is available.
- Added contract and builder tests covering all four node kinds, role-aware references, reserved
  `10.5555` exclusion, exact contradictions, TRUST laundering, bounds, non-finite numbers, forged
  ownership/whitelists, canonical topic identity, permutation invariance, input immutability, and
  hostile text.
- Verified 19 focused and 182 affected-package tests, all 15 workspace typechecks, lint, changed-file
  formatting, JSON schemas, OpenAPI route coverage, and diff hygiene. The full repository run passed
  550 tests and skipped 10; its three failures are the known Windows-only suites that execute the
  extensionless Prisma shell shim and fail during setup with `ENOENT`.

## KG-12 — Long-form review generator (issue #52)

**Objective:** generate sectioned synthesis reviews from KG-11 packets without admitting
unattributed model prose or bypassing durable run provenance.

- Added the strict `SynthesisReviewDocument` 1.0 contract: exactly six ordered sections, bounded
  single-paragraph text blocks, strict keys, no HTML/URLs/control text, total UTF-8 cap, and exact
  reference/node/version citation triples.
- Added pure, reusable writer seams for canonical packet revalidation, static prompt/request
  construction, strict raw JSON parsing, schema validation, grounding/prose-identifier validation,
  deterministic fallback, read-time acceptance verification, stable typed error codes, selection
  identity, and provider/model generation keys. These require no DB, clock, network, or recorder.
- Generalized `LlmProvider` to an explicit JSON completion request. Atlas Discuss keeps its existing
  prompt and behavior, while the Anthropic adapter is transport-only, enforces request-specific
  token/response-byte bounds, and returns text verbatim instead of extracting fenced JSON.
- Added a required recorder protocol and Prisma implementation. `AgentRun` is persisted as running
  before provider/fallback work, then succeeded or sanitized-failed before return. Fallback has
  explicit deterministic provider/model identity; provider failures never fall back. Exact packet
  JSON and validated canonical document JSON are retained, while rejected raw output, prompts,
  chain-of-thought, and source exception text are not.
- Added `promptHash` and `packetHash` to SQLite/PostgreSQL Prisma models and generated PostgreSQL DDL,
  plus contract, offline mock/provider, grounding/adversarial, recorder, fallback, and Prisma-backed
  integration coverage.
- Audit hardening normalizes prose with NFKC before scanning fullwidth and common DOI, PMID, and
  OpenAlex forms. Exact DOI matching tolerates terminal sentence punctuation without weakening
  reserved-prefix or fabricated-identifier rejection.
- The deterministic fallback now cites node references only after identifier-like prose is redacted,
  deduplicates endpoint citations, and applies a deterministic UTF-8 budget while retaining all six
  nonempty sections. A 24-node/24-edge near-bound fixture exercises actual budget reduction.
- Generation keys now bind the prompt hash as well as packet, prompt version, output schema,
  pipeline version, and model identity, so any prompt-byte change produces a distinct key.

## KG-19 — Grounding evaluation harness in CI (issue #56)

**Objective:** continuously prove that KG-12 grounding and instruction/data separation survive a
bounded adversarial corpus without requiring provider credentials in CI.

- Added a pure sequential evaluator that sends each fixture through the production synthesis
  request builder and exact parser/grounding validator, and also validates the deterministic
  fallback through that same boundary. No recorder, database, filesystem, clock, or network is
  available in the evaluator.
- Added auto-discovered one-file fixtures covering an exact DOI/node-reference baseline, unknown
  references, wrong node ownership/version, example references, fabricated and reserved-example
  DOIs, and prompt injection embedded in repository node text. The injection remains canonical
  user-packet data while the production system prompt stays byte-identical.
- Added the offline-default `pnpm eval:grounding` CLI, explicit bounded real-provider opt-in,
  deterministic privacy-minimal report v1, documented bounds and exit statuses, and a dedicated CI
  step with provider variables explicitly empty.
