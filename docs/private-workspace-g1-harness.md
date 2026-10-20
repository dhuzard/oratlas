# G1 isolation-test harness specification

**DRAFT — not implemented, executed or gate-passed.** Baseline: `main` at `bb166fa` after #219. This specifies the next bounded implementation task under #204; it does not approve identity policy, ratify ADR §14/§15 or resolve D11.

## Gate and scope

[ADR §13 G1](./private-workspace-security-architecture.md#13-rollout-gates-and-migration-consequences) requires T-IMP, T-ROLE, T-PUB harness and a `private, no-store` helper running in CI against an **empty private schema**, with public-contract snapshots. Passing G1 unlocks creation of private tables, **not storage of real private data or enablement of a workspace service**. This document alone passes nothing.

The §11 final T-ROLE matrix needs actual tables; final T-PUB needs seeded private A/B content. G1 provides executable empty-schema prerequisites and a harness for those later tests, not a vacuous claim that nonexistent tables or private rows were protected. Record coverage as **G1-empty** versus **populated matrix deferred**. Any unresolved interpretation of this staging must be reviewed explicitly, not hidden by naming all tests “passed.”

Non-scope: private application tables, migrations for workspace content, OAuth activation, session persistence, production credentials, private endpoints/UI, RLS/runtime authorization, KMS, external connectors and real research data. The [owner register](./private-workspace-owner-decisions.md) tracks separate policy-dependent prerequisites.

## Disposable environment and connections

- Use PostgreSQL 16 in a dedicated disposable CI service/database. Existing CI has a PostgreSQL job; reuse its pinned-action/Node/pnpm conventions, not its bootstrap credentials as runtime credentials. Preserve existing SQLite/unit and PostgreSQL regression suites.
- Bootstrap/admin connection provisions roles, public test fixtures and an empty `private_ws` schema only. Public runtime and private runtime use distinct **direct connections**, not an admin session with a claimed application role. No bootstrap connection enters route tests or runtime environment.
- Proposed dedicated variables: `G1_TEST_ADMIN_DATABASE_URL`, `G1_TEST_PUBLIC_DATABASE_URL`, `G1_TEST_PRIVATE_DATABASE_URL`. These names/scripts are not present or runnable yet. Require all three in the dedicated job; absent PostgreSQL/URLs is a failure, not a skip or SQLite fallback.
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

The future implementation must provide the actual helper and tests, not just this specification. Proposed location: `apps/web/src/lib/private/cache-control.ts` (not created here); finalize the path during implementation to preserve import boundaries.

Test success, error and generic denial responses through a synthetic handler, without adding a production endpoint. Require `Cache-Control: private, no-store`; merge `Vary: Cookie` with existing tokens case-insensitively (preserving `Vary: *`); remove content-derived validators. Choose and test no content-derived ETag/Last-Modified and no conditional 304 in the fixture pipeline. A header mutator alone cannot prevent an upstream cache from already returning 304: test the actual response composition boundary and state limits.

Use two synthetic principals to exercise absence of response reuse. This is a helper/cache fixture, not proof of workspace authorization, CDN/Next deployment behavior or all future routes. Existing public cache behavior stays unchanged.

## Proposed implementation and CI acceptance

1. Add isolated setup/assertion/cleanup utilities plus PostgreSQL role tests, the coverage manifest/public response harness, helper and helper tests; extend the existing architecture test. New names/paths are implementation proposals, not existing commands.
2. Add a dedicated required CI job/step with explicit disposable PostgreSQL connections. Generate Prisma/configure public fixtures using repository conventions; no hardcoded branch checkout, unpinned replacement actions or live providers. Missing infrastructure must fail the dedicated test path. Normal offline test runs must not accidentally contact a database.
3. Run focused suites plus existing public-contract/architecture regressions and relevant lint/typecheck/format checks. Emit non-skipped PostgreSQL results, role identities/grants/SQLSTATEs, empty-schema checks before/after, import fixture cases, route/principal manifests, reviewed snapshots and helper assertions.
4. Review the final diff and staged G1-versus-populated coverage. Only separately reviewed implementation with passing evidence can record G1 complete and permit private table creation. Do not mark the full T-ROLE/T-PUB populated matrices complete at this stage.

Next implementation dependencies remain separate: reviewed persistence/session binding/fencing; G2 principal resolution, epochs, authorization/RLS and invitations; G3 KMS/private audit/backup protection; later applicable gates and legal/privacy evidence. No test harness waives these requirements.

**Validation of this specification:** documentation formatting, links and content only. No PostgreSQL, helper, runtime or CI test result is claimed by this change.

References: [ADR test matrix](./private-workspace-security-architecture.md#11-test-matrix-and-acceptance-mapping), [G1 gate](./private-workspace-security-architecture.md#13-rollout-gates-and-migration-consequences), [R0 evidence limits](./private-workspace-r0-review.md), [identity interfaces/limitations](./identity-link-foundations.md), [next-phase plan](./private-workspace-poc-next-phase.md).
