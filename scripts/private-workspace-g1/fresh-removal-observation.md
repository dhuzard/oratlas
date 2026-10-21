# Fresh comment-removal observation: separate from strict G1 acceptance

This follow-up to `c670ac7` is a standalone observational probe. It changes no shared scenario list, golden, state exclusion, production source, native engine, crypto, clock or authorization rule. The earlier deterministic 62-request subset is unchanged.

## Real operations and checks

The 24-request program removes three existing visible comments through the actual DELETE handler, Prisma client/transaction and PostgreSQL constraints: A-only removes its top-level comment, EDITOR removes its reply, and ADMIN removes its historical-version comment. Each first removal returns exact `{ "status": "removed" }` bytes, sets the real actor and fixed JS removedAt, and appends exactly one comment.removed audit with exact actor, target, action, review slug, author/editor attribution, null idempotency key and platform version.

Every anonymous, cross-owner and cross-origin denial, every idempotent repeat, and every subsequent GET compares complete affected rows with its immediate before snapshot. These checks include all native timestamps, generated audit IDs, retained body bytes, users and notifications. Denied/repeated actions append no audit and change no row. Each first removal may change exactly four comment fields: status, removedById, removedAt and updatedAt. Its original body and all other fields remain exact.

One separate fixed visible control, authored by B-only on the readable current version, keeps the post-removal public read populated. Six principal reads return that exact remaining comment and exclude all retained removed/tombstone canaries and removed bodies. `fixtures/fresh-removal-fixtures.sql` belongs only to this standalone probe. It is **not** loaded into the shared 1165 initial dataset; doing so would change earlier comment-read expectations and requires separate review.

## Native-clock evidence, without equality substitution

Immediately before each handler invocation the probe records `performance.timeOrigin + performance.now()`. After the handler and full database snapshot it records the same real monotonic epoch estimate. Only JavaScript Date is fixed for the existing synthetic session policy. Native Prisma updatedAt and audit createdAt remain real.

The existing reviewed helper requires each new native timestamp to advance from its fixed fixture/pre-epoch reference and fit the measured interval with an explicit 1000 ms clock-skew allowance. That budget is capped, never enlarged automatically. Synthetic helper tests reject stale, unchanged, out-of-window future timestamps and invalid/unbounded windows. A host wall-clock jump can fail the probe. An incorrect time inside the permitted interval cannot be distinguished by this observation, and some positive offset beyond the measured end is permitted by the stated skew budget.

The probe preserves **raw** native updatedAt, audit ID and audit createdAt in its mode-0600 sidecar, together with complete before/after rows and measured windows. Nothing rewrites those values or substitutes a timestamp into an HTTP body/golden. The independently validated observed timestamp is used only to assert that the other row fields did not change. This adds a bounded clock-window invariant; it does not establish exact native-clock equality or production ID entropy properties.

## Observed repeats

On the reviewed local source base, Node 24.16.0 and the existing Prisma 6.19.3 native PostgreSQL client, two fresh-process runs against independently recreated synthetic fixture databases passed. Both used a dedicated NOINHERIT, nonsuperuser role with no memberships or owned relations. The role had the existing eight read tables, UPDATE only for ReviewComment.status/removedById/removedAt/updatedAt, and AuditEvent INSERT. It had no Notification UPDATE, schema creation or credential-table privilege. External HTTP/provider use was blocked and the existing closed child environment was asserted.

The complete raw HTTP capture files were byte-identical:

```text
24 records
SHA-256 f1ede538b2ebaae9c77bcbd60f94122fd8c242ed28203361298148096b47f6b5
```

The initial full database snapshots were identical. The raw internal sidecars **differed** exactly in ReviewComment.updatedAt, AuditEvent.id, AuditEvent.createdAt and the independent observation-window readings. Fixed removedAt values, HTTP bytes, retained bodies, actor/target/details and other row values matched. The differing native sidecars were retained, not transformed into passing golden state:

```text
first sidecar  f83657b1ab4840f4dd626f1cb63bb9ff2facaf66062b83395cae7c0a9bc0954a
repeat sidecar 256e886055846c9b4f34d57c1c63503148822358861796704f6478b2eb3afd09
```

Local synthetic evidence is under `/tmp/oratlas-g1-freshremoval-evidence`: first/capture JSON, first/native sidecars, probe logs, typecheck log and variance-summary.json. The restricted URL is retained privately in a mode-0600 file; it is never printed. Only the dedicated oratlas_g1_freshremoval database was recreated; earlier evidence and other targets remain intact.

## Review boundary

These are two standalone positive observations, not the four-run integrated before/after private-schema harness. No ReviewComment.updatedAt exclusion is activated. Any promotion to a named semantic checkpoint needs independent review of the narrow observational field, full-row denial/repeat checks, audit projection and preserved raw sidecars. Strict native-clock equality and full G1 remain unresolved. This probe must not silently replace the existing exact state comparison.
