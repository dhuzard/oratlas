# Running on PostgreSQL

SQLite is the development default (`DATABASE_URL=file:./dev.db`). PostgreSQL is the
production database. This runbook describes how the schema stays portable, how to point at
Postgres, and the CI gates that keep the two providers in sync.

See also: [backup-recovery.md](./backup-recovery.md), [observability.md](./observability.md),
and the [operations index](./README.md).

## Why the schema is portable

`packages/db/prisma/schema.prisma` is written to run unchanged on either provider:

- Enums are stored as `String` columns and validated by `@oratlas/contracts`, not as
  database-native enum types.
- JSON payloads are stored as `String` columns, not as provider-specific JSON types.
- No SQLite-only or Postgres-only features are used.

Switching providers is therefore a `provider` change plus a `DATABASE_URL` change — no model
rewrites.

## Pointing at PostgreSQL

Set the connection string:

```bash
export DATABASE_URL=postgresql://user:password@host:5432/oratlas
```

The dev schema keeps `provider = "sqlite"`. For Postgres, use the generated Postgres schema
below rather than editing the dev schema by hand.

## Generating the Postgres schema

```bash
pnpm --filter @oratlas/db db:pg:schema
```

This produces `packages/db/prisma/schema.postgres.prisma` — the same models with
`provider = "postgresql"`.

## Applying the schema in production

Apply the generated Postgres schema against your database:

```bash
pnpm --filter @oratlas/db exec prisma db push --schema prisma/schema.postgres.prisma --skip-generate
pnpm --filter @oratlas/db db:guards
```

The second command is required: Prisma `db push` does not install the native source-union,
synthesis lifecycle/lease, and reference-integrity constraints/triggers. Deployments using committed
migrations must likewise run `db:guards` after `prisma migrate deploy`. The guard installer is
idempotent. The committed Postgres DDL is `packages/db/prisma/schema.postgres.sql` and includes the
same guards for bootstrap workflows.

## CI gates (tested migrations)

Two jobs in the `CI` workflow keep Postgres support honest on every pull request:

- **Drift check** — CI regenerates the Postgres DDL and fails if
  `packages/db/prisma/schema.postgres.sql` differs from the checked-in copy. This is the
  "tested migrations" gate: the committed DDL must always match what the schema generates.
- **Portability job** — CI pushes the schema, installs and introspects native guards, rejects invalid
  direct writes, and seeds against a real PostgreSQL service on every PR, so a change that only works
  on SQLite cannot merge.

## Caveat

`db:reset` (delete the file, re-push, re-seed) is **SQLite/dev only**. It has no Postgres
equivalent — never run it against a production database. Use the standard Prisma
`migrate deploy` / `db push` flow for Postgres.
