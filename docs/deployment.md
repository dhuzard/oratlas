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

## Security headers

`apps/web/next.config.mjs` sets `Content-Security-Policy` (strict `script-src` in production,
with `'unsafe-eval'` only in development for HMR), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, and `Referrer-Policy`. Serve over HTTPS so session cookies are
`Secure` (they are marked `Secure` automatically in production).

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
