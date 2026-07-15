# Architecture

Open Review Atlas is a TypeScript pnpm monorepo. The web application is server-rendered
Next.js (App Router); domain logic lives in framework-free packages so it can be tested in
isolation and reused by CLI scripts.

```
apps/
  web/                 Next.js App Router application (UI + API routes)
packages/
  contracts/           Zod schemas, shared types, review-manifest JSON Schema
  config/              Environment parsing and shared runtime config
  db/                  Prisma schema + client + seed (SQLite dev, PostgreSQL-compatible)
  github/              GitHub URL safety + bounded repository inspection client
  zenodo/              DOI normalization/resolution + Zenodo metadata matching
  extractor/           Deterministic metadata & artifact extraction, compatibility report
  trust/               TRUST assessment validation and documented aggregation
  atlas-check/         Local TRUST/FAIR evidence evaluator and GitHub annotation renderer
  protocols/           Offline registry adapters and neutral protocol-drift comparison
  execution-passports/ Offline Workflow Run crate + signed-attestation verification
  knowledge/           Search provider, evidence packets, discussion engine, link proposals
  ui/                  Reusable accessible React primitives
scripts/               Ingestion / validation / maintenance CLIs (tsx)
docs/                  Architecture, governance, schema and deployment documentation
```

## Layering

```
apps/web (routes, server actions, API)
   │  uses
   ▼
packages/knowledge ── packages/extractor ── packages/trust
   │                        │
   ▼                        ▼
packages/github      packages/zenodo
   │                        │
   └────────┬───────────────┘
            ▼
packages/contracts (types + runtime validation, no dependencies on other packages)
packages/db (persistence; consumed by web + scripts, not by domain packages)
packages/atlas-check (bounded local evidence CI; depends only on contracts + Zod)
```

Domain packages never import Prisma. They accept and return plain typed values
(validated by `packages/contracts`), so persistence and transport are swappable and tests
need no database.

## Key flows

### Submission and ingestion

1. **Repository step** — a signed-in user pastes a GitHub URL and explicitly chooses the default
   branch, an exact tag, or an exact published release. `packages/github` normalizes it and
   rejects non-GitHub hosts, credentials, malformed URLs, and local-network targets
   (SSRF prevention). Only `https://github.com/{owner}/{repo}` survives.
2. **Inspect step** — `InspectionService` (server-side only) fetches repository metadata,
   license, topics, default branch, latest commit, tags, releases, Pages URL, and a
   bounded set of well-known files (README, `CITATION.cff`, `.zenodo.json`,
   `codemeta.json`, `myst.yml`, `review-manifest.json`, bibliography, knowledge JSONL
   artifacts…) via the GitHub REST API with explicit timeouts, max file counts/sizes,
   and total byte caps. Repositories are **never cloned** and no repository code is ever
   executed. Published-release classification uses `/releases/tags/{tag}`; annotated tags are
   dereferenced with a depth/cycle bound. Atlas resolves the selected commit object, traverses its
   `tree.sha`, and fetches content with `ref=<selected commit>`. Inspection runs synchronously behind an `IngestionRunner` interface so a
   queue can replace it later without touching callers.
3. **Extraction** — `packages/extractor` derives metadata deterministically in priority
   order (manifest → CITATION.cff → .zenodo.json → codemeta.json → MyST config → repo
   metadata → README heuristics) and records field-level provenance (file, path, commit,
   extractor version, timestamp, confidence). It also parses claims / citations /
   relations / TRUST JSONL artifacts and produces the transparent compatibility report.
4. **Review & correct** — the wizard shows extracted values; edits are stored separately
   from extracted values with editor identity and timestamps.
5. **Validation** — DOI validation (`packages/zenodo`) returns a structured report with
   hard errors, warnings, per-check outcomes and a confidence level. Version DOIs and
   concept DOIs are distinct fields end-to-end.
6. **Capture** — exact canonical inspection/extraction/validation bytes are stored in a separate
   append-only capture. A random 30-minute, single-use capability is stored only as a hash and is
   bound to the authenticated inspector.
7. **Finalize** — the capability is consumed transactionally; GitHub is not called again. The
   immutable `RepositorySnapshot` is deduplicated by stable GitHub repository id + commit, while
   every reinspection remains independently auditable. Ref/release selection stays on the
   `Submission` and accepted `ReviewVersion`, not on the shared commit snapshot.
8. **Editorial decision** — a database-only, SQLite-retry-bounded transaction claims the status by
   compare-and-set, creates/updates the review and immutable version, materializes evidence, stores
   check-scoped overrides, and emits idempotent audits. Any failure rolls everything back.

### Search

`SearchProvider` interface with a deterministic in-process lexical index over accepted
records (no external services). PostgreSQL FTS or an external engine can be added behind
the same interface later.

### Grounded discussion (Atlas Discuss)

The knowledge unit is an **evidence packet** built from review metadata, claims (with
anchors), citations, claim–evidence relations, TRUST assessments, version/commit/DOI, and
provenance — not raw text chunks.

Claim/citation ids are globally namespaced by immutable review version while their source-local
ids remain available. Citation equality across reviews uses canonical DOI/PMID/OpenAlex aliases;
conflicting alias assertions are surfaced and excluded from automatic merging. See
`docs/evidence-identity.md`.

- **Deterministic mode** (no LLM key): lexical claim retrieval grouped by topic and
  relation, returned as a structured evidence summary. No generated prose.
- **LLM mode**: a provider-neutral `LlmProvider` adapter receives only the evidence
  packet, must return JSON validated against the Zod answer schema, and every statement must cite
  exact claim→citation edges present in that packet. Unknown ids, nonexistent edges, and summary
  mismatches are rejected and retried once. The exact canonical packet bytes are hashed, sent and
  persisted with model/provider/prompt provenance in an `AgentRun`. Chain-of-thought is never
  exposed.

### Cross-review knowledge links

Conservative deterministic proposals (shared canonical DOI/PMID/OpenAlex aliases, normalized claim-text
similarity) stored as reviewable proposals (`proposed/accepted/rejected/superseded`),
always labelled as unreviewed until a human decision.

## Trust boundaries

- All repository content is untrusted: rendered as plain text (React escaping), never as
  HTML; artifact paths validated against traversal; no code execution; no builds of
  submitted repositories.
- GitHub/Zenodo/DOI requests are server-side with timeouts; tokens never reach the
  browser.
- Sessions are HMAC-signed httpOnly cookies; editorial routes check roles server-side;
  mutating routes are rate limited and size limited; editorial actions are audited.
- Execution Passports retain the no-execution boundary: exact crate/digest/claim bindings and an
  Ed25519 identity are verified offline against an explicit operator trust policy. See
  [Execution Passports](execution-passports.md).

## Authentication

Minimal GitHub identity (id, login, avatar, profile URL). GitHub OAuth activates when
`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are configured; otherwise development offers an
explicit, clearly-labelled mock sign-in (`AUTH_MOCK=1`) which is refused in production.

## Replaceability decisions

| Concern   | POC implementation                      | Replacement path                                |
| --------- | --------------------------------------- | ----------------------------------------------- |
| Ingestion | synchronous `IngestionRunner`           | queue/worker behind same interface              |
| Search    | in-process lexical index                | `SearchProvider` for Postgres FTS/engine        |
| LLM       | Anthropic adapter (optional)            | any `LlmProvider` implementation                |
| DB        | SQLite                                  | PostgreSQL (schema avoids SQLite-only features) |
| Auth      | cookie sessions + optional GitHub OAuth | full OAuth/OIDC provider                        |
