# Operations & production readiness

Open Review Atlas ships as a POC, but the archive it produces is meant to be
citable and durable. These runbooks describe how to operate it beyond a single
developer node: database portability and migrations, backup and recovery,
observability, rate limiting and request caps, accessibility coverage, and the
privacy/takedown process that backs the tombstone invariant.

| Runbook                                              | Purpose                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| [postgres.md](./postgres.md)                         | Running on PostgreSQL; schema portability and tested migrations.  |
| [backup-recovery.md](./backup-recovery.md)           | Backup and restore procedures for SQLite and PostgreSQL.          |
| [observability.md](./observability.md)               | Health/readiness endpoints, structured logs, request correlation. |
| [privacy-and-takedown.md](./privacy-and-takedown.md) | Handling takedown/privacy requests via the tombstone mechanism.   |

## Production gates

The `CI` workflow enforces the automated half of production readiness on every
pull request:

- **Portability** — the schema is pushed and seeded against a real PostgreSQL
  service, and the committed Postgres DDL is checked for drift.
- **Accessibility** — key public pages are scanned with `axe-core` for WCAG
  violations.
- **API contract** — the OpenAPI document is checked for drift against the
  actual App Router API routes.
- **Security & governance** — dependency review, CodeQL and pinned actions (see
  the repository governance workstream).

These runbooks delivered the implemented parts of the now-closed production-readiness umbrella
[issue #7](https://github.com/dhuzard/oratlas/issues/7). Deferred items are stated explicitly in
their owning runbook or the canonical backlog; the closed umbrella is not an active tracker.
