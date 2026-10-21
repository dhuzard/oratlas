# G1 editorial registry and mutation scenarios

This supplemental program extends G1-empty synthetic public-handler captures. It does not
establish private workspace authorization, scientific validity, or completion of G1. The
standalone definition tests do not execute handlers or PostgreSQL; the integrated harness must
run the complete before/repeat/after/repeat program through the restricted public connection.

## Integration

1. Append `fixtures/editorial-fixtures.sql` after `fixtures/public-fixtures.sql` in every reset
   transaction. It creates five synthetic public rows: two verifiers, two verification protocols,
   and one certification protocol. The base ORA protocol INSERT now uses an explicit valid synthetic contract and its exact
   SHA-256, replacing the old invalid `{}` fixture at construction rather than updating an immutable row.
   This is fixture repair only, with no application or migration changes.
2. Add literal imports in `public-routes.g1.spec.ts` for every route declared by
   `EDITORIAL_ROUTE_MODULES` in `editorial-routes.ts`. That inventory contains strings only;
   no ordinary script imports application modules or bypasses the architecture guard.
3. Append `editorialScenarios(previousState)` after the shared `state-final` checkpoint and
   any intervening read-only scenarios. Pass that checkpoint's complete expected state. The
   factory preserves the core user/notification/certifier projection and adds three exact audit
   events. If earlier scenarios later add mutations, pass the actual expected preceding state.
4. Add the following minimal grants and reset counts to the reviewed shared SQL inventory.

| Table                   | Additional privileges                                | Fixture reset count |
| ----------------------- | ---------------------------------------------------- | ------------------- |
| `Verifier`              | SELECT; UPDATE(`status`, `activatedAt`, `retiredAt`) | 2                   |
| `VerificationProtocol`  | SELECT; UPDATE(`status`)                             | 2                   |
| `CertificationProtocol` | Existing SELECT; UPDATE(`status`)                    | 2 (formerly 1)      |

Existing `Certifier` SELECT, `User` session SELECT and `AuditEvent` SELECT/INSERT cover the
remaining accesses. No table INSERT, DELETE, DDL, credentials or provider access is added.
`activatedAt`/`retiredAt` are explicitly written by `setVerifierStatus`, even on suspension.
All supplemental rows reset in the same disposable transaction as the existing fixtures.

## Exercised program

There are **150 HTTP scenarios plus 12 exact state checkpoints**, covering eleven route files.
Each file has all six principal labels and at least one meaningful nonempty success. A/B remain
synthetic principal labels without workspace membership.

- Public certifier/verifier and certification/verification protocol list/detail GETs: exact
  two-row lists/order, existing detail rows and hashes/native definitions, generic missing-id
  404 controls, equality across all six principals, no creator/credential/hash metadata.
- Three ADMIN mutations: verifier active to suspended; verification protocol active to retired;
  certification protocol active to retired. Every denied role uses a real target and valid body,
  not a missing object or invalid payload. Anonymous gets the exact 401; USER/EDITOR gets 403.
- After denied calls, exact row rereads equal the original state and the audit checkpoint is
  unchanged. After an authorized write, exact public row reads and two-row collection status
  checks prove only the target changed while the control remains active. Each write has exactly
  one attributable native audit event with the original protocol hash where applicable.
- An idempotent repeat returns the same body/headers and adds no audit event. ADMIN missing-id
  controls return the exact generic 404 and add no audit event. Core users, notifications and
  certifier state remain unchanged throughout this extension.

## Remaining gaps

This group covers public registry GET and three deterministic administrative update paths only.
It does **not** exercise successful registry/protocol creation, credential issuance or revocation,
certification/verification run submission, bearer-authenticated run/input/transition/artifact/
result paths, review round/report/assignment workflows, TRUST adjudication, graph curation,
execution-passport verification, federation processing, or external providers. Those methods
remain explicit method/provider gaps even when their related GET route file is now captured.
No missing-only response is presented as evidence of successful access. Providers remain disabled;
all fixture names, protocol definitions and public research records are synthetic.

## Local validation before integration

- Editorial program and architecture suites: 122 tests passed (4 program-definition tests and
  118 architecture checks).
- Focused strict TypeScript check over the three new TypeScript files and their transitive pure
  dependencies passed, using the repository base compiler options plus DOM libraries.
- ESLint, Prettier and diff checks pass for the new source files.
- The real PostgreSQL fixture, public grants and golden captures are an integration requirement;
  they were not run by the editorial subtask. No hosted or populated G1 result is claimed.
