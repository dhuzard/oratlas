# Open Review Atlas

**A proof-of-concept public archive for discovering, submitting, validating, archiving, and
discussing AI-enriched computational literature reviews produced from GitHub repositories.**

Authors do not upload manuscripts. They submit the URL of a public GitHub repository containing
a review built with, forked from, or structurally compatible with the
[AllenNeuralDynamics/ComputationalReviewTemplate](https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate).
The platform inspects the repository, extracts metadata deterministically, validates optional
Zenodo DOIs, and — after an editorial decision — publishes an immutable, versioned review record
with claims, citations, claim-level TRUST assessments, and a grounded cross-review discussion
assistant (Atlas Discuss).

> **This platform does not perform peer review** and does not present AI-generated conclusions as
> established scientific consensus. See [What the platform does not verify](#what-the-platform-does-not-verify).

## Screenshots / placeholders

The POC ships a restrained, scholarly server-rendered interface. Key pages:

- **Home** — product explanation, search, recently accepted reviews, domain/DOI/TRUST filters,
  provenance legend. _(placeholder: `docs/screenshots/home.png`)_
- **Archive** — full-text search + faceted filters. _(placeholder: `docs/screenshots/archive.png`)_
- **Review page** — safe archived article reader and TOC, exact claim anchors, repository/commit,
  provenance, claims, citations, TRUST, canonical version diff, and lifecycle notices.
  _(placeholder: `docs/screenshots/review.png`)_
- **Submission wizard** — repository → inspect → editable metadata (with per-field provenance) →
  validation → submit. _(placeholder: `docs/screenshots/submit.png`)_
- **Atlas Discuss** — grounded cross-review discussion. _(placeholder: `docs/screenshots/discuss.png`)_
- **Editorial dashboard** — validation reports, metadata diff, accept/reject, audit log.
  _(placeholder: `docs/screenshots/editorial.png`)_

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
| `packages/execution-passports` | Offline signed Workflow Run provenance verification                  |
| `packages/knowledge`           | Search, evidence packets, discussion, cross-review links             |
| `packages/ui`                  | Reusable accessible React primitives                                 |
| `scripts`                      | Ingestion / validation CLIs                                          |
| `docs`                         | Architecture, governance, schemas, deployment                        |

Full detail: [`docs/architecture.md`](docs/architecture.md).

## Local setup

Requirements: Node ≥ 20.9, `pnpm` 10.

```bash
pnpm install
cp .env.example .env               # sensible local defaults (SQLite, mock auth)
pnpm --filter @oratlas/db db:generate
pnpm --filter @oratlas/db db:push  # create the SQLite schema
pnpm --filter @oratlas/db db:seed  # load realistic example data
pnpm dev                           # http://localhost:3000
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
pnpm --filter @oratlas/db db:push      # apply schema to the database
pnpm --filter @oratlas/db db:seed      # load example data
pnpm --filter @oratlas/db db:reset     # delete SQLite db, re-push, re-seed (dev only)
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
pnpm --filter @oratlas/web build       # production build
pnpm --filter @oratlas/web test:e2e    # essential Playwright flows
```

Tests never depend on GitHub or Zenodo network availability — external APIs are mocked.

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
- **Repository and agent TRUST records are source assertions.** Atlas preserves their claimed
  status but imports them as unverified. A separate hash-bound editor marker can record structural
  review; it does not establish scientific correctness.
- **A DOI does not establish scientific quality.** DOI presence is not a quality signal.
- **GitHub default-branch content may differ from a deposited release.** The exact reviewed state
  is the explicitly selected commit and tree SHA.
- **Several reviews citing the same primary source are not independent replication.**

## License

MIT — see [`LICENSE`](LICENSE).
