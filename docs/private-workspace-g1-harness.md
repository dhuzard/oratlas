# G1 isolation-test harness specification

**G1-empty harness implemented (partial coverage); G1 is not passed.** Specification baseline: `main` at `bb166fa` after #219; implementation baseline `386a7d1`. This document specifies and records a bounded implementation task under #204; it does not approve identity policy, ratify ADR §14/§15 or resolve D11 (which remains provisional; no hosted enablement). The [implementation record](#implementation-record-g1-empty-partial) lists exactly what runs and what remains a gap. Only an independent review of that evidence can record G1 as passed.

## Gate and scope

[ADR §13 G1](./private-workspace-security-architecture.md#13-rollout-gates-and-migration-consequences) requires T-IMP, T-ROLE, T-PUB harness and a `private, no-store` helper running in CI against an **empty private schema**, with public-contract snapshots. Passing G1 unlocks creation of private tables, **not storage of real private data or enablement of a workspace service**. This document alone passes nothing.

The §11 final T-ROLE matrix needs actual tables; final T-PUB needs seeded private A/B content. G1 provides executable empty-schema prerequisites and a harness for those later tests, not a vacuous claim that nonexistent tables or private rows were protected. Record coverage as **G1-empty** versus **populated matrix deferred**. Any unresolved interpretation of this staging must be reviewed explicitly, not hidden by naming all tests “passed.”

Non-scope: private application tables, migrations for workspace content, OAuth activation, session persistence, production credentials, private endpoints/UI, RLS/runtime authorization, KMS, external connectors and real research data. The [owner register](./private-workspace-owner-decisions.md) tracks separate policy-dependent prerequisites.

## Disposable environment and connections

- Use PostgreSQL 16 in a dedicated disposable CI service/database. Existing CI has a PostgreSQL job; reuse its pinned-action/Node/pnpm conventions, not its bootstrap credentials as runtime credentials. Preserve existing SQLite/unit and PostgreSQL regression suites.
- Bootstrap/admin connection provisions roles, public test fixtures and an empty `private_ws` schema only. Public runtime and private runtime use distinct **direct connections**, not an admin session with a claimed application role. No bootstrap connection enters route tests or runtime environment.
- Dedicated variables: `G1_TEST_ADMIN_DATABASE_URL`, `G1_TEST_PUBLIC_DATABASE_URL`, `G1_TEST_PRIVATE_DATABASE_URL` and `G1_TEST_DISPOSABLE_TARGET_ACK`. All are required by `pnpm g1:private-workspace`; absent PostgreSQL/URLs is a failure, not a skip or SQLite fallback.
- Refuse setup/reset/teardown unless explicitly configured for this disposable test target. No fallback to developer or production `DATABASE_URL`, destructive commands against existing databases, or secret-bearing logs. Provisioning/cleanup must be scoped to the disposable service.
- Both runtime roles are nonsuperuser, nonowner, without `BYPASSRLS`, role creation, replication or privilege-escalating membership. Check inherited privileges, schema ownership, effective grants and inability to `SET ROLE` to bootstrap/private roles from the public connection. Runtime roles cannot create application objects or own the schema; later migrations use a separate privileged path.
- Provision only the public privileges actually required by tested routes. Do not impose an invented global SELECT-only public policy: public submission/editorial flows can require writes. Do not grant the private role blanket public access without a demonstrated need. Assert no grants via `PUBLIC` or inherited roles defeat isolation.

## Required tests and artifacts

### T-IMP: bounded import enforcement

Extend the existing `scripts/architecture-boundaries.test.ts` precursor with positive/negative fixture cases: direct package/subpath imports, relative and application aliases, selected private symbols from public barrels, literal dynamic imports/requires, and approved private-scoped locations. Negative cases must prove the guard would reject the forbidden dependency, without adding a forbidden import to production source.

Record limits explicitly: computed imports, laundering through new aliases/barrels, bundler/runtime data flow and possession of credentials are not proven by a static AST test. Enumerate exactly supported patterns; do not label this as universal non-interference. Public modules must remain unable to import the future private client package under the ADR rules.

### T-ROLE: empty-schema posture now, table matrix later

1. Assert exact connection identities and role posture; public runtime cannot inherit or assume private/bootstrap privileges.
2. Assert `private_ws` exists and contains no application tables, sequences or other private application objects.
3. Public runtime has neither effective schema `USAGE` nor `CREATE`. Exercise a schema operation expected to fail with an insufficient-privilege error and verify it is a permission denial, **not** a missing-object error. Use a transaction and ensure a privilege-regression test cannot leave a created probe behind; assert the schema remains empty.
4. Private runtime has only its reviewed schema privileges and no DDL ownership/CREATE. Check grants and effective privileges, including defaults that will apply when later migrations create tables.
5. Publish actual SQLSTATEs and role/grant assertions. PostgreSQL catalog visibility of schema names is not concealed by revoking USAGE; do not promise metadata invisibility to DB operators.
6. Explicitly defer `SELECT`/DML denial on real private tables and owner/RLS-bypass checks against populated objects to the post-G1 table suite. A query against a nonexistent relation is **not** table-permission evidence. Do not create private application tables before G1 merely to satisfy this check.

### T-PUB: deterministic public-contract harness

- Inventory public ingress/egress against ADR §3.1 and actual routes: archive/pages, graph/search/discovery, claim passports, feeds/sitemap/`llms.txt`, OpenAPI, exports/snapshots and applicable inspect/ingest/discuss paths. Record method, principal, fixture, expected status/body/header contract and any deliberately separate channel. Missing coverage is visible, not silently skipped.
- Use identical deterministic public seeds, fixed clocks/IDs, mocked external services and reset state for each paired capture, including public mutations. Capture **before** and **after** empty-schema/role provisioning under the same restricted public runtime, never admin. Neither capture may silently degrade to permission errors or empty results.
- Compare status, raw body bytes, relevant headers, counts, cursors and ordering. Permit only narrowly reviewed normalization of date/request-id headers; no stripping workspace-derived fields, counts, errors or content. Preserve duplicate/multi-value header semantics where relevant. Golden updates require review, never automatic acceptance after failure.
- Prepare anonymous, A-only, B-only, A+B, EDITOR and ADMIN test-principal cases using deterministic nonproduction session fixtures. At G1, A/B are labels only: no actual workspace memberships exist yet. Make unsupported principal/session fixtures explicit blocking coverage gaps, not evidence of authorization.
- Capture/version the route/principal coverage manifest and public baselines. Later populated A/B private-content runs must reuse this harness for the full §11 T-PUB matrix. Non-HTTP channels and timing evidence are separately tracked; G1 does not prove them.

### `private, no-store` helper: executable fixture, no endpoint

Implemented at `apps/web/src/lib/private/cache-control.ts` (`privateResponse`, `mergeVary`) with tests in `cache-control.test.ts`; no route uses it.

Test success, error and generic denial responses through a synthetic handler, without adding a production endpoint. Require `Cache-Control: private, no-store`; merge `Vary: Cookie` with existing tokens case-insensitively (preserving `Vary: *`); remove content-derived validators. Choose and test no content-derived ETag/Last-Modified and no conditional 304 in the fixture pipeline. A header mutator alone cannot prevent an upstream cache from already returning 304: test the actual response composition boundary and state limits.

Use two synthetic principals to exercise absence of response reuse. This is a helper/cache fixture, not proof of workspace authorization, CDN/Next deployment behavior or all future routes. Existing public cache behavior stays unchanged.

## Proposed implementation and CI acceptance

1. Add isolated setup/assertion/cleanup utilities plus PostgreSQL role tests, the coverage manifest/public response harness, helper and helper tests; extend the existing architecture test. New names/paths are implementation proposals, not existing commands.
2. Add a dedicated required CI job/step with explicit disposable PostgreSQL connections. Generate Prisma/configure public fixtures using repository conventions; no hardcoded branch checkout, unpinned replacement actions or live providers. Missing infrastructure must fail the dedicated test path. Normal offline test runs must not accidentally contact a database.
3. Run focused suites plus existing public-contract/architecture regressions and relevant lint/typecheck/format checks. Emit non-skipped PostgreSQL results, role identities/grants/SQLSTATEs, empty-schema checks before/after, import fixture cases, route/principal manifests, reviewed snapshots and helper assertions.
4. Review the final diff and staged G1-versus-populated coverage. Only separately reviewed implementation with passing evidence can record G1 complete and permit private table creation. Do not mark the full T-ROLE/T-PUB populated matrices complete at this stage.

Next implementation dependencies remain separate: reviewed persistence/session binding/fencing; G2 principal resolution, epochs, authorization/RLS and invitations; G3 KMS/private audit/backup protection; later applicable gates and legal/privacy evidence. No test harness waives these requirements.

**Validation:** see the implementation record below for the exact commands and local results. The dedicated CI workflow has not yet run on GitHub at the time of writing; no CI result is claimed here.

## Implementation record (G1-empty, partial)

Status: **G1-empty harness implemented with partial coverage. Populated T-ROLE/T-PUB matrices,
broader routes and non-anonymous principals are outstanding. G1 is not recorded as passed.**

### Layout

| Path                                                               | Role                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/private-workspace-g1/run.ts`, `orchestrator.ts`           | CLI entry (`pnpm g1:private-workspace`) and the orchestrator (`runG1Harness`, psql/spec runners injectable for offline tests). Exit `0` passed, `1` a check or cleanup step failed, `2` refused before mutation.     |
| `scripts/private-workspace-g1/target.ts`                           | Pure target validation (URLs, roles, acknowledgement).                                                                                                                                                               |
| `scripts/private-workspace-g1/postgres.ts`, `sql.ts`               | `psql` adapter (no shell; `-X --no-password -v ON_ERROR_STOP=1`; SQL on stdin; password only in child `PGPASSWORD`; psqlrc/service/password files disabled; 60 s timeout; output redaction) and quoted SQL builders. |
| `scripts/private-workspace-g1/fixtures/public-fixtures.sql`        | Deterministic synthetic public rows: one repository/review, three snapshots with valid SHAs, two published versions with fixed times, one unpublished version, two persons.                                          |
| `scripts/private-workspace-g1/*.g1.spec.ts`, `vitest.config.ts`    | Real-PostgreSQL suites, discovered **only** by the dedicated config (root `pnpm test` includes `scripts/**/*.test.ts` and never finds them).                                                                         |
| `scripts/private-workspace-g1/*.test.ts`                           | Offline tests (target refusal, adapter/SQL, comparator, manifest, orchestrator refusal and cleanup fault injection). They never contact a database.                                                                  |
| `scripts/private-workspace-g1/manifest.ts`                         | Route/principal/channel coverage manifest.                                                                                                                                                                           |
| `scripts/private-workspace-g1/baselines/public-routes.golden.json` | Reviewed public golden baseline.                                                                                                                                                                                     |
| `.github/workflows/private-workspace-g1.yml`                       | Separate workflow (existing `ci.yml` untouched): PostgreSQL 16 service, Node 22, pnpm 10.33.0, frozen install, PostgreSQL Prisma client, `psql` required, explicit URLs/ack, sanitized evidence artifact.            |

### Target safety

`run.ts` refuses (exit 2, value-free messages) before any connection unless all four variables are
present; every URL is `postgresql:` on `localhost`/`127.0.0.1`/`[::1]` with an explicit port and
the same database matching `oratlas_g1[_suffix]`; the only query parameter allowed is
`schema=public` (libpq `host`/`hostaddr`/`service`/`options` are rejected); users are distinct, the
public/private users match `oratlas_g1_public*`/`oratlas_g1_private*`, and the acknowledgement
equals `disposable-g1-target:<host>:<port>/<database>`. There is no `DATABASE_URL` fallback. The
read-only preflight then refuses unless the server is PostgreSQL 16, the admin identity matches,
the runtime roles and `private_ws` do not exist, the public schema has no relations, functions or
types, there are no other user schemas and no default privileges. Cleanup drops only what the run
recorded creating: both runtime roles (`DROP OWNED BY` then `DROP ROLE`), `private_ws` with
`RESTRICT` (fails if not empty) and the recorded public tables/functions. Cleanup runs after every
outcome and attempts every recorded resource even when an earlier drop fails. Any failed cleanup
step makes the run exit `1` with `result: "failed (cleanup incomplete; run-created resources may
remain)"`, even when every check passed; `summary.failure` keeps the first failing check (or `null`)
alongside the failed cleanup steps, and cleanup errors are redacted. The final `result:` line is
logged only after cleanup. Each subsequent run's preflight proves the previous cleanup left the
database clean.

### Sequence

Preflight → public DDL from `packages/db/prisma/schema.postgres.sql` → fixtures → restricted public
role (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`, `USAGE` on
`public`, `SELECT` on exactly `Person`, `RepositorySnapshot`, `Review`, `ReviewContributor`,
`ReviewVersion` — the tables the Atom query reads) → **baseline capture** → `private_ws` owned by the
bootstrap role, `REVOKE ALL … FROM PUBLIC`, private role with `USAGE` only → public grants verified
unchanged → **after capture** → T-ROLE suite → `private_ws` emptiness re-checked → paired and
golden comparisons → cleanup → `summary.json` (status decided by checks **and** cleanup).

Capture children receive only the public runtime URL as `DATABASE_URL`, a fixed base URL
`https://g1.oratlas.example` and a non-secret session constant; they assert that no admin/private
variable or `PGPASSWORD` is present. The T-ROLE child receives only the public/private runtime URLs
(direct connections) and the bootstrap role **name**. Evidence and logs are written with mode
`0600` and redacted of all three passwords and any PostgreSQL URL.

### What runs

- **T-IMP** (`scripts/architecture-boundaries.test.ts`): previous guard unchanged plus fixture
  regressions against the real private helper — `@/`, relative (from lib and from a nested route),
  root path, directory, side-effect, type-only, named/star re-export, literal dynamic import (with
  options), `require` with extra arguments, import-equals, `typeof import`, future package and
  subpath, private route module and barrel-selected private symbols; lookalike paths/packages,
  string and comment mentions are allowed. Approved importers are only whole-segment
  `apps/web/src/lib/private/**`, `apps/web/src/app/api/private/**` and `packages/private-workspace/**`
  (non-normalized paths refused); packages and scripts may not import the private package or app
  modules; the `@/*` alias set is pinned. A test asserts that computed specifiers are **not** caught
  (documented limitation, not a claim).
  Every boundary check (application internals, Prisma/Next, public guard, cache-helper importers,
  packages/scripts private check) and every fixture uses one AST extractor, `moduleReferences`.
  It sees import/export declarations, `import x = require("…")`, `import("…")`/`require("…")` with a
  string or no-substitution template first argument (extra arguments such as import attributes are
  ignored) and `import("…")` type nodes. Packages/scripts fixtures run the same function as the real
  scan, including `import("../apps/web/src/lib/private/cache-control", { with: {} })` and
  `import x = require("@oratlas/private-workspace")` from script and package importers. Not seen:
  computed specifiers, `module.require`, `createRequire(…)(…)`, `import.meta.resolve`.
- **T-ROLE G1-empty** (`roles.g1.spec.ts`), from each runtime role's own session: identity
  (`session_user = current_user` = expected role), attributes all false (login only), no
  memberships in either direction, not a member of / cannot use the bootstrap or peer role, owns no
  relation/schema/function/type/database, no database `CREATE`, no `CREATE` on `public`, no default
  privileges anywhere (`pg_default_acl` empty — later tables get no implicit grants and must be
  granted and tested explicitly), `private_ws` ACL exactly bootstrap `USAGE`+`CREATE` and private
  `USAGE` with no `PUBLIC` entry. Public: no `USAGE`/`CREATE` on `private_ws`, `SELECT` on exactly
  the five fixture tables (reads 2/3/1/4/3 rows). Private: `USAGE` without `CREATE`, no privilege on
  any public table. `private_ws` has zero tables, sequences, views, indexes, functions, types,
  collations, operators, conversions, text-search objects, extensions and statistics objects before
  and after probes (checked from both runtime roles and the bootstrap role). Catalog visibility is
  **not** hidden: both roles see `private_ws` in `pg_namespace`.
- **Probes** run inside `BEGIN … ROLLBACK` and record SQLSTATE/message; a probe that succeeds fails
  the suite (and is rolled back). Recorded locally:

  | Role    | Statement                                     | SQLSTATE | Message                                                    |
  | ------- | --------------------------------------------- | -------- | ---------------------------------------------------------- |
  | public  | `CREATE TABLE private_ws.g1_probe`            | 42501    | permission denied for schema private_ws                    |
  | public  | `SELECT … FROM private_ws.g1_absent_probe`    | 42501    | permission denied for schema private_ws (not 42P01)        |
  | public  | `GRANT USAGE ON SCHEMA private_ws TO self`    | 42501    | permission denied for schema private_ws                    |
  | public  | `CREATE TABLE public.g1_probe`                | 42501    | permission denied for schema public                        |
  | public  | `CREATE SCHEMA` / `CREATE ROLE`               | 42501    | permission denied for database / to create role            |
  | public  | `SET ROLE` bootstrap / private                | 42501    | permission denied to set role                              |
  | private | `CREATE TABLE private_ws.g1_probe`            | 42501    | permission denied for schema private_ws (USAGE, no CREATE) |
  | private | `SELECT … FROM private_ws.g1_absent_probe`    | 42P01    | control only — **not** table-permission evidence           |
  | private | `SELECT … FROM public."ReviewVersion"`        | 42501    | permission denied for table ReviewVersion                  |
  | private | `CREATE TABLE public.…`, `CREATE SCHEMA/ROLE` | 42501    | permission denied                                          |
  | private | `SET ROLE` bootstrap / public                 | 42501    | permission denied to set role                              |

  Observed, not asserted as a restriction: both roles hold `TEMPORARY` and `CONNECT` on the
  database through PostgreSQL's default `PUBLIC` grants, and the public schema's default `PUBLIC`
  `USAGE` applies to the private role (with no table privilege).

- **T-PUB G1-empty** (`public-routes.g1.spec.ts`): real production handlers and the real Prisma
  client over the restricted public role, anonymous principal, `server-only` aliased to an empty
  stub, `Date` fixed to `2026-04-01T00:00:00.000Z` for `/api/health` only, global `fetch` blocked.
  Captured: `GET /api/health/ready`, `/api/health`, `/api/feeds/atom` (two entries, v2 then v1;
  the unpublished version excluded; XML escaping exercised), `/llms.txt`, `/openapi.yaml`,
  `/openapi.json`, and both OpenAPI routes with `If-None-Match` (existing public `304` unchanged).
  Each capture records status, ordered headers, `Set-Cookie` separately, exact body bytes and
  SHA-256; the list is captured twice per child and must be identical. Baseline and after must be
  byte-identical, and both must equal the golden file (verbatim bodies ≤16 KiB, otherwise SHA-256 and
  length; feed entry IDs/order; no error status; no empty `200`). Only `date`/`x-request-id` may be
  normalized. Headers are the Fetch `Headers` view: names lower-cased, iterated in sorted order and
  duplicate fields joined with `, ` (as for the two `Link` values); raw on-the-wire order and Next's
  own response-header additions are not observed.
- **Cache helper** (`apps/web/src/lib/private/cache-control.test.ts`): synthetic handler only;
  success/500/generic 404 keep status and body and get `Cache-Control: private, no-store`, `Vary`
  with `Cookie`, no `ETag`/`Last-Modified`; a conditional request receives the normal full body; a
  `304` is refused (`PrivateResponseError`), never rewritten into a body-less `200`; two principals
  receive their own bodies; `Vary` merging is case-insensitive with no duplicates, multiple `Vary`
  lines are merged and `Vary: *` is preserved; the public OpenAPI `ETag`/`304` behaviour is
  asserted unchanged. Not evidence of authorization, CDN or Next deployment caching.

### Commands and local results (2026-10-20, Node 24.21.0, PostgreSQL 16 `postgres:16` container)

```bash
pnpm install --frozen-lockfile
pnpm --filter @oratlas/db db:pg:schema && pnpm --filter @oratlas/db db:generate:postgres
G1_TEST_ADMIN_DATABASE_URL=… G1_TEST_PUBLIC_DATABASE_URL=… G1_TEST_PRIVATE_DATABASE_URL=… \
  G1_TEST_DISPOSABLE_TARGET_ACK=disposable-g1-target:127.0.0.1:<port>/oratlas_g1 \
  G1_EVIDENCE_DIR=<dir> pnpm g1:private-workspace
pnpm exec vitest run scripts/private-workspace-g1 scripts/architecture-boundaries.test.ts \
  apps/web/src/lib/private apps/web/src/lib/openapi-response.test.ts apps/web/src/app/llms.txt/route.test.ts
```

- `pnpm g1:private-workspace`: exit 0; every step `ok`; capture suites 1/1 (twice), T-ROLE 7/7,
  paired and golden comparisons with zero differences; cleanup of both roles, `private_ws` and the
  recorded public objects `ok`. Evidence: `summary.json`, `capture-baseline.json`,
  `capture-after.json`, `role-evidence.json`, `golden-candidate.json` and child logs; no runtime or
  bootstrap password appears in them.
- Refusal and regression checks: a pre-existing public table → exit 2 "public schema is not empty"
  and the table was left untouched; running the dedicated Vitest config without variables → both
  suites fail (exit 1, no silent pass); an injected `GRANT USAGE, CREATE ON SCHEMA private_ws TO
PUBLIC` → T-ROLE failed (posture, ACL and `create-private-table` `SUCCEEDED`, rolled back; the
  `RESTRICT` cleanup then succeeded, proving no probe object remained); a changed fixture title →
  paired comparison still equal but the golden comparison failed. Both injected changes were
  reverted.
- Offline focused suites: G1 offline 58, architecture guard 97, cache helper 16, existing public
  OpenAPI/`llms.txt` regressions — all passing.

Review repair (2026-10-20, same toolchain), after an independent review found two correctness
issues:

- The packages/scripts check previously used a narrower extractor than the public guard. It missed
  `import("…", options)` and import-equals, so the real scan returned `[]` for forms the fixtures
  flagged. All checks now share `moduleReferences`. With the old limits temporarily restored, 15
  regressions fail (public guard and packages/scripts fixtures); with the fix all 116 architecture
  tests pass.
- Cleanup failures used to leave the exit code and summary untouched. `orchestrator.test.ts` now
  drives `runG1Harness` with in-memory psql/spec fakes (no database, no child process). Covered:
  every check passes but all four cleanup statements are rejected → exit 1, failed summary, all
  four drops attempted in order, details redacted, no `passed` line logged. Also covered: a failing
  T-ROLE step plus a failed private-role drop → the original check failure is kept and the other
  three drops still run; a check failure with clean cleanup → `failed`; a refusal → exit 2 with no
  cleanup attempts; a clean run → exit 0. Removing the cleanup→exit rule makes the all-rejected
  case fail.
- A real rerun of `pnpm g1:private-workspace` against a fresh loopback `postgres:16` container exited
  0 with every step and all four cleanup steps `ok`. The final `result:` line came after cleanup.
  The database then had no `oratlas_g1_*` roles, no `private_ws` and no public objects. No password
  appeared in the evidence or log. The container was then removed.
- Focused offline suites: 10 files, 199 tests passing (G1 offline 63, architecture 116, cache helper
  16, OpenAPI/`llms.txt` 4); ESLint and Prettier clean on the changed files. No `pnpm typecheck`
  project includes `scripts/`; an ad-hoc `tsc --noEmit` over the changed files with the base config
  (ESNext/Bundler module settings) passed.

Parent verification after repair (2026-10-20): independent re-review closed both correctness
findings with no new blocker/correctness/regression/test-gap findings. A fresh full `pnpm test`
run against the code-identical implementation worktree passed **245 files / 2,094 tests**, with
6 pre-existing PostgreSQL opt-in files / 16 tests skipped in the ordinary offline suite. A
local PATH shim exposing `corepack pnpm` resolved the earlier PATH-only failures. The dedicated
PostgreSQL evidence is separate and non-skipped; these ordinary-suite skips are not G1 coverage.
Full log: `/tmp/oratlas-g1-parent-full-tests.log`; sanitized repaired PostgreSQL evidence:
`/tmp/oratlas-g1-607a-evidence-repair/`. GitHub CI has not run for this branch.

Golden updates: each run writes `golden-candidate.json`; a reviewer compares it with the current
golden and copies it deliberately. The harness never overwrites or accepts a golden after a failure.
The OpenAPI golden is tied to `docs/openapi.yaml` and the generated ETags by an offline test, so a
contract change requires a reviewed golden update in the same change.

### Outstanding (not covered; G1 must not be recorded complete on this basis)

- Populated T-ROLE (`SELECT`/DML denial, ownership and RLS on real `private_ws` tables) and the full
  §11 T-PUB matrix with seeded private A/B content.
- Every public route outside the eight captured requests (the manifest lists each group as a gap),
  sitemap/robots, pages/metadata, public mutations with reset, and non-HTTP channels
  (jobs/CLIs, backups, search index, logs/audit, notifications, external lookups, timing).
- Principals A-only, B-only, A+B, `EDITOR`, `ADMIN`: blocking gap — no deterministic nonproduction
  session fixture is wired in, and at G1 A/B are labels only with no memberships.
- The dedicated workflow's first GitHub run, and any decision on whether it becomes a required check.

References: [ADR test matrix](./private-workspace-security-architecture.md#11-test-matrix-and-acceptance-mapping), [G1 gate](./private-workspace-security-architecture.md#13-rollout-gates-and-migration-consequences), [R0 evidence limits](./private-workspace-r0-review.md), [identity interfaces/limitations](./identity-link-foundations.md), [next-phase plan](./private-workspace-poc-next-phase.md).
