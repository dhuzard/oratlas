# G1 isolation-test harness specification

**G1-empty harness implemented (partial coverage); G1 is not passed.** Specification baseline: `main` at `bb166fa` after #219; implementation baseline `386a7d1`; local synthetic coverage expansion on `05a4854` (see [coverage expansion](#coverage-expansion-2026-10-20-local-synthetic)). This document specifies and records a bounded implementation task under #204; it does not approve identity policy, ratify ADR §14/§15 or resolve D11 (which remains provisional; no hosted enablement). The [implementation record](#implementation-record-g1-empty-partial) lists exactly what runs and what remains a gap. Only an independent review of that evidence can record G1 as passed.

## Gate and scope

### Method and channel inventory added 2026-10-21

`coverageSummary().methodAndChannelObligations` now inventories each exported
HTTP method using the existing OpenAPI TypeScript parser, without importing or
executing route source. It lists scenario IDs, missing principal cases, successful
cases and explicit denials separately. Wildcard exports and unknown operations
require review. A GET capture never covers POST on the same route, and six 404s
never establish a positive path. This is a static obligation inventory, not
evidence that scenarios executed or a gate passed.

At baseline `a442e1d`: **143 exported methods**, **18 with scenarios**, **7 with
all six principal cases**, and **40 rendered page/layout/metadata source files**.
Real Next serving and non-HTTP evidence remain separate obligations. These
method counts supplement the older 17/133 route-file count. Tests cover a hidden
POST gap, missing-only scenarios, unresolved exports and nonexecuting source
inspection. Public text exports can additionally require reviewed body markers,
independent of a replacement golden; a mutation regression checks that omission
is rejected.

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

**Validation:** see the implementation record below for the exact commands and observed results.
The dedicated G1 workflow passed on [#225](https://github.com/dhuzard/oratlas/pull/225).
The public-artifact extension passed in #227. The larger method-aware batch below
requires its own final-head CI; neither result completes G1.

## Implementation record (G1-empty, partial)

Status: **G1-empty harness implemented with partial coverage. Nine separately reset programs
declare 2,594 records (2,577 HTTP, 15 state and two metadata), spanning 89 of the
133 public route files and 94 of 143 exported methods. All 94 declared methods
include six user/session cases; four worker GETs also have independent credential
and lease positives. The index consumer has its own four-label capture. The
other 44 files / 49 methods, OAuth success and integrated real Next HTTP serving
remain G1 gaps. Operational channels and timing are separately tracked against
their applicable later gates, as specified above and in ADR §13. Populated
T-ROLE/T-PUB remains later. G1 is not passed.**

The worker artifact supplement declares 379 native requests over four methods,
including one completion of an already uploaded artifact and exact replays. Its
own reset adds 52 rows (37 established worker rows and 15 native artifact/history
rows) and the recorded setup credential timestamp. The shared role gains only
`VerificationArtifact.status` and `completedAt` column UPDATE, for 16 permitted
UPDATE columns overall; table SELECT/INSERT authority is unchanged. Existing
programs must be recaptured under that measured authority. Public HTTP/index data
and complete public rows must stay unchanged; separately reviewed authority
metadata is retained rather than omitted to keep old state hashes. See the
[artifact probe](private-workspace-worker-artifact-probe.md) for native fixture
provenance, credential-versus-cookie controls and the remaining fresh-write gaps.

The protocol/DOI supplement adds 110 native requests: an exact existing registry
snapshot replay and populated reserved-example/invalid DOI reports, with complete
unchanged public state. It makes no provider calls. The audit-revocation supplement
adds 92 requests over two admin methods; requests against already-revoked fixture
credentials append exactly two native audit rows and leave credentials unchanged.
Only absent AuditEvent id/time inputs are fixed through the separately reviewed
real Prisma extension; all native constraints and existing grants remain in force.
See the [protocol/DOI probe](private-workspace-protocol-doi-probe.md) and
[audit-revocation probe](private-workspace-audit-revocations.md). Independent review accepted both four-label candidates executed at `bef4f82`; only the two
review annotations were changed during manual baseline acceptance. The final run with complete
disclosure guards and batched test snapshots remains required.

### Layout

| Path                                                                                   | Role                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/private-workspace-g1/run.ts`, `orchestrator.ts`                               | CLI entry (`pnpm g1:private-workspace`) and the orchestrator (`runG1Harness`, psql/spec runners injectable for offline tests). Exit `0` passed, `1` a check or cleanup step failed, `2` refused before mutation.                                                          |
| `scripts/private-workspace-g1/target.ts`, `child-env.ts`                               | Pure target validation (URLs, roles, acknowledgement) and the closed environment contract of handler children.                                                                                                                                                            |
| `scripts/private-workspace-g1/postgres.ts`, `sql.ts`                                   | `psql` adapter (no shell; `-X --no-password -v ON_ERROR_STOP=1`; SQL on stdin; password only in child `PGPASSWORD`; psqlrc/service/password files disabled; 60 s timeout; output redaction), quoted SQL builders, the reviewed grant closure and the reset/target checks. |
| `scripts/private-workspace-g1/fixtures/public-fixtures.sql`                            | Deterministic synthetic public rows (users, notifications, two public reviews plus a non-public control review, claims/citation/relation, claim nodes/edges, lifecycle ledger, publication version, certifiers/protocol).                                                 |
| `scripts/private-workspace-g1/principals.ts`, `scenarios.ts`                           | Fixed synthetic principals/session recipes and the reviewed ordered scenario program with exact expected outcomes.                                                                                                                                                        |
| `scripts/private-workspace-g1/next-request-context.ts`, `setup-async-local-storage.ts` | The single adapter over private Next 15.5.20 internals (request + work stores) and the dedicated setup file installing `AsyncLocalStorage` before Next loads.                                                                                                             |
| `scripts/private-workspace-g1/capture.ts`, `compare.ts`                                | Capture format v2 (v1 upgraded on read, other versions rejected), program validation, paired and golden comparison.                                                                                                                                                       |
| `scripts/private-workspace-g1/*.g1.spec.ts`, `vitest.config.ts`                        | Real-PostgreSQL suites (capture, auth evidence, T-ROLE), discovered **only** by the dedicated config (root `pnpm test` includes `scripts/**/*.test.ts` and never finds them).                                                                                             |
| `scripts/private-workspace-g1/*.test.ts`, `test-support.ts`                            | Offline tests (target refusal, adapter/SQL, Next context, comparator/program regressions, manifest, orchestrator sequence and fault injection). They never contact a database.                                                                                            |
| `scripts/private-workspace-g1/manifest.ts`                                             | Route/principal/channel coverage manifest, derived from the scenario program.                                                                                                                                                                                             |
| `scripts/private-workspace-g1/baselines/public-routes.golden.json`                     | Reviewed public golden baseline (v2).                                                                                                                                                                                                                                     |
| `.github/workflows/private-workspace-g1.yml`                                           | Separate workflow (existing `ci.yml` untouched): PostgreSQL 16 service, Node 22, pnpm 10.33.0, frozen install, PostgreSQL Prisma client, `psql` required, explicit URLs/ack, sanitized evidence artifact.                                                                 |

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

Preflight → public DDL from `packages/db/prisma/schema.postgres.sql` → fixtures (state checked)
→ restricted public role (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
NOBYPASSRLS`, `USAGE` on `public` and the reviewed grant closure below) → **[reset → baseline]** →
**[reset → baseline repeat]** → `private_ws` owned by the bootstrap role, `REVOKE ALL … FROM PUBLIC`,
private role with `USAGE` only → public table **and column** grants verified unchanged → **[reset
→ after]** → **[reset → after repeat]** → **[reset → auth evidence]** → T-ROLE suite → `private_ws`
emptiness re-checked → program validation of each capture, paired comparison of every capture
against the baseline, golden comparison of all four → cleanup → `summary.json` (status decided by
checks **and** cleanup).

Every capture is a **fresh child** running the whole ordered program, so in-process state (the
rate-limit windows, Prisma connections, module caches) never carries over. A reset uses the
bootstrap connection only: it re-reads the connection identity and the public object inventory and
refuses unless both equal the recorded run target (no `TRUNCATE` is sent otherwise), then
truncates exactly the recorded tables (`RESTART IDENTITY`, no `CASCADE`) and reloads the fixture
file in one transaction, then checks row counts of every granted table and the mutable columns
against `EXPECTED_RESET_STATE`.

Public grant closure (`PUBLIC_TABLE_GRANTS`/`PUBLIC_COLUMN_UPDATE_GRANTS` in `sql.ts`, each with
the production code path that needs it): table `SELECT` on `AuditEvent`, `CertificationProtocol`,
`Certifier`, `Citation`, `Claim`, `ClaimEvidenceRelation`, `KnowledgeNode`, `KnowledgeNodeVersion`,
`NodeAlias`, `NodeEdge`, `Notification`, `Person`, `Publication`, `PublicationCapture`,
`PublicationClaimOccurrence`, `PublicationVersion`, `Repository`, `RepositorySnapshot`, `Review`,
`ReviewContributor`, `ReviewLifecycleEvent`, `ReviewVersion`, `Submission`, `SynthesisDraft`,
`TrustAssessment`, `TrustVerification`, `User`; `INSERT` on `AuditEvent` only (append; `SELECT` is
needed for Prisma's `RETURNING`); column-only `UPDATE` on `User(orcid, orcidVerifiedAt,
updatedAt)`, `Certifier(status, activatedAt, retiredAt)` and `Notification(readAt)`. No `DELETE`,
`TRUNCATE`, `REFERENCES`, `TRIGGER`, table-level `UPDATE` or DDL. This is the minimal closure for the
captured scenarios, not a production permission policy; removing any table grant makes a captured
handler fail (verified for `Submission`, below).

Handler children (capture and auth evidence) receive exactly `PATH`/`HOME`/`TMPDIR`/`CI` when set,
`LANG`, `NODE_ENV=test`, the public runtime URL as `DATABASE_URL`, the fixed base URL
`https://g1.oratlas.example`, the non-secret session constant, `RATE_LIMIT_MAX=1000`,
`RATE_LIMIT_WINDOW_MS=60000` and their output path; they refuse admin/private/ack variables,
`PGPASSWORD`, `AUTH_MOCK`, OAuth, LLM/ORA provider and passport-key variables. The T-ROLE child
receives only the public/private runtime URLs (direct connections) and the bootstrap role **name**.
Evidence and logs are written with mode `0600` and redacted of all three passwords and any
PostgreSQL URL.

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
  `USAGE` with no `PUBLIC` entry. Public: no `USAGE`/`CREATE` on `private_ws`; effective table
  privileges exactly the reviewed closure (27 × `SELECT`, `AuditEvent` `INSERT`) **and** effective
  column privileges beyond the table ones exactly the seven reviewed `UPDATE` columns (asserted
  separately, because `has_table_privilege` misses column-only grants). Both inventories come from
  `has_table_privilege`/`has_column_privilege` (`SELECT`/`INSERT`/`UPDATE`/`REFERENCES` for every
  column), so grants to `PUBLIC` or via inheritance count, not only the role's own ACL entries; it
  reads every granted table with exactly the
  seeded row counts. Private: `USAGE` without `CREATE`, no table or column privilege on any public
  table. `private_ws` has zero tables, sequences, views, indexes, functions, types,
  collations, operators, conversions, text-search objects, extensions and statistics objects before
  and after probes (checked from both runtime roles and the bootstrap role). Catalog visibility is
  **not** hidden: both roles see `private_ws` in `pg_namespace`.
- **Probes** run inside `BEGIN … ROLLBACK` and record SQLSTATE/message; a denial probe that
  succeeds fails the suite (and is rolled back); the single positive control must succeed (rolled
  back). Recorded locally:

  | Role    | Statement                                     | SQLSTATE | Message                                                    |
  | ------- | --------------------------------------------- | -------- | ---------------------------------------------------------- |
  | public  | `CREATE TABLE private_ws.g1_probe`            | 42501    | permission denied for schema private_ws                    |
  | public  | `SELECT … FROM private_ws.g1_absent_probe`    | 42501    | permission denied for schema private_ws (not 42P01)        |
  | public  | `GRANT USAGE ON SCHEMA private_ws TO self`    | 42501    | permission denied for schema private_ws                    |
  | public  | `CREATE TABLE public.g1_probe`                | 42501    | permission denied for schema public                        |
  | public  | `CREATE SCHEMA` / `CREATE ROLE`               | 42501    | permission denied for database / to create role            |
  | public  | `SET ROLE` bootstrap / private                | 42501    | permission denied to set role                              |
  | public  | `DELETE FROM public."AuditEvent" WHERE false` | 42501    | permission denied for table AuditEvent                     |
  | public  | `TRUNCATE public."Notification"`              | 42501    | permission denied for table Notification                   |
  | public  | `UPDATE "User" SET "role" …` (ungranted col)  | 42501    | permission denied for table User                           |
  | public  | `UPDATE "Certifier" SET "slug" …`             | 42501    | permission denied for table Certifier                      |
  | public  | `INSERT INTO public."Notification" …`         | 42501    | permission denied for table Notification                   |
  | public  | `UPDATE "User"` granted columns `WHERE false` | —        | positive control: `SUCCEEDED` (rolled back)                |
  | private | `CREATE TABLE private_ws.g1_probe`            | 42501    | permission denied for schema private_ws (USAGE, no CREATE) |
  | private | `SELECT … FROM private_ws.g1_absent_probe`    | 42P01    | control only — **not** table-permission evidence           |
  | private | `SELECT … FROM public."ReviewVersion"`        | 42501    | permission denied for table ReviewVersion                  |
  | private | `CREATE TABLE public.…`, `CREATE SCHEMA/ROLE` | 42501    | permission denied                                          |
  | private | `SET ROLE` bootstrap / public                 | 42501    | permission denied to set role                              |

  Observed, not asserted as a restriction: both roles hold `TEMPORARY` and `CONNECT` on the
  database through PostgreSQL's default `PUBLIC` grants, and the public schema's default `PUBLIC`
  `USAGE` applies to the private role (with no table privilege).

- **Next request context** (`next-request-context.ts`): every handler runs inside a fresh dynamic
  API-route context built the way Next 15.5.20's app-route module builds it —
  `createRequestStoreForAPI` (phase `action`, implicit tags `{tags: [], expirationsByCacheKind}`)
  and `createWorkStore` (`supportsDynamicResponse: true`, fixed build id, PPR/cache components
  disabled), entered through Next's own `workAsyncStorage`/`workUnitAsyncStorage`; cookies set
  through `cookies()` are merged into the response as the route module does. It fails fast unless
  Next is exactly 15.5.20, the storages are real `AsyncLocalStorage` (a dedicated setup file installs
  it before Next loads; an offline test proves the import-order failure is caught), and the internals
  are the same module copy as the application's `next/headers`. Nothing in `next/headers`,
  `getCurrentUser`, the session token functions, Prisma or domain queries is mocked; only the
  `server-only` marker is aliased. This is actual handler + request-context evidence, **not** a
  running Next server: routing, middleware, RSC/HTML rendering and wire serialization are not
  exercised.
- **T-PUB scenario program** (`scenarios.ts`, `public-routes.g1.spec.ts`): 51 ordered records, Date
  (only) fixed at `2026-04-01T00:00:00.000Z` for the whole program, global `fetch` blocked. HTTP
  (46): the eight earlier anonymous requests (`/api/health/ready`, `/api/health`,
  `/api/feeds/atom` now with three entries v4, v2, v1, `/llms.txt`, both OpenAPI documents and their
  `304`s); `/api/search?contentType=review&sort=title&pageSize=1` pages 1 and 2 (total 2, title
  order); `/api/claims` (two claims); `/api/graph` source-assertion seed with `limit=1`, page 2 via the
  signed `nextCursor` of page 1 (RateLimit headers captured, not normalized); `/api/feeds/lifecycle`
  (two events with exact actor/version/SHA/order); `GET /api/notifications` anonymous `401`, each of
  the five users `200` with only its own seeded notifications, malformed / signed-expired /
  tampered / signed-missing-user sessions `401`; `POST /api/notifications` own mark-read `200` and
  cross-user `404`; `POST /api/profile/orcid` `{orcid:null}` anonymous `401`, each user `200`
  `verified:false`; `GET /api/editorial/ora-certifications?publicationVersionId=…` anonymous `401`,
  USER principals `403`, EDITOR/ADMIN `200` with `available:false` (providers disabled; `POST` not
  called); `POST /api/editorial/certifiers/g1-certifier-1/status` active→suspended anonymous `401`,
  USER/EDITOR `403`, a cross-site `Sec-Fetch-Site` control `403` from the CSRF precheck, ADMIN
  `200`. All mutations send `Content-Type: application/json`, `Origin: https://g1.oratlas.example`
  and `Sec-Fetch-Site: same-origin`, so role outcomes are not CSRF `403`s. Three `db-state`
  projections (after mark-read, after the first ORCID clear — only A-only changed, one audit row —
  and final) record users' ORCID fields, notification `readAt`, certifier status/timestamps and
  audit rows reduced to actor/action/subject/details with their count; audit UUIDs/default
  timestamps/platform version and `User.updatedAt` are deliberately not captured. Two
  `metadata-loader` records serialize the outputs of `app/sitemap.ts` and `app/robots.ts` (Dates as
  ISO strings) — static, review, version and node URLs present, the control review/version/node
  absent, robots exact — and are **not** HTTP responses.
- **Program validation and comparison** (`compare.ts`): each capture must be exactly the program —
  ids unique and in order, exact request method/path/headers/body, cursor and ETag inputs derived
  from the earlier records, principal/session recipe consistent (a user principal must dispatch a
  valid session of exactly its own fixture user; anonymous never a valid one), dispatched cookie
  hash equal to the recipe re-signed with the production signer (in the child), exact status, error
  statuses only where the program declares that exact denial code and message, non-empty
  collections, JSON facts, excluded controls, metadata and state expectations. Paired comparison
  requires byte-identical records (status, `Headers` view, `Set-Cookie`, body bytes, request and
  principal) across baseline, baseline repeat, after and after repeat; the golden comparison
  requires the reviewed bytes and cross-checks every golden status against the program, so a golden
  can never authorize an undeclared error. Only `date`/`x-request-id` may be normalized. Headers are
  the Fetch `Headers` view: names lower-cased, iterated in sorted order and duplicate fields joined
  with `, `; raw on-the-wire order and Next's own response-header additions are not observed.
- **Auth evidence** (`auth-context.g1.spec.ts`, own fresh child after a reset): fixture tokens come
  from production `createSessionToken` with the fixed non-secret secret and issue time and read back
  with `readSessionToken`; `getCurrentUser` returns exactly each user's id/login/display
  name/role projection (anonymous `null`); `requireUser`/`requireEditor`/`requireAdmin` give the full
  six-principal matrix (anonymous `401`×3; USER ok/`403`/`403`; EDITOR ok/ok/`403`; ADMIN ok×3); the
  four invalid sessions resolve to no user and `401` (only the signed missing-user token passes the
  token check and fails at the `User` lookup); six overlapping and four alternating A/B/A+B/anonymous
  contexts never see another context's user; afterwards no store is active and `getCurrentUser`
  outside a context is refused.
- **Cache helper** (`apps/web/src/lib/private/cache-control.test.ts`): synthetic handler only;
  success/500/generic 404 keep status and body and get `Cache-Control: private, no-store`, `Vary`
  with `Cookie`, no `ETag`/`Last-Modified`; a conditional request receives the normal full body; a
  `304` is refused (`PrivateResponseError`), never rewritten into a body-less `200`; two principals
  receive their own bodies; `Vary` merging is case-insensitive with no duplicates, multiple `Vary`
  lines are merged and `Vary: *` is preserved; the public OpenAPI `ETag`/`304` behaviour is
  asserted unchanged. Not evidence of authorization, CDN or Next deployment caching.

### Coverage expansion (2026-10-20, local synthetic)

Implemented on `05a4854` in a dedicated worktree, local and synthetic only (no hosted run, no real
data or providers, no production auth/migration/private tables). Node 24.21.0, pnpm 10.33.0 via
corepack, a dedicated loopback `postgres:16` container created for this run and removed afterwards.

```bash
pnpm install --frozen-lockfile
pnpm --filter @oratlas/db db:pg:schema && pnpm --filter @oratlas/db db:generate:postgres
G1_TEST_ADMIN_DATABASE_URL=… G1_TEST_PUBLIC_DATABASE_URL=… G1_TEST_PRIVATE_DATABASE_URL=… \
  G1_TEST_DISPOSABLE_TARGET_ACK=disposable-g1-target:127.0.0.1:<port>/oratlas_g1 \
  G1_EVIDENCE_DIR=<dir> pnpm g1:private-workspace
pnpm exec vitest run scripts/private-workspace-g1 scripts/architecture-boundaries.test.ts
```

- `pnpm g1:private-workspace`: exit `0`; all 26 checks and all four cleanup steps `ok`; four
  capture children each validated against the 51-record program (27 × `200`, 2 × `304`, 8 × `401`,
  8 × `403`, 1 × `404` declared denials, 3 state, 2 metadata), all byte-identical to the baseline and
  to the golden; auth evidence 6/6; T-ROLE 7/7 (13 public denial probes `42501` plus the positive
  control); afterwards no `oratlas_g1*` role, no `private_ws` and no public object; no password in
  any evidence file or log.
- Real-PostgreSQL regression injections, each reverted byte-identically: dropping only the
  `Submission` grant → the baseline capture fails (`42501 permission denied for table Submission` →
  graph `500`); making the control review `published` → program validation fails (search totals
  3, the control in search/claims/sitemap, wrong claims count). The dedicated config without
  variables fails all three suites (no skip).
- Offline: G1 suite 82 tests and architecture guard 116 (198 total), including the Next-context
  fail-fast/bleed tests and regressions for principal swap, dropped/forged cookie, missing,
  duplicate, extra and reordered records, unknown versions and v1 upgrade, body/header/`Set-Cookie`
  differences, undeclared and mismatched denials, empty collections, changed order, wrong cursor or
  ETag, leaked controls, metadata and state drift, reset failure/target drift/dirty state,
  principal-swapped capture and closed child environments.
- The golden was regenerated deliberately from `golden-candidate.json` after inspection: the seven
  unchanged legacy records are byte-identical to the v1 golden, `feeds-atom` gains the second public
  review, and the new records match the program. Its `review` field records that independent
  review is pending.

### Parent integration and review — coverage alpha (2026-10-20)

Independent re-review closed the effective-column-privilege finding and the final child-environment
type repair with no new blocking findings. The v2 golden and four 51-record captures were checked
against their body hashes and request/session contracts. This is review of the bounded 14-route
coverage, not acceptance of the remaining route groups or completion of G1.

Fresh parent validation after integration: **249 test files / 2,177 tests passed**, with 6 existing
opt-in PostgreSQL files / 16 tests skipped in the ordinary suite; **262 focused tests passed** across
G1 offline, architecture and local ordering fixtures. Workspace lint/typecheck, schema/OpenAPI checks,
explicit script-aware TypeScript compilation (including `.g1.spec.ts` and Next imports), supported-file
Prettier checks and diff checks passed. The first parent suite attempt had incomplete workspace
module links; a frozen install and local Prisma generation fixed the environment before the successful
runs. No build or browser E2E was rerun for this expansion. Dedicated real-PostgreSQL evidence is
separate from ordinary-suite skips.

The first implementation worker timed out; its artifact was recovered and independently reviewed,
not accepted on timeout alone. Sanitized PostgreSQL evidence: `/tmp/alpha-g1-f708-evidence-2/` and
`/tmp/g1-f708-pg.9rePZZ/{clean,inject,headinject}/`. Parent final logs:
`/tmp/alpha-parent-final-full-tests.log`, `/tmp/alpha-parent-final-focused.log`, and
`/tmp/alpha-parent-script-typecheck-final.log`.

**Historical epic boundary for the 2026-10-20 expansion:** that snapshot had 119 unexecuted
route files; the public-artifact extension below reduces this to 116. The documented pages/channel gaps remain.
No private application tables, session/persistence adapters or workspace browser demonstration were
added by this slice. Those dependent slices remain gated; the local effect-ordering fixture is not
PostgreSQL session/persistence evidence. Session-instance storage and lifecycle/retention choices
remain subject to the existing owner/design prerequisites. D11 remains provisional.

### Commands and local results — initial G1-empty implementation (2026-10-20, Node 24.21.0, PostgreSQL 16 `postgres:16` container)

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
`/tmp/oratlas-g1-607a-evidence-repair/`. No GitHub CI run was claimed for that historical
repair; the later dedicated workflow passed on #225.

Effective-privilege repair (2026-10-20, local synthetic, `postgres:16` 16.15 loopback container
created for this check and then removed). An independent review found that the column inventory
read `attacl` filtered to the role's own grantee. That missed grants to `PUBLIC` (grantee 0) and
inherited grants. `has_table_privilege` also misses column-only grants. As a result,
`GRANT UPDATE ("githubLogin") ON public."User" TO PUBLIC` let both runtime roles update the column
and T-ROLE still passed.

- `columnPrivilegesSql` now lists, for every public column, each of
  `SELECT`/`INSERT`/`UPDATE`/`REFERENCES` that `has_column_privilege` allows and
  `has_table_privilege` does not already grant. The table inventory is unchanged (it was already
  effective). The posture and before/after grant snapshots use both inventories. No grants or
  revokes were added.
- Offline: a new regression in `postgres.test.ts` pins the effective-privilege functions, the four
  column privileges, and the absence of any `aclexplode`/`attacl`/`grantee` filter. G1 offline
  suite 83/83.
- Real PostgreSQL, same target:
  - Clean run: exit 0, 26/26 steps, 4/4 cleanup. The public column inventory is exactly the seven
    reviewed `UPDATE` columns; the private role has none.
  - With the `PUBLIC` grant injected into `createPublicRoleSql`: exit 1. Only T-ROLE fails (2 of 7
    tests: the public and private posture tests both show `["User","githubLogin","UPDATE"]`).
    Probes and fixture reads still pass. Baseline/after captures are byte-identical to the clean
    run. No golden candidate is written. Cleanup is 4/4 `ok`, and afterwards there are no
    `oratlas_g1*` roles, no `private_ws` and no public objects.
  - The same injection against the `HEAD` query: exit 0, T-ROLE 7/7, private column inventory
    `[]`. This confirms the gap.
  - Each injection was reverted, and the sha256 match was checked.
- No password appeared in any evidence file or log. The env file and container were removed, and
  the worktree's Prisma client was regenerated for SQLite.

Script-aware typecheck repair (2026-10-20, offline). A `tsc --noEmit` over
`scripts/private-workspace-g1/**/*.ts` (including the `.g1.spec.ts` files and their real Next
imports) failed: Next's global `NodeJS.ProcessEnv` requires `NODE_ENV`, so the closed child
environments did not type as `spawn` env. Spec children now use `G1ChildEnv` (string record with
`NODE_ENV: "test"`, already the runtime value); the psql child env adds a fixed `NODE_ENV=test` (no
other inherited value); `runG1Harness` takes a plain optional-string record; the two offline
`spawnSync` tests pass `NODE_ENV=test`. No casts. That `tsc` run now passes; the G1 offline and
architecture suites pass (8 files, 199 tests).

Golden updates: each run writes `golden-candidate.json`; a reviewer compares it with the current
golden and copies it deliberately. The harness never overwrites or accepts a golden after a failure,
and a golden cannot change an expected outcome: statuses, denials, collections and state live in
`scenarios.ts` and every golden status is checked against them.
The OpenAPI golden is tied to `docs/openapi.yaml` and the generated ETags by an offline test, so a
contract change requires a reviewed golden update in the same change.

### Public artifact coverage extension (2026-10-21, local synthetic)

Baseline: `main` at `154b399`. This extension adds **42 HTTP records** to the existing
51-record program: **93 records**, comprising 88 HTTP requests, 3 state projections and
2 metadata loaders. The current manifest derives **17 of 133 route files exercised** and
**116 unexecuted** from the route tree. A/B remain public-user fixture labels; no private
workspace or membership exists, and **G1 remains partial**.

All six principals (anonymous, A-only, B-only, A+B, EDITOR and ADMIN) execute:

- `GET /api/publication-captures/{id}`: exact source version/path/hash/byte length,
  metadata-only output and missing-id `404`. The source capture stores a distinctive raw
  inert marker as base64; metadata must contain neither the raw nor encoded retained bytes.
- `GET /api/publication-versions/{id}/packet`: two exact captured artifact metadata entries,
  schema `1.3.0`, a recomputed canonical packet digest, no retained bytes and missing-id `404`.
  Contributor and production snapshots are empty controls; their two tables receive explicit
  `SELECT` grants solely for this public packet path, with no added write grants.
- `GET /api/reviews/{slug}/versions/{versionId}/files/{path}`: exact inert text download,
  attachment filename, plain-text content type, `nosniff`, `no-store, must-revalidate` and
  `Pragma: no-cache`. Missing and pre-seeded tombstoned versions produce identical `404`
  status/body/headers. The tombstoned row belongs to a published review and references the
  same populated preserved snapshot as the readable version, so denial is not a missing-file
  or withdrawn-review artifact.

The scenario comparator independently checks exact body/header expectations and response
equality across principals (including status, bytes/digest/length, normalized headers and
cookies). Fault-injection unit tests fail on retained-byte leakage, an extra principal-specific
metadata field, a stripped attachment header and changed download bytes. This covers the
handler response boundary; it does not test a lifecycle transition, in-flight revocation,
Next serving, a browser or deployed/CDN cache invalidation.

Observed validation on PostgreSQL **16.15**, Node **24.16.0**:

- A newly initialized, password-authenticated, loopback-only PostgreSQL cluster served a new
  acknowledged disposable database. No existing service/database or system installation was
  modified. The first complete run passed all four program captures, auth and role suites,
  and paired comparisons, and correctly failed against the old golden. The candidate was
  regenerated deliberately from that validated baseline capture; all previous **51 record
  values were unchanged**. The additional 42 records and review text were independently
  reviewed as recorded below.
- Final `pnpm g1:private-workspace` equivalent: **26/26 steps passed**, all four independent
  **93-record** captures matched the program and golden and each other, auth **6/6**, role
  **7/7**, cleanup **4/4**. Final result explicitly remains `passed (G1-empty partial coverage only)`.
  Sanitized evidence: `/tmp/oratlas-private-g1-evidence-final/`. A direct post-cleanup
  query found zero public relations, zero `private_ws` schemas and zero run-specific runtime
  roles; scanning every evidence file found no fixture passwords.
- Focused offline safeguards, architecture, cache and public regressions: **11 files,
  221 tests passed**. Outcomes in each public capture: 45 × `200`, 2 × `304`, 8 × `401`,
  8 × `403`, 25 × `404`, plus the five state/metadata records.
- Independent root review inspected the patch, minimal SELECT grants, comparator expectations,
  unchanged 51 golden records and source/tombstone fixtures, with no blocking findings for this
  bounded slice. The root independently reran the actual PostgreSQL harness: **26/26 steps**,
  four **93-record** captures, auth **6/6**, role **7/7** and all cleanup passed. Sanitized
  independent evidence: `/tmp/oratlas-private-g1-root-review/`. This review and repeat do not
  record the complete G1 gate as passed.
- G1 script-aware TypeScript check uses the new reusable configuration below. It includes the
  actual `.g1.spec.ts` files and their Next/application imports, with no casts or suppressions.
  The dedicated G1 CI workflow now runs this check explicitly, because the monorepo workspace
  typecheck does not include root scripts. ESLint, Prettier and `git diff --check` passed on
  the change. No full suite, build, browser E2E or GitHub CI result is claimed for this local extension.

Final integration rerun after rebasing onto `main` at
`da80dbebe102928bf7c1b4e518a525e763abc983` (#226): **11 files / 223 focused tests** passed
(the main-branch architecture suite gained two tests); the script-aware TypeScript check,
ESLint, Prettier and diff checks passed. The full disposable PostgreSQL harness again passed
**26/26 steps**, four **93-record** captures, auth **6/6**, role **7/7** and cleanup **4/4**.
Sanitized final evidence: `/tmp/oratlas-private-g1-evidence-rebased/`. The root re-reviewed
the rebased implementation with no new blockers. These public fixture comparisons do not
establish private workspace authorization or complete the G1 gate.

Reproducible checks (with dependencies and a generated PostgreSQL client):

```bash
pnpm exec vitest run scripts/private-workspace-g1 scripts/architecture-boundaries.test.ts apps/web/src/lib/private apps/web/src/lib/openapi-response.test.ts apps/web/src/app/llms.txt/route.test.ts
pnpm exec tsc --project scripts/private-workspace-g1/tsconfig.json
pnpm g1:private-workspace
```

The last command requires all dedicated G1 variables and the disposable-target acknowledgement
above; missing infrastructure fails rather than skipping. Runtime, private-storage and
publication/export policies are unchanged. All nine existing review export formats are
now exercised by the method-aware batch below; other mutation/provider gaps remain explicit.

## Expanded method-aware public captures — 2026-10-21

Integration baseline: `9ed83ed` after #228/#229. This batch expands the reviewed
program from **93 to 895 records**: **878 HTTP**, **15 state projections**, and
**2 metadata loaders**. It exercises **56/133 route files**, **57/143 exported
methods**, and all six principal cases on **56 methods**. The remaining method
is the existing notification POST, whose broader principal matrix is still a gap.
The static inventory explicitly lists **77 route-file gaps, 86 method gaps and
40 rendered source surfaces**, plus non-HTTP/timing evidence. **G1 is not passed.**

- `principal-matrix.ts`: 70 additional signed-session public read requests, reusing
  existing health/feed/OpenAPI/search/claim/graph assertions before any mutations.
  Graph rate-limit headers remain exact and intentionally vary with request order.
- `discovery-scenarios.ts`: 378 real GET requests over canonical nodes, exact
  versions/passports, reviewed public relationships, source occurrences, nine
  review export formats and populated public author/software declarations. See
  [discovery evidence](../scripts/private-workspace-g1/discovery-coverage.md).
- `scholarly-scenarios.ts`: 192 requests for comments, annotations, challenge
  ledgers/exports, replication briefs and protocol snapshots. Removed, unpublished
  and tombstoned canaries remain withheld. SQL fixture tests use the real challenge
  ledger/integrity validators and public URL contract; no schema was relaxed.
- `editorial-scenarios.ts`: 150 requests and 12 exact state checkpoints for public
  registries and three ADMIN mutations, including denied/no-write checks,
  persisted target/control reads, exact audit deltas and idempotence. See the
  [editorial record](private-workspace-g1-editorial-coverage.md).

The fixtures revealed a real route bug: malformed node challenge cursors returned
500 in the register and both exports. The three GET handlers now map only typed
`ChallengeError` instances; unexpected or duck-typed errors retain sanitized 500s.
Twenty-one route regressions cover these cases; a negative control against the
old handlers fails the three malformed-cursor assertions. No POST behavior changes.

The additional role privileges are an enumerated public SELECT closure plus
column-only protocol/verifier status writes required by actual handlers; no
private schema/table/credential grants or blanket writes are added. Every reset
loads all four synthetic fixture files and verifies exact counts before capture.
The ORA protocol's old invalid placeholder is repaired in its original INSERT,
never by changing an immutable row. New contributor/software assertions derive
from exact native MyST 0.3 manifest bytes, with production normalization tests,
0.2 rejection controls and source/claim/corpus digest checks. This is a synthetic
native fixture, not evidence of an upstream producer execution.

Before golden replacement, the complete real-PostgreSQL run passed every capture
outcome, all four reset-based paired comparisons, auth 6/6, roles 7/7 and cleanup
4/4; its only failed check was the expected old 93-record golden mismatch. All
**93 previous record values were unchanged**. Evidence after native fixture
repair: `/tmp/oratlas-g1-integrated-native/`. Independent review approved candidate
SHA-256 `5c36d72c848b4d4c091db33708a6316e888e3c1bdef1b22f343f0fb0dde902b5`.
The checked-in golden is formatted by Prettier; its parsed content is exactly
identical to that reviewed candidate (formatted file SHA-256 `5e0920de352a9422a2a32a5a2e0be92a91a83582e05498044c0841c97e7e0617`).
After copying the candidate, a fresh full run passed **26/26 steps**, all four **895-record**
captures, auth **6/6**, roles **7/7** and cleanup **4/4**; evidence is
`/tmp/oratlas-g1-integrated-final/`. A scan of all 14 evidence files found none of
the three disposable database passwords. Focused offline/architecture/cache/route
regressions passed **284 tests** across runs; the four stale test expectations
exposed by integration were updated explicitly and all 44 affected tests reran
green. Script-aware TypeScript, lint, formatting and diff checks passed. Full
final-head GitHub CI remains required before merge. These results still do not
record G1 as passed.

### Outstanding (not covered; G1 must not be recorded complete on this basis)

- Populated T-ROLE (`SELECT`/DML denial, ownership and RLS on real `private_ws` tables) and the full
  §11 T-PUB matrix with seeded private A/B content. At G1, A/B are labels on public users only.
- 77 of the 133 public route files and 86 of 143 exported methods, including the other
  editorial/certification/verification mutations, submissions/ingestion, federation and
  OAuth start/callback (never activated).
- Next HTTP serving: routing, middleware, RSC/HTML pages, page metadata/JSON-LD/OpenGraph, and the
  `/sitemap.xml` and `/robots.txt` HTTP serialization (only the loader outputs are captured).
- Non-HTTP channels (jobs/CLIs, backups, search index, logs/audit sinks, email, external lookups)
  and timing evidence.
- Deployment/CDN caching and any decision on whether the dedicated workflow becomes a required
  check. Its #225 pass is existing evidence, not completion of the unimplemented G1 surfaces.
- Independent acceptance of the complete G1 gate evidence. The bounded patch review and
  PostgreSQL repeat above do not cover the remaining surfaces or populated matrices.

References: [ADR test matrix](./private-workspace-security-architecture.md#11-test-matrix-and-acceptance-mapping), [G1 gate](./private-workspace-security-architecture.md#13-rollout-gates-and-migration-consequences), [R0 evidence limits](./private-workspace-r0-review.md), [identity interfaces/limitations](./identity-link-foundations.md), [next-phase plan](./private-workspace-poc-next-phase.md).

## Protocol, editorial-read and index integration — 2026-10-21

This bounded extension starts from `07ef428635c02f93fef5968dadfe9837ab55a5c4`
(after #232), with no production code, private table, provider, external tester or
deployment changes. The HTTP program now has **1,165 records**: **1,148 HTTP**,
**15 database-state** and **2 metadata-loader** records. It exercises **71/133
route files** and **73/143 methods**; **72 methods** have all six principal cases.
Four worker GETs have denial-only evidence; user cookies never substitute for
worker credentials. The remaining **62 files/70 methods**, rendered surfaces,
other operational channels and timing remain explicit gaps. **G1 is not passed.**

The additional 162 protocol requests cover seven populated public GETs plus four
worker-only authentication controls. Native signature, packet, result and finding
validation runs unchanged, including tampered/unknown-key and corrupt-artifact
controls. Only the exact committed public synthetic trust keys are injected in the
test runner after its closed-environment assertion; inherited trust remains
forbidden. See [protocol scope](../scripts/private-workspace-g1/protocol-coverage.md).

The additional 108 editorial/federation/proposal requests cover four GETs and
OPTIONS, including populated open process history, exact role and visibility
controls, native request/announcement bindings and accepted-only pagination.
Independent review repaired unreachable fixture states and provenance before
acceptance. OPTIONS returns empty 204 responses; absence of a CORS grant is now an
independent `absentHeaders` expectation with an added-header rejection regression.

The actual `buildKnowledgeIndex` consumer runs in a fresh child after its own reset
for every baseline/repeat/after/repeat label. Supplemental index exclusion fixtures
never enter the HTTP program. The consumer uses the same reviewed public runtime
authority: **64 explicit SELECT tables**, existing AuditEvent INSERT, and **12
column UPDATE privileges**. No new runtime writes are granted. Canonical function
output and full-row state digests compare separately from HTTP bodies; the
evidence envelope correctly records differing private-schema existence. The
Date-only clock is bound, and real same-count update controls reject drift and
roll back. Raw child stdout/stderr is checked before logs are preserved; refused
output fails the run, so redaction cannot turn a leaking sink into passed evidence.

The expanded row-count probe uses `json_object_agg` over rows: PostgreSQL's
100-function-argument limit made the previous 50-table `json_build_object` pattern
fail after the grant closure grew. Shared reset and T-ROLE queries now use the same
aggregation without dropping tables or weakening expected counts.

Independent review approved both candidates from the complete local lifecycle
(`/tmp/oratlas-g1-operational-candidate`): HTTP candidate SHA-256
`25b7c97c3ce6a1e0dfb89de31f8d1f7ff284a5f2e68b1c1a9ab5ddf74ed1ef2b`,
index candidate `dfcaecc384ebeceebc5b41d4fc106b27d762818513c7e962efd304125161e515`.
The index output digest is
`0aafb06b1a793898811bba4334c9daff58278e0ffb0d1df28455bcb6218400f2`;
the original four 64-table public-state digests were
`bc8942566a9ece20ceda2fe46e5d11ab479927e813a07388f4265ee62f726b46`.
Manually accepted baselines add review metadata and formatting; compared data is
unchanged. No candidate is copied automatically. The final baseline-backed local
run (`/tmp/oratlas-g1-operational-final`) passed **42/42** steps, including auth
**6/6**, role **7/7** and cleanup **4/4**. All **270** focused G1/architecture
tests passed; 23 evidence/log files had no credential matches. Final-head CI
remains required.

Exactly **12 of the previous 895 record bodies** change from populated fixtures:
six publication-version certification counts become 1, and six claim passports
gain the native open/retracted and dismissed/corrected update alerts. Both now
have independent scenario assertions. Their envelopes and the other **883 record
values** are unchanged; the original 93-record historical program remains intact.
See the [operational channel ledger](private-workspace-operational-channel-ledger.md)
for bounded index evidence and the remaining jobs, CLIs, recovery and sink work.

A subsequent native source-artifact probe found that the discovery fixture stored
two `PublicationCapture.contentBytes` values as base64 text, while native
registration stores decoded UTF-8. The production reader correctly rejected the
fixture bytes. The fixture and its test oracle now use the exact native UTF-8
representation (1,298 manifest bytes and 71 source bytes, including trailing
newlines); hashes, metadata and production validators are unchanged. Independent
review compared every row: only those two stored values change. All 1,165 HTTP
records and the canonical index output remain identical.

The independently reviewed corrected index candidate SHA-256 is
`bf6b05f5ae03b6f6aaa5eb724ea7e287f612ce472a65e4c077c3d6fc8ef4d15b`;
its four public-state digests are
`40e66352b8e29901930a084fcc90e4b988eadc5751d90808e7870c212904595f`.
Only the two state digest fields and review metadata were manually updated in the
index golden. The corrected baseline-backed lifecycle in
`/tmp/oratlas-g1-native-storage-final` passed **42/42** steps, auth **6/6**, role
**7/7** and cleanup **4/4**. A separate native-fixture/architecture run passed
**121** tests. This correction supersedes the original state digest above; it
does not establish complete G1 coverage or enable private data.

## Isolated authority and synthesis programs

The fixed supplemental catalog runs three independent HTTP programs after their
own full fixture reset for each of baseline, baseline-repeat, after and
after-repeat. None is appended to an earlier mutated state. The original program
now has **1,177 records**: its previous 1,165 records are unchanged and twelve
new GitHub OAuth start/callback cases return the actual provider-disabled 400
under every user session, without redirects or Set-Cookie. No OAuth positive,
provider exchange or session creation is inferred.

- **Worker reads: 270 requests**, 24×200, 96×401, 126×403 and 24×404. Four real
  worker GETs read native frozen input/source bytes under verifier or certifier
  credentials; user cookies cannot supply worker authority. Native claim and
  transition history binds the submitting credential, lease generation, exact
  300-second lifetime, scope and owner. Every request preserves complete
  credential rows, allowing only the native authenticated credential's fixed
  lastUsedAt stamp. Ownership/lease denials after successful authentication can
  legitimately stamp that field. Its values are retained and compared, separately
  from a complete database digest of the remaining fields.
- **Known mutations: 62 requests**. A real notification POST establishes the
  declared starting state; five later own-notification writes are the only
  permitted row changes. Every other request compares all columns of every
  public SELECT table exactly, including native comment/audit timestamps and
  IDs. Comment removal cases here are missing, forbidden or already removed;
  fresh removals remain a separate observation below.
- **Synthesis: 108 requests**. A real deterministic writer and ADMIN acceptance
  pipeline produced a six-section synthesis with one grounded citation and
  separate software/editor attribution. Native accepted federation notification
  detail and a populated contradiction map have genuine hidden/tombstone
  controls. Archive, feed, inbox and claim observers exercise the supplemented
  corpus. All public table rows remain unchanged. Root-shaped synthesis errors
  require an explicit denial-envelope declaration; nested errors stay the
  default, with no fallback matching.

The measured public role now has **72 SELECT tables**, the existing append-only
audit INSERT and **14 column UPDATE grants**. Six additional synthesis projector
relations and two worker credential tables explain the eight new SELECTs. The
only extra updates are the two credential lastUsedAt columns. The parent counts
**all 87 recorded schema tables** before/after each supplement, including the
synthesis generation lineage row that the public role cannot read. Supplement
deltas are exactly 28 synthesis rows and 37 worker rows, with no count exception.

Each fixed child must succeed and produce its state sidecar; the parent checks
its independently declared outcomes, three pairs of exact HTTP/state evidence
and its separate manually reviewed golden. Candidates never become goldens
automatically. Only Date/request-ID normalization already documented is allowed;
no response body field is stripped. The supplemental sidecars retain native
identifiers and timestamps exactly. The primary program keeps its previously
documented selected-state projection exclusions; this batch does not extend
them or claim a complete mutation-state proof for that historical projection.
The first 64-table state digest remains `40e66352b8e29901930a084fcc90e4b988eadc5751d90808e7870c212904595f`;
adding eight empty dependencies gives the independently reconstructed
72-table index-state digest `9e76209ef545a88c382e6e060840daa2af8ad03ba3286913f5c93225d61f4edb`.
The canonical index digest remains `0aafb06b1a793898811bba4334c9daff58278e0ffb0d1df28455bcb6218400f2`.

Worker recipes never persist raw Authorization, Cookie or lease headers. Optional
authority recipes and digests bind the actual dispatched headers; old capture
records omit these fields entirely. Capture bodies, raw child stdout/stderr and
complete state sidecars are checked before persistence. Both supported legacy
capture and golden formats have decoded-body/raw-header controls; unsupported
legacy authority fields fail closed. Disclosure errors never echo the capability.

The separate **24-request fresh-removal observation** executes real owner, editor
and ADMIN removals with exactly one attributable audit each, then repeat/denial
controls. Two HTTP captures match, but native comment updatedAt and audit IDs/times
vary. Raw sidecars preserve these values and measured real-clock windows; the
explicit bounded observation is not wired into strict G1 acceptance and does not
waive the unresolved native entropy requirement. See
[fresh-removal evidence limits](../scripts/private-workspace-g1/fresh-removal-observation.md)
and [worker read details](private-workspace-worker-read-probe.md).

This is synthetic local/CI evidence. Session-instance/epoch and identity lifecycle
decisions remain those approved in the owner decision record; private schema
tables, live providers, real private data, testers, deployment and erasure/reuse
remain gated on their respective prerequisites.

Final local validation in `/tmp/oratlas-g1-authority-final` passed **105/105**
checks, auth **6/6**, role **7/7** and cleanup **4/4**. Four captures of each
1,177/270/62/108-record program and four index captures match the independently
reviewed baselines and pairs. All **62** harness evidence/log files contain no
dedicated database credential, worker capability or secret component, including
decoded response-body checks. The required offline G1/architecture/public-response
suite passed **340 tests in 34 files**; full G1 TypeScript, zero-warning lint,
formatting and diff checks also passed. Required CI must pass on the final PR
head before merge; none of these counts completes G1.

Independently approved candidate file SHA-256 values (review metadata is added
manually in the committed goldens):

| Program            | Candidate SHA-256                                                  |
| ------------------ | ------------------------------------------------------------------ |
| Primary 1,177      | `bdb0c53c78baadffcc38fa60efc0159fb7f60f4c14d24def03f4c0c370228d34` |
| Worker 270         | `a7529d15963a05ac22d73580dddf92ad0e1fe2f12ef24fb4b07b635301a46544` |
| Known mutations 62 | `7497906da297718211be5651ef8e4c531510cd6d2bb0490fd905f51e5c62a6bb` |
| Synthesis 108      | `98fc78fbdcd39624b681d9cfc025d8257701965fe77c04b8f93a4941f0b5e8f9` |
| Public index       | `938b3ce02493c6b337695983a8169f9a7a310c7611777ee373d1043f24fd1f41` |

The corrected native worker history changes exactly six verification-input
positive response capturedAt values from 00:00 to 23:58; this is the native input
capture preceding the 23:59 claim/start and 00:04 expiry. The other 264 worker
records and every previously accepted program/index candidate are unchanged.
The raw producer JSON/log contains no lease/bearer capability.

The first PR CI run exposed a locale difference in the known-mutation sidecar's
ORM user/notification array ordering. All public HTTP bytes and all 72 raw SQL
state tables already matched. Comparing every CI label against the reviewed
local evidence proved that sorting only the four complete ORM collections by
explicit binary ID removes every difference, without changing a row or field.
The producer now applies that order before serialization; its SQL snapshots
continue using COLLATE "C". Existing reviewed goldens are unchanged. A regression
control covers the a-only/admin ordering and retains every native field.
