# Open Review Atlas

**A proof-of-concept public archive for discovering, submitting, validating, archiving, and
discussing AI-enriched computational literature reviews produced from GitHub repositories.**

Authors do not upload manuscripts. They submit the URL of a public GitHub repository containing
a review built with, forked from, or structurally compatible with the
[AllenNeuralDynamics/ComputationalReviewTemplate](https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate).
The platform inspects the repository, extracts metadata deterministically, validates optional
Zenodo DOIs, and — after an editorial decision — publishes an immutable, versioned review record
with claims, citations, claim-level TRUST assessments, and a grounded cross-review discussion
assistant (Atlas Discuss), plus human-published replication briefs from transparent evidence-gap
triage. Claims, figures, datasets, and code are first-class immutable graph nodes; bounded node
subgraphs can generate private AI synthesis drafts that become public only after explicit editor
acceptance under the [AI synthesis governance policy](docs/synthesis-governance.md).

> **This platform does not perform peer review** and does not present AI-generated conclusions as
> established scientific consensus. See [What the platform does not verify](#what-the-platform-does-not-verify).

## Key pages

The POC ships a restrained, scholarly server-rendered interface:

- **Home** — product explanation, search, recently accepted reviews, domain/DOI/TRUST filters,
  provenance legend.
- **Archive** — full-text search + faceted filters.
- **Review page** — safe archived article reader and TOC, exact claim anchors, repository/commit,
  provenance, claims, citations, TRUST, canonical version diff, and lifecycle notices.
- **Submission wizard** — repository → inspect → editable metadata (with per-field provenance) →
  validation → submit.
- **Atlas Discuss** — grounded cross-review discussion.
- **AI synthesis review** — editor-accepted, software-generated long-form review with exact
  node-version citations, public generation/editor provenance, rights, and immutable lineage.
- **Replication Marketplace** — deterministic evidence-gap triage and human-published, scoped
  replication briefs with attributable claiming/completion. See
  [`docs/replication-marketplace.md`](docs/replication-marketplace.md).
- **Editorial dashboard** — validation reports, metadata diff, accept/reject, audit log.

## Architecture summary

TypeScript `pnpm` monorepo. Framework-free domain packages are tested in isolation and reused by
CLI scripts; the web app is server-rendered Next.js (App Router).

| Path                           | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `apps/web`                     | Next.js App Router UI + API routes                                   |
| `packages/contracts`           | Zod schemas, shared types, review-manifest JSON Schema               |
| `packages/config`              | Environment parsing / runtime config                                 |
| `packages/db`                  | Prisma schema + client + seed (SQLite dev, PostgreSQL-compatible)    |
| `packages/github`              | SSRF-safe GitHub URL validation + bounded inspection                 |
| `packages/zenodo`              | DOI normalization/resolution + Zenodo metadata matching              |
| `packages/extractor`           | Deterministic metadata/artifact extraction + compatibility report    |
| `packages/exports`             | Standards exports: CSL/BibTeX/RIS, JATS, RO-Crate, PROV, SWHID, Atom |
| `packages/trust`               | TRUST validation and documented aggregation                          |
| `packages/atlas-check`         | Deterministic TRUST/FAIR evidence CI and GitHub annotations          |
| `packages/protocols`           | Offline registry adapters and neutral protocol-drift comparison      |
| `packages/execution-passports` | Offline signed Workflow Run provenance verification                  |
| `packages/federation`          | COAR Notify review exchange validation and immutable projections     |
| `packages/knowledge`           | Search, evidence packets, discussion, replication marketplace        |
| `packages/ui`                  | Reusable accessible React primitives                                 |
| `scripts`                      | Ingestion / validation CLIs                                          |
| `docs`                         | Architecture, governance, schemas, deployment                        |

Full detail: [`docs/architecture.md`](docs/architecture.md).

## Local setup

Requirements: Node ≥ 20.9, `pnpm` 10.

```bash
pnpm install
cp .env.example .env                    # sensible local defaults (SQLite, mock auth)
pnpm --filter @oratlas/db db:generate   # generate the Prisma client
pnpm db:push                            # create the SQLite schema
pnpm db:seed                            # load realistic example data
pnpm dev                                # http://localhost:3000
```

The SQLite database lives at `packages/db/prisma/dev.db` (resolved relative to the Prisma schema,
so it is stable across the web app and CLI scripts).

## Environment variables

All documented in [`.env.example`](.env.example). Summary:

| Variable                                           | Required | Purpose                                                        |
| -------------------------------------------------- | -------- | -------------------------------------------------------------- |
| `DATABASE_URL`                                     | yes      | SQLite (`file:./dev.db`) locally; PostgreSQL URL in production |
| `SESSION_SECRET`                                   | prod     | HMAC secret for session cookies (required in production)       |
| `GITHUB_TOKEN`                                     | no       | Raises GitHub API rate limits; server-side only                |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`        | no       | Enables real GitHub OAuth                                      |
| `AUTH_MOCK`                                        | no       | `1` enables the dev-only mock sign-in (ignored in production)  |
| `LLM_PROVIDER` / `ANTHROPIC_API_KEY` / `LLM_MODEL` | no       | Enables Atlas Discuss LLM mode                                 |
| `NEXT_PUBLIC_BASE_URL`                             | no       | Canonical base URL for links / Open Graph                      |
| `EXECUTION_PASSPORT_TRUSTED_KEYS_JSON`             | no       | Explicit offline Ed25519 signer trust policy                   |

No paid external service is required to run the POC. Without an LLM key, Atlas Discuss runs in
deterministic mode. Without OAuth credentials, development offers a clearly-marked mock sign-in.

## Database commands

```bash
pnpm db:push                           # apply schema to the database
pnpm db:seed                           # load example data
pnpm db:reset                          # delete SQLite db, re-push, re-seed (dev only)
pnpm --filter @oratlas/db db:validate  # validate the Prisma schema
```

## Seeding

`db:seed` loads: an accepted review **with** a GitHub release and a (synthetic) Zenodo DOI, an
accepted **repository-only** review, the reference template as a structural demonstration, a
**pending** submission, multiple claims/citations, supporting and contradicting relations, five
repository TRUST assertions (including an explicit-null source aggregate), one separate Atlas
structural-review marker, and one cross-review link proposal.

All example identifiers use the reserved documentation DOI prefix `10.5555/` and are flagged so
the UI never renders them as resolvable outbound links.

## Testing

```bash
pnpm test           # Vitest unit/integration tests (no network)
pnpm typecheck      # strict TypeScript across all packages
pnpm lint           # ESLint
pnpm format:check   # Prettier
pnpm schema:check   # validate the review-manifest JSON Schema
pnpm openapi:check  # detect drift between docs/openapi.yaml and the API routes
pnpm build          # production build
pnpm test:e2e       # essential Playwright flows (needs a seeded db)
```

Tests never depend on GitHub or Zenodo network availability — external APIs are mocked.

## CLI tools

The domain packages are framework-free and reusable from the command line:

```bash
pnpm ingest https://github.com/owner/repository   # inspect + extract; read-only, prints JSON
pnpm validate-doi 10.5281/zenodo.1234567 [--repo <url>] [--title <title>]
pnpm atlas-check --root <directory>               # deterministic evidence CI (--help for options)
pnpm backup                                       # copy the SQLite db to backups/ (prints pg_dump advice for Postgres)
```

`ingest` inspects a public GitHub repository via the API (never cloned, never executed) and
prints the extraction result — metadata, compatibility, knowledge counts — without writing to
the database; `GITHUB_TOKEN` raises rate limits. `validate-doi` prints the structured DOI
validation report; reserved example DOIs (`10.5555/*`) are never resolved outward.
`atlas-check` evaluates `TRUST.md`, `FAIR.md`, and review-manifest evidence artifacts with no
network, LLM, or code execution — see [`docs/atlas-check.md`](docs/atlas-check.md).

## Deployment

Deployable to any Node-compatible platform. Set `DATABASE_URL` to PostgreSQL, change the Prisma
datasource provider to `postgresql`, set `SESSION_SECRET`, run `prisma migrate deploy`, then
`pnpm --filter @oratlas/web build && pnpm --filter @oratlas/web start`. See
[`docs/deployment.md`](docs/deployment.md).

## How authors submit a GitHub review

1. Sign in with GitHub (or the dev mock).
2. Paste a **public** GitHub repository URL. The platform normalizes and validates it
   (rejecting non-GitHub hosts, credentials, local-network targets — SSRF-safe).
3. Explicitly choose the current default branch, an exact tag, or an exact published release.
   The repository is **inspected via the GitHub API** (never cloned, never executed) with timeouts
   and size caps. Atlas pins the resolved commit and its tree SHA; metadata is extracted
   deterministically with per-field provenance.
4. Review and correct the extracted metadata. Edits are stored separately from extracted values.
5. Review the validation report (compatibility, DOI validation, release, completeness, evidence
   and TRUST availability).
6. Submit the user-bound, 30-minute, single-use capture capability. GitHub is not read again.
   The canonical capture and immutable snapshot enter the editorial workflow.
7. An editor accepts, rejects, or requests changes. Acceptance is transactional and idempotent;
   failed release/DOI/commit checks require separate, audited override rationales.

Accepted Markdown is read from the durable database snapshot with no active repository HTML.
Corrections link immutable versions; withdrawals remain visibly marked but leave Atlas Discuss;
tombstones fail closed across pages, APIs, comments, search, claims, discussion, assets, exports
and feeds. See [`docs/article-lifecycle.md`](docs/article-lifecycle.md).

You do **not** need to own the submitted repository; you are recorded as the submitter, distinct
from the repository's authors and maintainers.

## How Zenodo DOI linking works

A GitHub repository and a DOI are different identifiers, and the platform keeps them distinct:

- a **commit SHA + tree SHA** identify the exact repository state Atlas read,
- a **release/tag** identifies a named version,
- a **version DOI** identifies one deposited release,
- a **concept DOI** identifies the collection of all versions.

When you supply or the platform detects a DOI, it is normalized (`doi:…`, `https://doi.org/…`,
raw), resolved through DOI infrastructure, and — for Zenodo DOIs — compared against public Zenodo
metadata (repository URL, title, creators, release tag, publication date). The result is a
**structured report** with hard errors, warnings, per-check outcomes, and a confidence level; a
review is not rejected merely because metadata differ slightly. Version DOI and concept DOI are
stored in separate fields and never conflated. See
[`docs/doi-and-versioning.md`](docs/doi-and-versioning.md).

When no DOI is found, the review is accepted as **repository-only** (if other requirements pass),
with a non-blocking recommendation to connect the repository to Zenodo and publish a GitHub
release. The platform never mints, reserves, or pretends to create a DOI, and never asks for a
Zenodo access token.

## What the platform does not verify

- **Acceptance into the archive is not peer review.** It is an editorial curation decision.
- **TRUST is relation-specific.** Each assessment describes one claim–citation relation, never a
  whole paper, and is never a probability that a paper is "true."
- **Atlas Check is structural evidence CI.** It checks `TRUST.md`, `FAIR.md`, and the declared
  evidence graph without an LLM or network access; see [the rule catalog](docs/atlas-check.md).
- **Repository and agent TRUST records are source assertions.** Atlas preserves their claimed
  status but imports them as unverified. A separate hash-bound editor marker can record structural
  review; it does not establish scientific correctness.
- **A DOI does not establish scientific quality.** DOI presence is not a quality signal.
- **GitHub default-branch content may differ from a deposited release.** The exact reviewed state
  is the explicitly selected commit and tree SHA.
- **Several reviews citing the same primary source are not independent replication.**
- **Replication briefs are editorial opportunities, not promises or truth scores.** Atlas does not
  rank researchers, predict outcomes, execute studies, initiate payments, or automatically
  publish briefs; a completion record is not an endorsement of the reported result.
- **AI synthesis acceptance is curation, not human authorship or scientific endorsement.** The
  synthesis writer is disclosed as software; the named editor is accountable for the publication
  decision/checklist. Acceptance does not establish peer review, correctness, consensus, or TRUST.

A full inventory of limitations lives in [`docs/poc-limitations.md`](docs/poc-limitations.md).

## Documentation

| Document                                                                                       | Contents                                                  |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)                                                 | Monorepo layout, package boundaries, swappable interfaces |
| [`docs/data-model.md`](docs/data-model.md)                                                     | Prisma schema walkthrough                                 |
| [`docs/submission-workflow.md`](docs/submission-workflow.md)                                   | UI flow, capture capability, editorial pipeline           |
| [`docs/article-lifecycle.md`](docs/article-lifecycle.md)                                       | Article reader, version diff, corrections, tombstones     |
| [`docs/doi-and-versioning.md`](docs/doi-and-versioning.md)                                     | Version vs concept DOI, validation report semantics       |
| [`docs/trust-model.md`](docs/trust-model.md)                                                   | TRUST dimensions, relation-level attachment, aggregation  |
| [`docs/assessment-protocol-interoperability.md`](docs/assessment-protocol-interoperability.md) | Source-protocol preservation and non-crosswalk rules      |
| [`docs/evidence-identity.md`](docs/evidence-identity.md)                                       | Evidence identifiers and structural grounding             |
| [`docs/review-manifest.md`](docs/review-manifest.md)                                           | Optional `review-manifest.json` format                    |
| [`docs/atlas-check.md`](docs/atlas-check.md)                                                   | Deterministic evidence CI rule catalog                    |
| [`docs/living-review.md`](docs/living-review.md)                                               | Claim passports and living-review monitoring              |
| [`docs/synthesis-and-contradictions.md`](docs/synthesis-and-contradictions.md)                 | Independence-aware synthesis and contradiction maps       |
| [`docs/replication-marketplace.md`](docs/replication-marketplace.md)                           | Evidence-gap triage and replication briefs                |
| [`docs/protocol-drift-radar.md`](docs/protocol-drift-radar.md)                                 | Protocol-registry snapshot comparison                     |
| [`docs/execution-passports.md`](docs/execution-passports.md)                                   | Offline signed workflow-run provenance verification       |
| [`docs/federation.md`](docs/federation.md)                                                     | COAR Notify review exchange                               |
| [`docs/preservation-and-exports.md`](docs/preservation-and-exports.md)                         | Standards exports and preservation artifacts              |
| [`docs/editorial-governance.md`](docs/editorial-governance.md)                                 | Roles, decisions, overrides, audit                        |
| [`docs/agent-governance.md`](docs/agent-governance.md)                                         | How automated agents are bounded and supervised           |
| [`docs/synthesis-governance.md`](docs/synthesis-governance.md)                                 | Normative AI attribution, disclosure, rights, incidents   |
| [`docs/synthesis-editorial.md`](docs/synthesis-editorial.md)                                   | Private draft and editor-acceptance lifecycle             |
| [`docs/deployment.md`](docs/deployment.md)                                                     | Production deployment                                     |
| [`docs/operations/`](docs/operations/README.md)                                                | Backups, observability, Postgres, privacy & takedown      |
| [`docs/poc-limitations.md`](docs/poc-limitations.md)                                           | What the POC deliberately does not do                     |
| [`docs/openapi.yaml`](docs/openapi.yaml)                                                       | API description                                           |
| [`PLAN.md`](PLAN.md)                                                                           | Implementation plan and backlog                           |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development workflow and expectations,
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for community standards, and
[`SECURITY.md`](SECURITY.md) for how to report vulnerabilities.

## License

MIT — see [`LICENSE`](LICENSE).
