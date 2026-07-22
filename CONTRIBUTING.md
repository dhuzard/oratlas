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

1. Choose one unblocked item whose **Agent** field permits the proposed work. Implement only
   governance and scientific semantics already ratified in
   [`ORATLAS_DECISIONS.md`](ORATLAS_DECISIONS.md); record genuinely new questions there and mark
   affected work blocked.
2. Keep each item's work in an ORA-prefixed commit series, for example
   `ORA-D01: support multiple assessments`. Group related series into the outcome-based branches
   and pull requests defined by [`INTEGRATION_TRAINS.md`](INTEGRATION_TRAINS.md). Use an item-level
   pull request only when an urgent security fix requires isolation.
3. Keep each commit series within its item's stated scope and non-goals. Split large items into
   independently complete slices inside the same integration train.
4. Add or update tests for every affected contract, migration, permission boundary, and public
   behavior. CI fixtures must be frozen and deterministic; tests must not use live network data.
5. Run the verification bar from `CLAUDE.md`:

   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm schema:check
   pnpm --filter @oratlas/web build
   pnpm --filter @oratlas/web test:e2e   # when apps/web changes; requires a seeded database
   ```

6. Reconcile all included backlog items once per integration pull request. Use `review` while the
   train is open and `done (integration PR #N)` after it lands. Preserve source PR heads and commit
   mappings in `INTEGRATION_TRAINS.md` until the train is verified.

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
