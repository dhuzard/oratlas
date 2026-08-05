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

Use the guarded production entry point:

```bash
ORATLAS_SCHEMA_BACKUP_ID=<verified-backup-id> pnpm db:deploy:postgres
```

On an empty database the wrapper installs the frozen
`prisma/baseline/20260805000000_existing_schema_baseline.sql`, records the initial migration
baseline, runs `prisma migrate deploy`, and installs the native guards. The evolving
`schema.postgres.sql` remains a drift-checked current-schema bootstrap artifact, never the baseline
for later migrations. On a populated database that predates migration history, the wrapper creates
a unique temporary schema, applies the immutable baseline there, and records the baseline only
after `prisma migrate diff` proves the live public schema matches that frozen baseline exactly. The
temporary schema is removed on success and failure. Drift or comparison failure stops deployment.
Once `_prisma_migrations` exists, only committed migrations are deployed. The guard installer
remains idempotent and runs after every deployment.

Never use `prisma db push` on a valuable database. The baseline marker is transitional: direct
`prisma migrate deploy` against a brand-new database does not install the bootstrap DDL, so the
wrapper remains mandatory.

## Canonical graph backfill

Cloud Build normally runs the complete backfill and contract activation after schema migration and
before staging a candidate service. The commands below are for a controlled retry or non-GCP
deployment. First run a read-only bounded validation batch:

```bash
pnpm backfill:canonical-graph -- --batch-size 100 --manifest canonical-graph-validate.json
```

Apply requires an explicit flag and a retained manifest. In production it also requires the exact
backup id produced by the verified Cloud SQL gate:

```bash
NODE_ENV=production \
ORATLAS_SCHEMA_BACKUP_ID=<verified-backup-id> \
pnpm backfill:canonical-graph -- --apply --all --finalize-contract --batch-size 100 \
  --manifest canonical-graph-backfill-001.json
```

Each review version commits in its own serializable transaction. The command hashes its scoped
TRUST, verification, challenge, response, transition, and adjudication records before and after;
any change rolls that version back and stops the batch. The manifest reports per-version counts,
semantic mismatches, protected-ledger digests, the next `--after` cursor, remaining records, and
whether the corpus is complete. Validation includes one exact review `asserts` edge per claim as
well as every claim-evidence compatibility edge. Resume only from the last successful `nextAfter`;
retain every manifest with the deployment change record. A dry run with any missing or divergent
binding exits nonzero and never reports `complete: true`. Finalization requires `--apply`, `--all`,
a manifest, and the shared bounded opaque backup-id format.

The contract uses PostgreSQL `DEFERRABLE INITIALLY DEFERRED` constraint triggers rather than
immediate `NOT NULL`: valid publication transactions create relational rows before graph rows in
the same transaction. Activation takes table locks, repeats a global zero-gap semantic validation,
and stores immutable backup/manifest activation metadata. Subsequent deployments validate and
no-op without rewriting it. After activation, incomplete commits and destructive updates or
deletes of canonical source identities, exact versions, and imported source assertions fail.

## CI gates (tested migrations)

Two jobs in the `CI` workflow keep Postgres support honest on every pull request:

- **Drift check** — CI regenerates the Postgres DDL and fails if
  `packages/db/prisma/schema.postgres.sql` differs from the checked-in copy. This is the
  bootstrap drift gate: the committed DDL must always match what the schema generates.
- **Portability job** — CI pushes the schema, installs and introspects native guards, rejects invalid
  direct writes, and seeds against a real PostgreSQL service on every PR, so a change that only works
  on SQLite cannot merge.

### Test-matrix policy and budget

SQLite remains the complete local and default CI test provider. The PostgreSQL job reruns only
provider-sensitive persistence and concurrency suites against Postgres 16; pure contract, rendering,
and offline extraction tests are not duplicated. Both providers must implement identical behavior.
Provider-specific database bootstrap is allowed, but provider-specific product semantics are not.

`atomic-publication.integration.test.ts` is shared by both providers. Under the normal test job it
creates an isolated temporary SQLite database. When `DATABASE_URL` is an external PostgreSQL URL it
uses that already-provisioned database instead, allowing the same serializable acceptance,
double-submit, and conflicting-decision races to run without a copied Postgres-only suite. CI gives
this suite its own `atomic_publication` schema so fixed fixture identities cannot collide with seed,
federation, or Execution Passport tests.

The PostgreSQL job has a 20-minute hard timeout. New provider-sensitive serialization or constraint
coverage belongs in a shared provider-aware suite and should be added to the targeted Postgres list;
do not run the entire SQLite-oriented Vitest corpus under a PostgreSQL-generated client.

## Caveat

`db:reset` (delete the file, re-push, re-seed) is **SQLite/dev only**. It has no Postgres
equivalent — never run it against a production database. Use `pnpm db:deploy:postgres` for
PostgreSQL deployment.
