# Native already-revoked credential audit workflow

This standalone synthetic program exercises POST `api/editorial/verifier-credentials/[id]/revoke`
and `api/editorial/certifier-credentials/[id]/revoke`. Both existing target credentials are already
revoked. The unchanged native functions skip credential UPDATE, append a new AuditEvent and return
`{"revoked":true}`. This is repeated-revocation behavior with a new audit record, not an unchanged
replay or coverage of first revocation.

The program reuses exactly the previously reviewed 37 worker fixture rows after the six base
fixtures. No new fixture data, production code, schema, grants, global singleton assignment,
provider, ID factory or engine hook is added. The initial standalone experiment left the catalog and goldens untouched. The shared catalog now
includes this descriptor, and independent review accepted its four-label native candidate from
`bef4f82`. Manual baseline acceptance changed only review annotations.

The independently reviewed AuditDefaultFixture supplies only missing id/createdAt inputs to the
real native Prisma query extension. The existing platformVersion extension remains active. An
explicit test-only app-db import binding supplies that actual extended client to the native route
graph. The binding is awaited before importing the handlers: a concurrent import experiment reached
the base client, and the independent complete-row assertion rejected the resulting native CUID/time
variance. No failed run produced a capture candidate. The fixed metadata is request input; captured
HTTP responses and database rows are never rewritten.

There are 92 requests: two ADMIN 200 responses, 12 native 401, 52 native 403, two missing-target 404
and 24 media-type 415. Each method exercises all six principal cases over the existing target,
missing target, absent Origin, foreign Origin, cross-site Fetch Metadata, wrong media type and
absent media type. Four additional malformed/expired/tampered/missing-user session controls resolve
to anonymous per method. Authentication, cookies, authorization, integrity checks and API errors
are the real production functions, run inside the existing verified native Next request context.
Only the two successful requests consume default slots; the third rollback slot remains unused.

Every request reads all 72 granted tables immediately before and after. All preexisting audit rows
and every other row/field must remain unchanged. The two successful requests append independently
specified complete audit rows (actor, action, subject type/id, native details JSON, nullable
idempotency key, native platformVersion and fixed metadata). Denials append nothing. Sidecars retain
complete initial/final rows in native SQL `COLLATE "C"` order and cumulative per-request state
hashes; no field is excluded. The SQL timestamp expectation is the native
`to_jsonb(timestamp without time zone)` representation, not Prisma's Date JSON representation.
The query trace checks exactly two single-delegation creates. The helper’s independently reviewed
explicit-input preservation remains unchanged; these two native requests omit metadata. Runtime authority remains the measured 72 SELECT tables and 16 column UPDATE grants.
AuditEvent INSERT/SELECT permissions exclude UPDATE/DELETE; the schema's absence of an audit
immutability trigger remains the explicitly recorded administrator authority limit from the
standalone prototype.

Before any value-bearing assertion or either output file is created, guards inspect each native
response, full snapshot/capture/state data, Unicode-escaped JSON keys, JSON literals and nested
strings, and decoded response bodies for actual native Cookie header/value/signed payload/HMAC,
database URL/password components and known/generic worker capabilities. Public user IDs and issue
times separately remain public fields; their combined signed payload is guarded. The exact output
files use exclusive creation and mode 0600. Parent bootstrap credentials stay parent-only; parent
streams are checked before persistence. Native fetch is blocked and counted, with zero calls required.

Executed final source `75b101eb7e0d1ffca831197d719d3eb2f04d66de` produced two independently
reset 92-request captures with all expected outcomes and exact paired HTTP/full-state comparisons.
The shared inspector is copied unchanged from `13f4aa3b4f23204d41726b9a660df97144acb5e9`.
Its bounds are 16 MiB per string, 64 MiB cumulative inspected strings, depth 64 and 250,000 visited
entries. It inspects native bodyBase64 bytes and JSON/Unicode string variants without rewriting them.
Raw HTTP SHA-256 values are `f0e9bb95efd8179456d8ba6909d148059c58c9411aa35cacb4eeb77f9e26480a`
and `33851027000ca4e1c70dd28715e05124a076b271dab8d9c46c88c8b418e709a5` (only label differs).
Both raw complete-state files have SHA-256
`79a2a3a8cfa0f618011ea28cda8ad894cd6c1f4395fbe43eb25a80510ab82d71`; canonical complete-state
SHA-256 is `e3237246b1a1df0eb2307cc9b1e0bd501092296fc3a48f29ba4bb650b8aa14d7`.
Only the two independently expected ADMIN audit transitions changed state. Capability inspection
reported zero problems; 131 focused/architecture tests, script TypeScript and focused lint passed.
Compact source/file hashes are in `scripts/private-workspace-g1/evidence/audit-revocations-result.json`;
raw files, all-table parent evidence and retained refused-run observations remain in
`/tmp/oratlas-g1-audit-defaults-pg`. Protected connection files stay local.
Parent checks cover all 87 inventory tables: setup must add
exactly the declared worker37 rows without changing any existing row, and each program must add
only the two expected AuditEvents. Independent four-label lifecycle/golden review is complete for `bef4f82`; a final native run
with the subsequently reviewed disclosure guards and test snapshot adapter remains pending. First active-credential revocation, fresh credential issuance, other
metadata-producing models, real providers and populated private-workspace authorization are not
covered. This program does not pass G1 or its later matrices.
