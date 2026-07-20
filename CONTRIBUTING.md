# Contributing to Open Review Atlas

Thanks for your interest. This is a proof-of-concept; contributions that keep it focused,
transparent, and honest are especially welcome.

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm --filter @oratlas/db db:generate
pnpm --filter @oratlas/db db:push
pnpm --filter @oratlas/db db:seed
pnpm dev
```

## Before opening a pull request

Run the same checks CI runs:

```bash
pnpm lint
pnpm format:check     # or: pnpm format to auto-fix
pnpm typecheck
pnpm test
pnpm schema:check
pnpm --filter @oratlas/web build
pnpm --filter @oratlas/web test:e2e   # requires a seeded database
```

## Working from the canonical backlog

[`ORATLAS_BACKLOG.md`](ORATLAS_BACKLOG.md) is the active tracker. Human and automated
contributors use the same bounded loop:

1. Choose one unblocked item whose **Agent** field permits the proposed work. Do not decide a
   governance or scientific question in code; record it in
   [`ORATLAS_DECISIONS.md`](ORATLAS_DECISIONS.md) and mark the item blocked.
2. Use one branch and one pull request for that item. Prefix both with its stable ID, for example
   `ora-d01-multiple-assessments` and `ORA-D01: support multiple assessments`.
3. Keep the change to the item's stated scope and non-goals. Large items should be split into
   independently complete, reviewable slices rather than one oversized pull request.
4. Add or update tests for every affected contract, migration, permission boundary, and public
   behavior. CI fixtures must be frozen and deterministic; tests must not use live network data.
5. Run the verification bar from `CLAUDE.md`:

   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm schema:check
   pnpm --filter @oratlas/web build
   pnpm --filter @oratlas/web test:e2e   # when apps/web changes; requires a seeded database
   ```

6. In the same pull request, update only that backlog item's status and add its pull-request
   reference. Use `review` while the pull request is open and `done (PR #N)` after it lands.

Backlog work must preserve the platform's fail-closed invariants: accepted records and their hashes
are immutable; new facts become new records; imported assertions never become platform verification
without a valid platform-owned marker; and ratings or results from different assessment protocols
are never silently translated or combined. A failing invariant test is a specification to satisfy,
not a guard to weaken.

## Design principles (please preserve these)

- Prefer **transparent deterministic** validation over opaque AI classification.
- Prefer **immutable versioned** records over mutable metadata.
- Prefer **claim-level provenance** over document-level assertions.
- Keep **version DOI and concept DOI** distinct.
- Never present agent output as human-reviewed, and never present acceptance as peer review.
- Treat all repository content as untrusted; never render raw HTML from submitted repositories and
  never execute repository code.
- Keep domain logic in framework-free packages; keep the database out of the domain packages.

## Code style

TypeScript strict mode, ESLint + Prettier (config at the repo root). Internal packages export
TypeScript source and are transpiled by Next.js. Match the surrounding code's conventions.

## Tests

Add or update tests for new behavior. External APIs (GitHub, Zenodo, LLM providers) must be
**mocked** — the suite must not depend on network availability.

## Reporting security issues

See [`SECURITY.md`](SECURITY.md).
