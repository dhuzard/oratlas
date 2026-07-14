# Backup & recovery

Open Review Atlas produces a citable, durable archive, so the database must be recoverable.
This runbook covers the backup and restore scripts, cadence, and a recovery drill.

See also: [postgres.md](./postgres.md), [observability.md](./observability.md), and the
[operations index](./README.md).

## Backup

```bash
npx tsx scripts/backup.ts
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

At a POC level:

- **RPO** (how much data you can afford to lose) — a daily backup bounds data loss to roughly
  one day. Increase frequency as write volume grows.
- **RTO** (how long recovery takes) — SQLite restore is a file copy (seconds); Postgres
  restore is a `pg_dump`/restore cycle bounded by database size.

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
