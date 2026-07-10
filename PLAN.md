# Open Review Atlas — Implementation Plan

Open Review Atlas is a proof-of-concept public archive for AI-enriched computational
literature reviews produced from GitHub repositories that are built with, forked from, or
structurally compatible with
[AllenNeuralDynamics/ComputationalReviewTemplate](https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate).

Authors do not upload manuscripts. They submit a public GitHub repository URL; the
platform inspects the repository, extracts metadata deterministically, validates optional
Zenodo DOIs, and — after an editorial decision — publishes an immutable, versioned review
record with claims, citations, claim-level TRUST assessments, and a grounded cross-review
discussion assistant.

## Reference template findings (inspected 2026-07-10)

- MyST project: `myst.yml` (project title/keywords/license, `bibliography: content/references.bib`, toc, exports, GitHub Pages deploy).
- Content: `content/00_frontmatter.md`, `content/01_introduction.md`, `content/Methods.md`, `content/evidence_database.md`, `content/provenance.md`, `content/authors.yml`, `content/references.bib`.
- Directories: `evidence/`, `provenance/`, `figures/`, `plugins/` (evidence-explorer), `skills/`, `.github/workflows/`.
- MIT license, GitHub release `v1.0.0`, a Zenodo DOI in the README, GitHub Pages site.

These drive the transparent compatibility heuristics in `packages/extractor`.

## Architecture summary

TypeScript pnpm monorepo:

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js (App Router) public archive, submission wizard, editorial dashboard, Atlas Discuss |
| `packages/contracts` | Zod schemas + shared types + review-manifest JSON Schema |
| `packages/db` | Prisma schema (SQLite dev / PostgreSQL-compatible), client, seed |
| `packages/github` | SSRF-safe GitHub URL validation + bounded repository inspection |
| `packages/zenodo` | DOI normalization/resolution + Zenodo metadata matching |
| `packages/extractor` | Deterministic metadata/artifact extraction + compatibility classification |
| `packages/trust` | TRUST records, validation, documented aggregation |
| `packages/knowledge` | Search provider, evidence packets, deterministic + LLM discussion, link proposals |
| `packages/ui` | Reusable accessible UI primitives |
| `packages/config` | Shared env parsing/config helpers |
| `scripts` | Ingestion, DOI validation, JSON Schema checks |
| `docs` | Architecture, governance, schemas, deployment |

Full details: `docs/architecture.md`.

## Implementation backlog

1. **PR-00 Repository initialization** — pnpm workspace, TS/ESLint/Prettier/Vitest config, `.env.example`, PLAN, docs skeleton, dev log.
2. **PR-01 Shared contracts and schemas** — Zod schemas for manifest, inspection & compatibility reports, DOI validation results, submission statuses, TRUST enums, discussion answers; `review-manifest.schema.json`; artifact-path safety; tests.
3. **PR-02 Database model and seed data** — Prisma schema per spec (User, Repository, RepositorySnapshot, Review, ReviewVersion, Person, ReviewContributor, Submission, Identifier, Claim, Citation, ClaimEvidenceRelation, TrustAssessment, AgentRun, DiscussionThread, DiscussionMessage, AuditEvent, KnowledgeLinkProposal); seed with repository-only review, DOI review, pending submission, claims/citations/relations/TRUST, one link proposal.
4. **PR-03 GitHub repository inspection** — canonical URL normalization, unsafe-URL rejection, bounded tree/content fetching with timeouts and size caps, inspection report, mockable transport, tests.
5. **PR-04 DOI and Zenodo validation** — DOI normalization, doi.org resolution, Zenodo record lookup, structured match report (errors vs warnings vs confidence), version vs concept DOI, tests.
6. **PR-05 Extraction + TRUST** — priority-ordered deterministic extraction with field-level provenance; claims/citations/relations/trust JSONL artifact ingestion; compatibility levels; TRUST validation and documented aggregation; tests.
7. **PR-06 Knowledge layer** — `SearchProvider` + in-process lexical index, claim search, evidence packet builder, deterministic discussion mode, provider-neutral LLM adapter with Zod-validated grounded output, cross-review link proposals; tests.
8. **PR-07 Web app core** — home, archive, review pages, claim explorer, 5-step submission wizard, API routes, auth (mock + optional GitHub OAuth), rate limiting, snapshots.
9. **PR-08 Discussion UI + editorial** — Atlas Discuss page, editorial dashboard (accept/reject/request changes, notes, metadata diff, immutable snapshot view), audit log.
10. **PR-09 Scripts, CI, e2e** — ingestion/validation scripts, GitHub Actions (install/lint/typecheck/tests/build/prisma validate/JSON Schema validate/Playwright), essential e2e flows.
11. **PR-10 Documentation & hardening** — all `docs/*`, README, SECURITY, CONTRIBUTING, OpenAPI document, accessibility pass, final verification.

Progress and outcomes per slice are recorded in `docs/development-log.md`.

## Non-goals (POC boundary)

File uploads, private repositories, DOI minting, full peer-review management, manuscript
editing, billing, SSO, social networking, autonomous publication, automated
knowledge-consensus. See `docs/poc-limitations.md`.
