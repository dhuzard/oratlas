# Deployment

Open Review Atlas deploys to any conventional Node-compatible platform (a long-running Node
server; Next.js App Router with server actions and API routes).

## Prerequisites

- Node ≥ 20.9, `pnpm` 10.
- A PostgreSQL database for production (SQLite is for local development only).

## Steps

1. **Database**
   - Set `DATABASE_URL` to your PostgreSQL connection string.
   - Change the datasource provider in `packages/db/prisma/schema.prisma` from `sqlite` to
     `postgresql`. The schema is written to be portable (no SQLite-only features).
   - Generate a migration and apply it:
     ```bash
     pnpm --filter @oratlas/db exec prisma migrate dev --name init   # once, to author it
     pnpm --filter @oratlas/db exec prisma migrate deploy            # in production
     ```
   - When upgrading a populated database from a schema without `githubLoginNormalized`, use the
     staged login migration below before enabling GitHub sign-in.
2. **Secrets / environment**
   - `SESSION_SECRET` — **required in production** (`openssl rand -hex 32`). The app refuses to
     start in production without it.
   - `GITHUB_TOKEN` — optional, raises GitHub API rate limits.
   - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — enable real GitHub OAuth. With the callback at
     `${NEXT_PUBLIC_BASE_URL}/api/auth/github/callback`.
   - `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` + `LLM_MODEL` — enable Atlas Discuss LLM mode.
   - `NEXT_PUBLIC_BASE_URL` — canonical base URL.
   - Do **not** set `AUTH_MOCK` in production; the mock sign-in is refused there regardless.
3. **Build & run**
   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @oratlas/db db:generate
   pnpm --filter @oratlas/web build
   pnpm --filter @oratlas/web start   # or: next start behind your process manager
   ```

## Legacy GitHub repository identity reconciliation

Before applying the unique string `Repository.githubRepositoryId` constraint to a populated legacy
SQLite database:

1. Back up the database.
2. Run `pnpm --filter @oratlas/db db:reconcile-github-repositories` as a dry-run preflight.
3. If duplicate immutable GitHub ids are reported, rerun with `-- --apply`. The newest repository
   row survives; snapshots, submissions and review/version links are rewired transactionally, and
   an audit event records the merged rows.
4. Apply the Prisma schema without `--accept-data-loss`.
5. Run the reconciliation command once more with `-- --apply` to backfill nullable legacy
   `Review.repositoryId` values from their version snapshots.

The command refuses non-SQLite URLs. PostgreSQL deployments should encode the same preflight and
rewiring steps in a reviewed migration before adding the unique index.

## Existing-user login migration

`User.githubLoginNormalized` is intentionally nullable during this transition. Its index is
non-unique, so `prisma db push` can add both to a populated database without
`--accept-data-loss`, deleting rows, or inventing values for them.

1. Generate and deploy a migration that adds the nullable column and normal index.
2. Run `pnpm --filter @oratlas/db db:backfill-github-logins` with the production `DATABASE_URL`.
   The command first scans every user, then updates all rows atomically. If two historical logins
   differ only by case, or an existing normalized value is inconsistent, it aborts without writes.
3. Resolve reported rows manually using verified immutable GitHub user IDs. Do not merge accounts,
   transfer roles, or delete audit history based only on a matching login; rerun the backfill after
   reconciliation.
4. Confirm no null normalized values remain. Database-enforced normalized uniqueness and making
   the column required remain deferred provider-specific migration work. The original umbrella
   [issue #7](https://github.com/dhuzard/oratlas/issues/7) is closed and must not be read as an open
   tracker for this remaining step.

OAuth also scans computed legacy login keys during this transition and rejects any collision, so an
unbackfilled or case-colliding legacy account cannot confer its role on a newly authenticated user.
Until that provider-specific migration lands, this complete application scan—not the transitional
index—is the uniqueness control.

## Security headers

`apps/web/src/middleware.ts` generates a fresh nonce-based `Content-Security-Policy` for each page
request. Production `script-src` does not allow unsafe inline scripts; development adds only
`'unsafe-eval'` and WebSocket connections required for HMR. `apps/web/next.config.mjs` sets
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy`. Serve over HTTPS
so session cookies are `Secure` (they are marked `Secure` automatically in production). Signed
session lifetime is also enforced on the server; cookie expiry is not the sole control.

## Scaling notes (replaceability)

The POC uses simple in-process implementations behind interfaces that can be swapped without
touching callers:

- **Ingestion** — `SynchronousIngestionRunner` → a queue/worker behind `IngestionRunner`.
- **Search** — `InProcessSearchProvider` → PostgreSQL FTS or an external engine behind
  `SearchProvider`.
- **Rate limiting** — in-process fixed-window → a shared store (e.g. Redis).
- **Knowledge index** — rebuilt per request → cached with invalidation on acceptance.

## Health

`GET /api/health` returns `{ status: "ok" }` for readiness/liveness probes.
