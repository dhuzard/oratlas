# Native synthetic certifier replay probe

This standalone supplemental program exercises four existing POST methods: certification-run
creation, result submission, terminal transition and result lifecycle. It uses actual handlers,
certifier authentication, public packet construction, Prisma and restricted PostgreSQL. It adds no
production behavior, providers or private workspace tables. The shared catalog executes this
program with its own reset and independently reviewed golden.
It does not complete G1 or establish scientific confirmation or independent certification.

`CERTIFIER_REPLAY_PROGRAM` declares 300 requests: 18×200, 6×201, 24×400, 96×401, 66×403,
18×404, 48×409 and 24×415. All six public cookie recipes repeat four nonempty native replay
successes and the same worker credential, scope, ownership and input controls. These are existing-ID
replays. The lifecycle handler natively returns HTTP 201 even when `replayed: true`; the expectation
retains both facts and does not claim fresh event creation.

## Native provenance and loading

The inert `fixtures/certifier-replay-producer.ts.txt` is the actual executed setup source from
`c499d65`, retained for review rather than runtime discovery. Its full emitted rows and existing
replay targets are in `fixtures/certifier-replay-native.json`. Setup ran only against the separate
synthetic `oratlas_g1_certifier` database with bootstrap authority:

1. At 23:56, real `issueCertifierCredential` issued a submit-only credential for the other active
   certifier and wrote the native credential-issued audit event. No issued bearer value was saved.
2. At 23:57, the existing real primary submit credential authenticated and `createCertificationRun`
   captured the native public publication packet and created a running run.
3. At 23:58, the same credential authenticated and `transitionCertificationRun` failed that run
   with the explicit synthetic reason. The real failed-run audit includes the primary credential ID,
   certifier ID, reason and native idempotency key.
4. Native create-run, result and withdrawal replay functions accepted the existing protocol
   fixture's exact immutable inputs without modifying those rows.

All native IDs, row fields, generated audit identities and default timestamps are frozen as emitted.
The original running row is retained alongside the terminal row, and contract tests require that
only status, terminal reason and completion time changed through the native transition. The
producer's JavaScript Date is fixed; Prisma/database default timestamps still use their actual
setup clock and are retained truthfully. There is no production entropy or database-clock hook.
Exactly two exported fields on the newly issued credential are substituted: its prefix and digest
bind to the already reviewed `certifier/wrong-owner-submit` recipe. Its actual native ID, scopes,
owner, expiry, issuance audit and all other fields stay unchanged. The original digest/prefix remain
in the native snapshot. Neither original nor synthetic full bearer value is persisted.

Four native rows supplement the existing worker fixture's 37: one CertifierCredential, one
CertificationRun and two AuditEvent rows, for 41 total. The existing primary submit credential's
setup `lastUsedAt` becomes its real latest setup authentication at 23:58. This bootstrap-only update
is exported as `CERTIFIER_REPLAY_SETUP_UPDATES`. The child never performs that setup update.
`CERTIFIER_REPLAY_FIXTURE_DELTAS` accounts for every added row. A separate bootstrap check compared
all 87 schema tables against the six base fixtures and found exactly those declared deltas.

The descriptor uses the spec basename `certifier-replays.g1.spec.ts`, output variable
`G1_CERTIFIER_REPLAY_OUT`, state suffix `.state.json`, and `fixtures/`-prefixed files. The parent must
reset the six base fixtures independently, then load worker source, worker credentials and the new
certifier fixture in that order. These rows must not enter another program's reset. No new runtime
grant is needed: only the existing CertifierCredential.lastUsedAt UPDATE is used. The current full
app-role authority is measured exactly, including its 72 SELECT tables and narrow existing grants;
it is not described as globally read-only.

## Authority and state checks

Public cookies confer no certifier authority. A genuine read-only credential fails submit scope
before its stamp; the distinct other submit-capable credential reaches the native owner checks.
On collection POST, native ownership failure is the 409 protocol-owner conflict. On the other three
methods it is the corresponding native 403 run/result-owner denial. These are not mislabeled
read-scope failures. Expired, revoked, inactive, hash-invalid and unknown credentials remain
unstamped. The JSON media-type rejection occurs before authentication. Successful authentication
can stamp a credential before a later missing-target, schema or immutable-input failure. Repeated
requests at one fixed Date do not establish a count of individual equal-value writes.

Actual dispatched Authorization headers are bound to recipes by the existing header digest fields.
Real Cookie headers are generated natively, checked without raw-value diagnostics and represented
only by their existing digest. Every captured response retains its actual status, body and headers
under the existing Date/request-ID normalization only. Provider fetch is blocked; all captures
require zero outbound attempts. JavaScript Date alone is fixed, with timers and cryptography real.

Before each dispatch, after each request and at the final boundary, complete snapshots of every
field in all 72 tables must match cumulative expected state. Only the authenticated primary or
other submit credential's `lastUsedAt` may become the fixed instant. All runs, results, lifecycle
records, audits, verifier credentials and other public rows remain exact. The state sidecar retains
full initial/final rows, all 13 credential rows before/after each request, and per-request digests of
all other 70 tables. No field is silently excluded. These are sampled state guarantees, not a claim
to observe a transient concurrent write that is restored between samples.

Both capture and state are checked for known full worker capabilities and secret components before
either file is written. Actual Cookie values, signed payloads and signatures are also refused in
retained state and decoded response bodies; cookies and redirects in responses are refused generically. The actual probe's parent also refuses database credentials and unsafe
worker output before saving logs. No raw negative capability artifact or real provider credential is
used. Role posture requires no elevated flags, memberships, object/type ownership, schema CREATE or
private-schema USAGE/CREATE.

The controls include immutable create/result collisions, different terminal reasons/statuses,
different withdrawal reasons, a genuinely absent protocol/run/result, malformed contracts and
unsupported media. Native existing-result replay compares the complete candidate payload before
fresh-result packet validation; this probe does not claim to exercise fresh-result scientific,
evidence, protocol or execution-provenance validation. Packet and result schemas and digests are
independently crosschecked against the retained native rows.

## Observed scope and remaining gaps

Two independently reset restricted-role captures pass all 300 declared outcomes, exact HTTP pairs,
complete state pairs and capability guards. The evidence is retained under
`/tmp/oratlas-g1-certifier-pg/{first,repeat}.json` with `.state.json` sidecars and guarded logs;
`fixture-counts.json` records the all-87-table setup check. Offline scenario/native-fixture/state,
authority, capture and architecture tests pass, along with the full G1 script TypeScript config and
focused lint/format checks.

The integrated four-label candidate produced exact HTTP/state pairs under the empty-private-schema
lifecycle. Independent review passed 83 checks against candidate file SHA-256
`c42b34d7042ac22136f2c7369e2c17a6f564bbf930d4a644c2349f3a25b74073` and canonical
state SHA-256 `41841090e9ddf323723cdfdcb701f03b32aa1a917b1025ad26e3eaddf18d2f01`.
The new golden was manually accepted only after that review. All previously accepted HTTP and full
state captures remain unchanged; the raw index matches #236, including its already measured two
artifact UPDATE columns. No existing golden is rewritten. Final integrated validation follows. Fresh run creation, fresh result issuance,
first terminal mutation and first lifecycle event creation remain positive-path gaps because they
produce native IDs, audit records or timestamps during runtime. This batch introduces no entropy
waiver or extra write grants to hide those differences. Real certifier execution, providers, actual
Next serving, operational sinks and the remaining G1 obligations stay separate work.
