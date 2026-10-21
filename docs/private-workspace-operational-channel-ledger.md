# G1 operational channel evidence ledger

This ledger supplements the HTTP method/rendered inventory. None of these rows closes G1 by
absence of an HTTP response. Empty-private-schema comparisons cannot establish isolation of
populated workspace data, source entitlements, encryption, erasure or deployment observability.

| Channel and actual entrypoint                                                                                                | Evidence and next acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public index: `apps/web/src/lib/index-builder.ts`, `buildKnowledgeIndex`                                                     | Additive index-consumer prototype: actual Prisma and PostgreSQL under the same reviewed public runtime authority (the complete reviewed SELECT closure and narrow existing writes), plus a separate optional 11-table read-only dependency probe, populated review/claim/citation/relation rows, hidden, tombstoned, withdrawn and invalid-source-SHA controls; four fresh child outputs before/after empty private schema. A separate golden, integrated into the same four-label lifecycle alongside the 1,177-record primary HTTP/state/metadata program. |
| Ingestion jobs: `packages/github/src/ingestion.ts`, `SynchronousIngestionRunner.enqueue`; `packages/github/src/job-queue.ts` | Existing deterministic queue tests establish local lifecycle/failure isolation, not operational G1. Add real queue + inspector/extractor with exact synthetic GithubTransport transcript, failing sibling and later success; fail unexpected endpoints/outbound exchanges.                                                                                                                                                                                                                                                                                   |
| Repository inspection CLI: `scripts/ingest.ts`                                                                               | Capture real subprocess stdout/stderr/exit with pinned synthetic repository responses. No live GitHub token/provider and no empty report as positive coverage.                                                                                                                                                                                                                                                                                                                                                                                               |
| Synthesis scan CLI: `apps/web/src/cli/refresh-syntheses.ts` → `scanAcceptedSyntheses`                                        | Needs nonzero eligible synthesis fixtures, corrupt eligible head, excluded unpublished control, pagination, exact evaluation/proposal/observation/audit state, idempotent repeat, stable failure codes, actual service authority and disconnect. Public HTTP role must not gain these writes.                                                                                                                                                                                                                                                                |
| SQLite backup/recovery: `scripts/backup.ts`, `scripts/restore.ts`, `scripts/backup-restore-drill.ts`                         | Existing PR CI recovery job prepares production SQLite, backs up, destroys/restores owned database and compares public API bytes. Preserve that existing evidence and its SQLite/recovery scope. Add operational stdout/secret controls and G1 before/after comparison; stdout credential fix [#232](https://github.com/dhuzard/oratlas/pull/232) merged at `07ef428` after all five checks passed; this is not PostgreSQL recovery or private backup protection.                                                                                            |
| PostgreSQL backup/recovery                                                                                                   | Backup/restore TypeScript CLI branches print operator guidance; they do not execute a dump. Real `pg_dump`/restore into a new disposable database, role/schema/data inventory and recovered populated public exports remain a separate gap. G3 private backup/KMS policy remains later.                                                                                                                                                                                                                                                                      |
| Structured/error logs: `apps/web/src/lib/log.ts`, `api.ts`, `audit.ts`                                                       | Exercise real production log emission (test NODE_ENV suppresses structured output), marker-bearing error/success/failure sinks and exact stdout/stderr. Harness redaction cannot be evidence that production sinks never emit secrets.                                                                                                                                                                                                                                                                                                                       |
| Audit sink: `apps/web/src/lib/audit.ts`, transaction-owned audit writers                                                     | HTTP batch has attributable database audit checkpoints; operational paths and failed sink logging still need independent tests. No durable external log collector claim.                                                                                                                                                                                                                                                                                                                                                                                     |
| Notifications: `comments.ts`, `submission-creation.ts`, `claim-monitoring.ts`, `editorial-lifecycle.ts`                      | Test real mutations, exact recipient rows and cross-recipient/private-marker exclusion. Existing HTTP notification reads/mark-read cover a bounded slice. No email delivery transport is identified in current source/dependencies; record deployment inventory and require evidence if one is introduced.                                                                                                                                                                                                                                                   |
| Metrics, external collectors, mail and deployment channels                                                                   | No generic successful no-op test. Inventory deployed components/configuration and enumerate implemented sinks; absence in this repository does not establish absence in deployment.                                                                                                                                                                                                                                                                                                                                                                          |
| Outbound lookups/providers                                                                                                   | Per-entrypoint synthetic transports record full allowed request transcript, consume populated responses and fail unexpected network; Node fetch guards alone are not an OS/Edge/native/subprocess network policy.                                                                                                                                                                                                                                                                                                                                            |
| Timing                                                                                                                       | Separate experimental design, real monotonic measurement, controls and bounded statistical claims; frozen timestamps and exact output equality do not prove timing noninterference.                                                                                                                                                                                                                                                                                                                                                                          |

## Index consumer protocol

`scripts/private-workspace-g1/index-channel.ts` defines the declarative read closure, positive and
negative output expectations, digest and pair comparator. `index-consumer.g1.spec.ts` imports the
real application consumer only from a test file (the established architecture boundary), checks
effective table/column grants, role attributes/memberships/ownership and private-schema denial, snapshots
every readable source table in the declared authority before/after, and writes full index JSON with mode 0600. No Prisma
query/result is mocked. Date alone is frozen and bound to the G1 clock; timers and performance remain real. Outbound fetch is blocked. The channel serializes the actual function result as canonical JSON (object keys ordered, array order preserved); it is not HTTP or raw wire-byte evidence. The comparator compares all index fields
and full public-row state digests exactly, without sorting consumer arrays or stripping fields.

The integrated runner resets all six shared fixture files (`public`, `editorial`, `scholarly`, `discovery`, `protocol`, `editorial-read`) then loads supplemental `fixtures/index-fixtures.sql` for the index child only. The supplement adds controls without altering existing rows and must never be
loaded into the established HTTP golden program. Its intentionally malformed commit SHA is a
negative input, not a valid producer assertion. Withdrawn metadata remains visible with its status;
withdrawn claims, tombstoned versions and invalid-SHA snapshots never enter the index.

Run the dedicated spec in a **fresh child** with `publicChildEnv` plus `NODE_ENV=test`,
`G1_INDEX_CAPTURE_OUT` (absolute path) and `G1_INDEX_LABEL` (`baseline`, `baseline-repeat`,
`after`, `after-repeat`). The child must receive only its restricted public-runtime database URL,
never bootstrap/private credentials. The default `public-runtime` role contract asserts the exact existing HTTP role grants and hashes full rows from the complete shared `PUBLIC_SELECT_TABLES` closure (50 tables in the initial isolated probe), including same-count updates. Set `G1_INDEX_ROLE_CONTRACT=read-only-probe` only for a separate minimal dependency measurement (11 SELECT tables). Every capture binds the authority and state-table scope; comparisons reject mixing them. No new production identity or permission change is implied. Compare four accepted captures with `indexCaptureDifferences`; Private-schema existence and run labels intentionally differ in the evidence envelope; full evidence files are not claimed byte-identical. Before runs
require private schema absent, after runs require it present but inaccessible. Integration must
prove the provisioned private schema empty and public role/grants/rows unchanged, reset fixtures
before each run, bound/kill each child, and call `indexRunnerOutputProblems` on both stdout/stderr with all URL/encoded/decoded credential values, rejecting secrets or excluded markers before preserving
sanitized runner logs. The capture itself rejects its database URL and encoded/decoded password.
Neither protected credentials nor raw Prisma error output should be published.

The shared orchestrator now resets and captures both the 1,165-record program and the separate index channel before/after private-schema provisioning. It grants only the measured 64-table public read closure and pre-existing narrow writes. The baseline-backed local run in `/tmp/oratlas-g1-operational-final` passed all 42 steps, with auth 6/6, role 7/7 and cleanup 4/4; 23 evidence/log files had no credential matches. Independently reviewed candidates precede manual baseline acceptance; final-head CI is still required. Real-serving prototype [#231](https://github.com/dhuzard/oratlas/pull/231) merged at `f41fa66` and remains separate from this lifecycle. All other ledger rows remain independently tracked obligations; G1 is not passed.

## Initial isolated execution

On the #230 baseline (`78c3df0`) plus this additive slice, four separately started Node
24.21.0/Vitest children used a distinct synthetic PostgreSQL 16 target on loopback. Each run
reset all public fixtures, loaded the four existing fixture files and the index supplement;
private schema was absent for the first pair and empty/inaccessible for the second pair.
All four populated consumer assertions and three paired canonical comparisons passed, with
3 review metadata records, 2 public claims and 1 citation. The default application grant
closure was 50 SELECT tables, AuditEvent INSERT and 12 UPDATE columns; all 50 tables' full-row
digests were unchanged. Each run also rejected a real same-count User update in a separate
rolled-back transaction and proved the original digest restored. This is an explicit negative
control, not a write performed by the consumer. The optional 11-SELECT dependency probes
were captured separately and are not mixed with app-authority comparisons.

This historical isolated execution preceded the root integration described above and is not complete G1 acceptance.
The local target and protected credentials are disposable test infrastructure, not repository
artifacts or production configuration.

Native source-artifact validation subsequently corrected two discovery fixture
`PublicationCapture.contentBytes` values from base64 text to native UTF-8 storage.
The corrected lifecycle in `/tmp/oratlas-g1-native-storage-final` again passed
42/42 steps and cleanup 4/4. All 1,165 HTTP records and canonical index output
remain unchanged; independently reviewed full-row state digests changed only for
those two stored values. The corrected candidate and state hashes are recorded
in the harness guide. This remains partial G1 evidence.

The next isolated catalog declares worker reads (270), known notification/comment
operations (62) and accepted synthesis/federation/discovery reads (108), in addition
to the 1,177-record primary program. Each has its own fixture reset, four fresh
children, complete state contract and manually reviewed golden. The measured
public closure is 72 SELECT tables and 14 column UPDATEs plus existing audit
INSERT; all 87 schema tables are counted for exact fixture deltas. Raw state
sidecars and child logs refuse worker capabilities before persistence. Fresh
comment removals have a separate 24-request observation whose native time/ID
variance remains preserved; it supplies no strict G1 entropy waiver.

The final reviewed local four-program lifecycle in
`/tmp/oratlas-g1-authority-final` passed 105/105 checks, auth 6/6, role 7/7 and
cleanup 4/4; all 62 harness evidence/log files passed database/worker capability
scanning, including decoded HTTP bodies. The required offline regression suite
passed 339 tests across 34 files. Final-head CI is still required. These exact
read/known-write/index results leave every other operational row above open.
