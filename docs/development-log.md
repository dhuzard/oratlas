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
