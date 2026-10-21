# Public snapshot adapter adoption

This stage applies the independently reviewed one-statement helper to eight exact whole-public
snapshot adapters. It is separate from the earlier native disclosure-guard retrofit. That retrofit
preserved its original query inventory (the prior 35-query source audit) and kept serial snapshots
serial. This stage deliberately changes only complete-state test reads from 72 SQL statements to
one statement; it changes no production handler query.

Seven existing whole-public SQL expressions are replaced: audit revocations, protocol/DOI reads,
certifier replays, worker artifacts, deterministic discussion/federation POSTs, the known-mutation
public snapshot and the standalone audit-default probe. The index reader additionally uses the
batch helper only for its public-runtime branch. Its partial INDEX_READ_TABLES branch and native
transaction/same-count mutation control remain intact.

Each existing before/after/per-request sampling boundary remains in place. Snapshot values pass
through their existing disclosure guard before diagnostics or state hashing. The DOI reader keeps
its immediate caller-side `safe()` checks with the actual request Cookie pool. The standalone audit
prototype now guards batch reads using the same native production signer and public-role URL; its
real Prisma extension/import binding, metadata inputs and model operations remain unchanged.

The synthesis reader's custom `[{row: ...}]` result shape, worker-read lastUsedAt exclusion,
known-mutation ORM snapshot, primary route state projections and fresh-removal ORM projections
remain unchanged. All retained raw SQL, ORM and transaction expressions match their preceding
source. The helper retains native public table order, every row and field, timestamp representation
and nullable value. No baseline, fixture, schema, grant, clock/ID policy, caller order, native API
response or timeout is changed.

A TypeScript AST audit against the locally applied frozen guard stage records the seven removed
whole-state SQL expressions and verifies all retained DB calls verbatim. Its compact result is
`scripts/private-workspace-g1/evidence/public-snapshot-adoption-audit.json`; the read-only audit
source is retained at `/tmp/oratlas-g1-snapshot-callers-review/audit.mts`. Focused helper, guard,
state, index, new program and architecture checks passed 152/152, with script TypeScript, focused
lint, formatting and diff checks. No redundant PostgreSQL matrix was run for this caller-only stage.
The prior independently reviewed helper proof remains pinned separately; historical audit prototype
proof hashes continue to identify the earlier executed source.

The parent must execute the final frozen integration under all four labels and compare the complete
native HTTP/state/index evidence against the unchanged manually reviewed goldens. Until that run
passes, this caller adoption has source/unit verification only. Read-cost samples from the helper
prototype are not a T-TIME privacy result or a G1 completion claim.
