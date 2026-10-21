# One-statement public snapshot prototype

This unwired test adapter replaces 72 serial SELECT round trips with one PostgreSQL statement
while retaining the exact same 72-table public scope and every native row/field. It changes no
handler, production query, schema, grant, shared caller, catalog, accepted capture or golden.

`public-snapshot.ts` builds a fixed VALUES relation whose scalar subqueries are the unchanged
`publicTableSnapshotSql(table)` expressions. Those expressions use explicit `public."Table"`,
`to_jsonb(t)` and row ordering by `to_jsonb(t)::text COLLATE "C"`. `json_object_agg` packages their
native JSON arrays without the 100-function-argument ceiling of a 72-entry `json_build_object`.
The table list is compiled from PUBLIC_SELECT_TABLES, copied and frozen, with no caller or
configuration selector. Existing identifier/scope checks still validate every subquery.

PostgreSQL object-key ordering is not the JavaScript serialization contract. The decoder verifies
exactly one result containing precisely the approved tables and arrays of native record objects,
then constructs a plain object in PUBLIC_SELECT_TABLES insertion order. It retains the original row
arrays, record field order, values and nested JSON. It does not sort rows again, clone/rewrite
fields, canonicalize timestamps, normalize IDs or drop nulls. Malformed or extra scope fails with a
fixed error. `readPublicSnapshot(realPrisma)` delegates exactly one native query and does not retry
or replace a database failure.

Executed source `6920034d57cd8140d8bc4bbdbd2236bb1338813d` passed four serial/batch comparisons
in two actual native Prisma children under the same restricted role. Each compared complete
`JSON.stringify` bytes, including table, row and field order. All four also matched the complete
native after-state from the independently reviewed audit-revocation workflow. A same-count field
tamper in a separate in-memory negative control remained detectable; no database row was modified.
The unchanged authority was measured as 72 SELECT tables and 16 column UPDATE grants, with no
ownership, memberships, privilege elevation or public schema CREATE. The parent read all 87
inventory tables before/after each child and found every row/field unchanged. No fixture reset,
private schema/table or extra runtime permission was introduced.

Both native `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` results contain exactly the 72 approved
relations. These small fixture tables intentionally require full-row reads; no index or server
configuration tuning was applied. Four monotonic adapter samples measured serial reads at
33.5–109.3 ms and batch reads at 9.4–16.5 ms. These bounded samples include query dispatch, native
result transfer/parsing and adapter reconstruction, while excluding later disclosure validation.
They measure this adapter's cost only. They establish no T-TIME tolerance, general workload speed,
cache-state equality or timing privacy. Existing native and CI deadlines were not widened; the
optional standalone probe uses the existing 60-second test budget.

One SQL statement provides a single statement snapshot rather than 72 separate read boundaries.
Separate before/after samples still cannot rule out transient concurrent writes between samples.
This prototype uses an owned synthetic database without concurrent writers; it is not a general
transaction fence or a replacement for method-specific expected-state checks.

Exact source/raw evidence hashes, ordered snapshot hashes, EXPLAIN summaries and monotonic samples
are recorded in `scripts/private-workspace-g1/evidence/public-snapshot-result.json`. Raw native
rows/plans, parent all-table proofs and guarded logs remain under
`/tmp/oratlas-g1-public-snapshot-pg`; protected connection files stay in the prior owned setup.
Focused helper/architecture tests passed 121/121, alongside script TypeScript and focused lint.
Independent review and an eventual full four-label run against unchanged reviewed captures remain
required before adoption. No shared caller or baseline is wired by this prototype.
