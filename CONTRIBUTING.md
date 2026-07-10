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
