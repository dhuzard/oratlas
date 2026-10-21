# Native protocol snapshot and local DOI POST probe

This standalone synthetic supplemental program covers two real POST methods:
`api/protocols/snapshots` and `api/validate-doi`. It exercises real handlers, cookie authentication,
registry adapters/comparator, DOI normalization/reporting, Prisma and restricted PostgreSQL. It
adds no production source, grants, shared catalog entry, provider call, accepted baseline or G1 waiver.

There are 110 requests across the six existing public cookie principals, plus the four reviewed
invalid-cookie recipes. An authenticated editor/administrator receives a genuine existing snapshot
replay; ordinary users receive the native editor-role denial and anonymous callers must sign in.
Every principal receives populated native DOI reports for example version/concept inputs and
invalid syntax. These are reports with `confidence: none`, not successful DOI resolution or
scientific confirmation. Native expected-kind input remains `doiKind: unknown` on the local
example path; no version/concept identity is invented.

## Exact native bootstrap provenance

The native bootstrap source is merged main
`449c47ebe5d543180f336e2fc32924e02f59a7ba`. Final standalone captures use merged main
`505b0f45a71b4f6540cece4bce94da992347fbcc`; the relevant native handlers, domain modules,
contracts, schema and grants are unchanged. The actual executed setup source is retained inert as
`fixtures/protocol-post-producer.ts.txt`; emitted rows, native inputs, intermediate open proposals
and native local DOI reports are retained in `fixtures/protocol-post-native.json`.

The producer called the real `registerProtocolSnapshot` with a wholly synthetic ClinicalTrials.gov
v2-shaped payload over the existing public `g1-version-2` review version. Its explicit source URL,
NCT-shaped identity, source version and fetched time satisfy the current registry contracts. The
fixture does not assert that this study exists in an external registry: no network retrieval or
external registration was performed. It does not reuse the older scholarly fixture's raw payload
or assume that a stored hash makes an input native-valid.

The actual adapter normalized that exact payload, the actual comparator derived two neutral
metadata reconciliation proposals, and the native registration function wrote the snapshot,
proposals and registration audit. A subsequent actual resolution explained one proposal with an
explicit synthetic note and wrote its resolution audit; the other proposal remains open. The
producer then called registration again and received `idempotent: true`, zero newly opened
proposals and the same snapshot identity/public path. No identifier, content hash, normalized field
or native default timestamp is substituted in the frozen SQL.

The five added rows are one ProtocolSnapshot, two ProtocolDriftProposal and two AuditEvent rows.
`PROTOCOL_DOI_PROGRAM.addedRows` declares every row; there is no update to a base fixture row.
Tests reconstruct the snapshot/content identities, normalization and all comparator proposal fields
from the current contracts, exact input and captured declared review scope. Full native audit and
proposal lifecycle fields are crosschecked. These neutral metadata proposals do not establish
scientific findings, misconduct, intent or endorsement.

The native setup's JavaScript Date is fixed for explicit lifecycle fields. Prisma/database default
timestamps retain the actual setup clock as emitted; they are not claimed to follow the fixed
JavaScript clock. No entropy hook or runtime native-ID/default-time replay is introduced.

## Runtime program and checks

The dedicated spec uses the existing closed public child environment, actual native session signer
and Next request context. Date alone is fixed at `2026-04-01T00:00:00.000Z`; timers and cryptography
remain native. Provider fetch is blocked and every run requires zero attempted outbound calls.
The captured statuses, response bodies and headers are not rewritten beyond the existing
Date/request-ID policy.

Protocol controls cover exact source-version/content collision, URL/payload identity mismatch,
missing version/claim, malformed input/registry shape, same-origin/fetch-site integrity and the
native JSON media-type denial. Invalid cookies remain anonymous and receive 401. Body-schema
validation occurs after sign-in but before the domain editor check, so its actual ordering is
preserved. The wrapper's media-type error is natively HTTP 400 and is not normalized to 415.

The DOI reports use the application's reserved `10.5555/` example path and invalid syntax path,
which return before constructing an outbound resolver. Missing/wrong-type/wrong-kind bodies
receive the native generic 400 response. The four invalid-cookie requests receive the same public
example report as anonymous callers; they are not authenticated successes. Each ordinary principal
makes seven DOI requests and the anonymous fallback receives eleven, below the real hardcoded
30-per-minute limit. No limit is mocked, disabled or widened. Provider-backed DOI resolution,
Zenodo metadata checks and rate-exhaustion behavior remain unexercised.

Every field of all 72 permitted public tables is read before each dispatch, after each request and
at the final boundary. Every snapshot must equal the complete initial snapshot. The sidecar
retains full initial/final rows and per-request full-state digests anchored to that initial value;
there are no excluded identifiers, timestamps, tables or mutable fields. This is a sampled state
guarantee, not detection of an arbitrary transient write that is restored between samples.
The role's full existing table/column grants and posture are checked exactly, including no elevated
flags, memberships, object/type ownership, schema CREATE or private-schema USAGE/CREATE. Its
application authority includes existing narrow writes; this program adds none and proves none
were used to change public data.

Actual Cookie headers are compared to native recipes and captured only by digest. Signed Cookie
values/payloads/signatures, full Cookie headers and known worker capabilities/components are
refused in retained state or decoded response bodies before either output file is written.
Response cookies and redirects are refused generically. The deliberately malformed nonsigned
cookie value remains the existing public invalid-input recipe; its full Cookie header is still
refused. The parent probe checks database credentials and worker output before preserving logs.

## Deliberately excluded resolver mutation

`resolveProtocolProposal` is not a successful idempotent replay API: even the exact same resolution
of an existing closed proposal returns native 409, `Proposal is no longer open.` The producer
records that behavior under bootstrap authority. Its implementation issues UPDATE before checking
that the row is closed, and the reviewed runtime role has no ProtocolDriftProposal UPDATE grant.
This batch therefore dispatches no resolver requests, grants no extra columns and does not bless a
permission-related 500 or inflate coverage with denial-only resolver scenarios. Its genuine fresh
resolution positive remains a separate obligation with an audit CUID/default-time effect.

## Integration boundary

`PROTOCOL_DOI_PROGRAM` uses basename `protocol-doi.g1.spec.ts`, output variable
`G1_PROTOCOL_DOI_OUT`, `fixtures/protocol-post-fixtures.sql`, and `.state.json`. The parent must
reset the six existing base fixtures before loading this supplemental file, independently of every
other HTTP program. The initial standalone probe changed no parent catalog or baseline; the shared catalog now includes
this program. The actual standalone evidence
lives in `/tmp/oratlas-g1-protocol-post-pg`, with protected URLs, native producer output, guarded
logs, capture/state pairs and all-87-table fixture accounting.

Independent review accepted the four-label before/after-empty-private-schema candidate executed at
`bef4f82`; manual baseline acceptance changed only review annotations. The final run with reviewed
disclosure guards and the test snapshot adapter remains pending. Fresh snapshot registration, first proposal resolution, real
registry/DOI retrieval, scientific validation and the other G1 obligations remain visible gaps.
This bounded program does not establish complete G1 or a private workspace runtime.
