# Backup & recovery

Open Review Atlas produces a citable, durable archive, so the database must be recoverable.
This runbook covers the backup and restore scripts, cadence, and a recovery drill.

See also: [postgres.md](./postgres.md), [observability.md](./observability.md), and the
[operations index](./README.md).

## Backup

```bash
npx tsx scripts/backup.ts
# deterministic destination (fails if the target already exists)
npx tsx scripts/backup.ts --output /secure/location/oratlas.db.bak
```

Behavior depends on the provider inferred from `DATABASE_URL`:

- **SQLite** — copies the database file into `backups/…`.
- **PostgreSQL** — prints the `pg_dump` command to run against your database. (The script does
  not shell out to `pg_dump`; run the printed command with your operational credentials.)

SQLite backups land under `backups/` in the repository working tree.

## Restore

```bash
npx tsx scripts/restore.ts <backup-path>
```

**Warning:** restore overwrites the current database with the backup contents. Take a fresh
backup of the current state first if it holds anything you might still need.

## Cadence

The current service objectives are:

- **RPO: 24 hours.** Complete at least one successful backup every day; take an additional
  backup immediately before schema migrations or destructive maintenance. Increase frequency
  if losing up to one day of writes is unacceptable.
- **RTO: 30 minutes.** Restore the most recent verified backup and complete the public-read
  validation within 30 minutes. Escalate immediately if the dataset size or platform cannot
  meet this target.

Recommended: daily automated backups, plus an on-demand backup immediately before any schema
migration or destructive maintenance (see the migration notes in [postgres.md](./postgres.md)).

## Recovery drill

Run this end to end periodically so recovery is proven, not assumed:

1. **Take a backup** — `npx tsx scripts/backup.ts`.
2. **Simulate loss** — in a disposable environment, drop or corrupt the database.
3. **Restore** — `npx tsx scripts/restore.ts <backup-path>`.
4. **Verify schema** — `pnpm --filter @oratlas/db db:validate`.
5. **Verify liveness** — start the app and confirm `GET /api/health/ready` returns 200
   `{status:"ready",checks:{database:"ok"}}` (see [observability.md](./observability.md)).

If readiness reports `unavailable` (503), the restored database is not round-tripping — do not
promote it.

CI runs the SQLite form of this drill on every pull request with `pnpm drill:backup-restore`.
It creates a database under the job's temporary directory, pushes the schema, seeds canonical
fixtures, starts the production application, and captures raw response bodies from public review,
node archive, and graph APIs. It then stops the app, creates a backup, validates and deletes only
the drill-owned database files, restores through `scripts/restore.ts`, restarts the app, and
byte-compares every response. Any divergence fails the job. The application is quiesced before
backup and deletion so SQLite side files and in-flight writes cannot make the copy inconsistent.

The automated drill proves logical recovery for the seeded SQLite fixture; it does not replace
encrypted off-site retention, restore drills against production-sized data, or the PostgreSQL
`pg_dump`/`pg_restore` extension tracked by ORA-K01.
