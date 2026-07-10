# Open Review Atlas — repository guide

TypeScript `pnpm` monorepo. A POC public archive for AI-enriched computational literature reviews
built from GitHub repositories. See `PLAN.md` and `docs/architecture.md` for the full picture.

## Layout

- `apps/web` — Next.js App Router (UI + API routes). Domain logic lives in `packages/*`.
- `packages/contracts` — Zod schemas + shared types + review-manifest JSON Schema. No deps on
  other packages; everything else depends on it.
- `packages/db` — Prisma (SQLite dev / Postgres-compatible) + seed. Not imported by domain packages.
- `packages/github`, `packages/zenodo`, `packages/extractor`, `packages/trust`,
  `packages/knowledge` — framework-free domain logic (no Prisma, no React).
- `packages/ui`, `packages/config` — UI primitives / env config.

## Conventions

- Internal packages export TypeScript source (`"main": "src/index.ts"`) and are transpiled by
  Next (`transpilePackages`). Intra-package imports use `.js` suffixes (NodeNext/Bundler); Next
  resolves them via a webpack `extensionAlias`. **App-local** relative imports in `apps/web/src`
  use no extension.
- Enums are `String` columns validated by `@oratlas/contracts`; JSON payloads are `…Json` string
  columns. Keep the schema Postgres-portable.
- Domain packages return plain typed values validated by contracts; persistence/transport are
  swappable behind interfaces (`IngestionRunner`, `SearchProvider`, `LlmProvider`, `DoiResolver`,
  `GithubTransport`).

## Invariants (do not break)

- Version DOI and concept DOI are distinct fields end to end.
- Structural compatibility is deterministic/rule-based, never an LLM decision.
- TRUST attaches to a claim–citation relation; aggregates are optional and carry their method.
- All repository content is untrusted: escaped text only, no raw HTML, no code execution, no clone.
- Example identifiers (`10.5555/…`) are flagged and never rendered as outbound links.
- LLM discussion output is Zod-validated and rejected if it cites identifiers absent from the packet.

## Commands

```bash
pnpm install
pnpm --filter @oratlas/db db:generate && pnpm --filter @oratlas/db db:push && pnpm --filter @oratlas/db db:seed
pnpm dev                         # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test && pnpm schema:check
pnpm --filter @oratlas/web build
pnpm --filter @oratlas/web test:e2e     # needs a seeded db; uses dev server for mock auth
```

`db:reset` deletes the SQLite file then re-pushes/seeds (avoids Prisma's `--force-reset` consent
gate). SQLite/dev only.
