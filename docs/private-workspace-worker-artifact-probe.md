# Synthetic native worker artifact mutation probe

This standalone supplemental program extends the bounded G1 evidence for four existing worker
methods: artifact preparation POST, artifact content PUT, artifact completion POST and finding POST.
It is not integrated G1 acceptance, a live worker execution, scientific confirmation, or a private
workspace runtime. The artifacts' native `visibility: private` denotes existing verifier artifact
access policy, not a new private workspace grant.

`WORKER_ARTIFACT_PROGRAM` declares 379 ordered requests: 31×200, 30×400, 96×401, 156×403,
30×404, 30×409 and 6×413. Every one of the six public cookie recipes repeats four meaningful
native replays and the scope, credential, lease, missing-target and route-specific controls. Worker
bearer authority is independent of the user's cookie role. Case-major ordering gives each cookie
recipe the same precondition. After those controls, one anonymous-cookie request actually completes
an existing uploaded artifact; six cookie recipes then replay that completed result. The first
completion explicitly lacks `replayed`; the following responses explicitly contain `replayed: true`.

The child uses actual app handlers, native authentication, SHA-256, frozen publication packet,
Prisma and restricted PostgreSQL. No auth, database, upload, provider or scientific computation is
mocked. Outbound fetch is blocked and its attempt count must remain zero. The fixed JavaScript Date
controls credential stamps and the single completion time; real timers remain real. Responses are
captured exactly under the existing Date/request-ID normalization only. Neither identifiers nor
response fields are rewritten.

## Native fixture provenance

The fixture was emitted by real `createVerificationRun`, `authenticateVerifier`,
`claimVerificationRun`, `transitionVerificationRun`, `prepareVerificationArtifact`,
`uploadVerificationArtifact`, `completeVerificationArtifact` and `submitVerificationFinding`
functions from source base `809c1fb29f5b4cda57f1807a26339851018abd8e`. The producer source is retained
as inert `fixtures/worker-artifact-producer.ts.txt`; its native emitted rows are retained in
`fixtures/worker-artifact-native.json`. The producer ran only against the disposable synthetic
`oratlas_g1_artifacts` database with bootstrap authority, before the restricted-role captures.
The inert producer is historical evidence, not discovered or executed by the runtime program.

The native history is:

- At 23:51 the administrator requests the run over the existing valid worker publication packet.
- At 23:52 a distinct submit-capable verifier claims a 300-second generation-1 lease, then prepares
  an artifact at 23:53. The original read-only wrong-owner credential is not reused for this control.
- At 23:56 the primary submit credential prepares a different artifact on the independently existing
  run whose real lease expires at the capture clock.
- At 23:58 the primary verifier reclaims the new run after generation 1 has expired, receives a
  300-second generation-2 lease, and starts it.
- At 23:58:10/20 it prepares/uploads artifact A. At 23:58:30/40/50 it prepares/uploads/completes B.
- At 23:59 it submits the existing `not-applicable`, informational finding citing completed B and
  the actual in-packet source capture. At 23:59:10 it prepares C and stamps its credential.

All native generated IDs and Prisma/database default timestamps are frozen as emitted. These
native default timestamps reflect the setup database/engine clock, which JavaScript Date does not
control; they are not asserted to have been issued by the fixed capture clock. The full lifecycle
rows retain the actual native event timestamp representation. No entropy replay or production clock
hook is introduced. Exactly one exported field is substituted: the final run's native random lease
hash becomes the hash of the already reviewed deterministic synthetic lease recipe. The original
native digest remains in the native snapshot; neither random lease value is saved. The earlier
native generation-1 run snapshot and artifact are inserted before restoring the exact final
reclaimed/running snapshot, so the actual PostgreSQL claimant binding guard remains enabled.

Fifteen rows supplement the existing worker fixture's 37: one VerifierCredential, one VerificationRun,
four VerificationRunLifecycleEvent, five VerificationArtifact, two VerificationArtifactBlob,
one VerificationFinding and one VerificationFindingArtifact. One existing submit credential's
`lastUsedAt` is updated during fixture setup to its actual latest native preparation use.
`WORKER_ARTIFACT_FIXTURE_DELTAS` accounts for all 52 added rows, including the nongranted
VerificationFindingArtifact join row. The parent must load the six base fixtures, worker source,
worker authority and artifact fixture under bootstrap authority after an independent reset; these
supplements must not be loaded into another HTTP program's reset.

## Authority, effects and exclusions

The only additional runtime grant is column UPDATE on `VerificationArtifact.status` and
`VerificationArtifact.completedAt`. No additional SELECT or INSERT is needed over the reviewed
72-table app-role closure, AuditEvent INSERT and existing narrow column grants. The runtime role
has no ownership, privileged flags, memberships, schema CREATE or private schema USAGE/CREATE.
The nongranted finding/artifact join is fixture-accounted by bootstrap and protected by the exact
role closure, not read through a new runtime grant.

Authentication stamps the primary submit credential or the separate wrong-verifier submit
credential before downstream lease, owner, payload or reference failure. Read-scope-only failures,
expired/revoked/inactive/hash-invalid/unknown credentials and the early PUT size-header rejection
must not stamp a credential. A valid other submit credential tests the native lease-owner denial;
a valid primary credential against the artifact prepared by the former claimant separately tests
`Artifact belongs to another verifier.` Scope denial is never labeled as ownership evidence.

Before and after every request, the child snapshots every field and row of all 72 granted tables.
Only the declared credential `lastUsedAt` at the fixed instant and one uploaded→completed artifact's
`status`/`completedAt` may change. Same-count updates to other fields are rejected. The state sidecar
retains complete start/end snapshots plus all credential and artifact rows around every request;
other tables additionally have per-request digests. The label is excluded from state, not any row
value, so repeat and future before/after sidecars can compare exactly.

Parent integration also requires each pre-dispatch snapshot to equal the cumulative expected
state derived from the initial rows, and requires complete expected state after each request and
at the end. This detects persistent changes between sampled request boundaries as well as
undeclared handler effects. It does not claim to detect transient concurrent write-and-restore
activity between snapshots. The ownership posture includes types as well as database, schema,
relation and function ownership.

Raw worker tokens, their secret components, leases, real session cookies and database credentials
must never persist in capture bodies, request headers, state files or child logs. The dispatched
Authorization/lease headers are bound to declarative recipes by hashes of the actual native
Request headers. Both capture and state undergo the existing capability guard before either file
is written; the parent must apply its existing child-output guard before saving logs. Synthetic
issuer prefixes and digests alone confer no bearer authority.

The controls cover immutable metadata collision, uploaded-byte/media mismatch, early excessive
Content-Length, former artifact ownership, foreign/incomplete artifact references, missing targets,
frozen-packet evidence membership, immutable finding payload collision and malformed finding input.
The referenced outside-packet capture genuinely exists. Native replay paths do not recompute the
stored run packet digest on every mutation; fixture tests and child setup independently bind that
packet, while no unsupported storage-corruption detection claim is made.

Fresh artifact/finding creation and first upload remain uncovered positive paths: they generate
native CUIDs, Prisma/database times or blob rows. This batch requests no runtime INSERT authority,
clock waiver or new entropy seam to conceal those differences. Worker claim/heartbeat/transition,
other mutations, full Next serving and remaining operational channels remain separate obligations.

## Observed bounded validation

Two independently reset restricted-role runs passed all 379 requests. `validateCapture`, exact
paired capture comparison and complete state pairing return no problems. The isolated evidence is
under `/tmp/oratlas-g1-artifacts-pg/{first,repeat}.json` with `.state.json` sidecars and guarded logs.
These are two baseline probes; four-label before/after-private-schema captures and a manually
reviewed golden are still required in the parent lifecycle. No existing golden is changed here.

Offline validation uses the artifact scenario/native-fixture/state regression tests, existing worker
authority/capture/read tests, architecture tests and the complete G1 script TypeScript config.
Reproduction of the restricted child uses the existing closed public child environment plus
`G1_WORKER_ARTIFACT_OUT`, a known `G1_CAPTURE_LABEL`, and the dedicated spec under
`scripts/private-workspace-g1/vitest.config.ts`. Bootstrap credentials never belong in that child.
