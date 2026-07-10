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
  AgentRun, DiscussionThread, DiscussionMessage, KnowledgeLinkProposal, AuditEvent.
- SQLite provider; Postgres-compatible by construction (enums→String validated by
  contracts, JSON→String columns, arrays→JSON strings). SQLite file resolves
  schema-relative to `packages/db/prisma/dev.db`, stable across web app and scripts.
- Seed loads: DOI review (release + example Zenodo DOI), repository-only review,
  template structural demo, pending submission, 5 claims, 4 citations, 5 relations
  (incl. a `contradicts`), 5 TRUST records (4 agent-proposed + 1 human-reviewed), 1
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
- `@oratlas/trust`: `validateTrustRecord`, `computeAggregate` (mean of *assessed* ordinals
  only, never treating not-assessed/not-applicable as zero, always tagged
  `ordinal-mean-1.0`), `ordinalAtLeast`. Aggregate is optional; criterion record authoritative.
- Added `@oratlas/github/fixtures` subpath so extractor tests reuse GitHub fixtures.
- Verified: typecheck clean; 12 new tests; full suite 65/65 passing, zero network.
