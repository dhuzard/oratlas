# S1 protected response and provider-start coordination — reference design

**Status: proposed technical design for independent review; no coordinator or
transport adapter is implemented.** This supplements the durable transaction
protocol in `identity-persistence-session-design.md` §4 and addresses its §5
ordering questions. It supplies a concrete, deliberately single-authority
reference topology. It does not pass G1, activate routes/providers or establish
production readiness. The [owner register](private-workspace-owner-decisions.md#follow-up-decisions-approved-2026-10-21)
records the approved 2026-10-21 server-session/epoch, lifecycle and synthetic-only
choices. This document does not choose retention periods or authorize activation.

## Boundary and achievable guarantee

The protected effect is the actual handoff of a bounded non-streaming response
(status, headers, body and redirect) to the service's external transport, or the
first outbound handoff of a provider exchange request. Preparing bytes,
returning a NextResponse, enqueueing a job, checking a session and committing a
flow consume are not these boundaries. A durable identity-link write remains a
separate §4 finalization with its PostgreSQL lock protocol.

Every admitted external handoff must occur before the relevant revocation
commit, or be refused after it. Data handed off before revocation can arrive at
the peer afterwards and cannot be recalled. A provider request started before
revocation can finish afterwards; its later durable result must still satisfy
§4. Ownership verification gives no workspace permission. Streaming, SSE,
long-poll, response continuation, provider redirects/retries and processing of
workspace data are excluded; they require additional effect-stage contracts.

## Concrete reference topology

One service-owned **identity effect authority** is the only process allowed to
both release these protected responses/start these provider requests and issue
session revocations, principal disable/epoch changes or identity invalidations.
All relevant applications, instances and workers send prepared operations to
this authority over authenticated internal RPC. Workers have no direct egress
path for protected effects and no database privilege to write the relevant
revocation state independently. The authority derives the principal/session
from the authenticated operation; callers cannot choose a scope or epoch.
Public legacy routes are unchanged and are not claimed protected by this design.

The first implementation uses **one serial operation queue for the entire
identity authority**, deliberately avoiding a distributed lock or independently
cached per-scope queues. Only one operation is active. This is a throughput and
availability tradeoff, acceptable for a synthetic reference implementation;
it is not permission to run replicas that each own a queue. RPC admission uses
bounded queues/deadlines; absence, overload or uncertainty is unavailable.
Neither a reusable bearer permit nor a pre-check result leaves the authority.

Required internal operations:

- `releasePreparedResponse`: a caller supplies an opaque prepared-result handle,
  not a preauthorized response. The authority freshly checks current principal,
  session, epochs, deadline and result ownership, materializes the bounded bytes,
  then performs the handoff itself while retaining exclusive queue ownership.
- `startProviderExchange`: after a committed single-use flow consume, freshly
  check the same authority state and receipt/tuple binding, then start exactly
  one allowlisted request under queue ownership. No credential, authorization
  code, raw state or receipt is logged, persisted as request payload or returned.
  Consume alone never authorizes the start. A crash burns the flow; there is no
  automatic exchange retry after an ambiguous start.
- `revokeOrDisable`: close admission by taking the same queue, commit the
  applicable epoch bump/revocation/disabled flag transaction, then acknowledge.
  It must also make affected pending flows unusable. Link invalidation remains
  distinct from logout; all operations consult current invalidation state.
  Account deletion first disables access; final erasure is a retention workflow,
  not an immediate physical cascade invented by this design.

The authority holds queue ownership across awaits, including transport
completion, and no operation may detach a send or schedule a later write.
Transport events cannot trigger a new protected handoff outside that ownership.
The provider's later response is collected without retaining the global queue;
§4 finalization and any subsequent protected response acquire their own ordered
operations. The injected verifier used by current tests remains synthetic.

## Why the revoker race is ordered

**Effect first:** the effect enters the queue, re-reads authoritative rows, and
finishes its actual handoff. Only then can the revoker start its transaction and
commit. The handed-off bytes were authorized before that commit, even if their
network delivery is delayed. A durable link result remains separately fenced.

**Revoker first:** the revoker holds the queue through its database commit. The
next effect reads the new epoch/revoked/disabled state and refuses the handoff.
A response prepared by another worker before revocation gains no exception.

**During handoff:** revocation waits. Bounded operation deadlines are required,
but expiration of a timer must never silently release queue ownership while a
send can still occur. On timeout the transport is aborted and proven quiescent
before proceeding. If quiescence cannot be established, close the authority to
all effects/revocation acknowledgements and report unavailable; do not claim the
revocation committed or that an ambiguous request never started.

A transport adapter must identify its actual release boundary and prove when
all protected bytes have been handed off or further release is impossible.
An ordinary application callback, Promise resolution, HTTP response object,
local buffer enqueue or socket close request is not assumed to provide that
proof. If the chosen HTTP/proxy stack cannot provide it, that adapter remains a
production blocker. No generic database/network atomicity is asserted.

## Deadline and clock contract

The authority checks the current authoritative clock immediately before each
actual handoff, against the minimum session/flow/operation deadline. Queue
admission and a clock sample taken before preparation are insufficient. A future
adapter must specify its clock source and bound its skew relative to the DB
clock used by §4. Unknown clock health or exceeded skew fails closed. No skew
bound or timeout value is invented or implemented by this design.

Epoch ordering comes from the shared authority, whereas expiry is wall-clock
based. There is unavoidable latency between the final clock sample and the
actual transport handoff (and between a final DB deadline check and commit).
This design does not promise zero-time DB/network expiry atomicity. The
transport review must state and test its bounded deadline-check/handoff latency,
including stalls; an unbounded stall cannot inherit an earlier successful
check. Multi-stage handoffs require renewed checks and the separate streaming
contract, rather than an implicit indefinitely valid permit. No implementation
or production expiry guarantee is claimed by these proposed requirements.

## Database uncertainty, process failure and multiple instances

The authority reads/writes only the authoritative primary, never a stale
replica. All application revocation writers use this queue; database operators
are a separate privileged threat class, not secretly covered by this guarantee.
The §4 principal/session/receipt locks still protect durable link writes made
by separate workers. Authority serialization does not replace those locks.

A lost commit acknowledgement closes the queue to new external effects. On a
new primary transaction, acquire the same principal/session lock as the original
revoker, wait for the original transaction to finish, and read its durable epoch
or revocation outcome. Timeouts remain unavailable. An optimistic unlocked
read, transaction timestamp or expired lease cannot prove the old write ended.
Only after a known outcome and current state may the authority reopen.

A crash may leave bytes already handed to the transport and an unknown exchange
start. These are recorded as ambiguous, never replayed automatically. Recovery
requires proving the old authority can perform no further handoffs and resolving
in-flight database writes before admitting new work. Unsent prepared results
are dropped; no response cache is replayed as fresh authorization.

**No automatic failover:** a distributed lease, leader record or fencing token
in a database cannot itself stop an isolated old process from writing a socket.
A replacement authority must not start until operational fencing demonstrably
terminates/disables the old authority's egress and authority-write capability,
including existing connections and queued writes. Network partition or inability
to prove that fencing means unavailable. A future HA design needs a separately
reviewed egress receiver that enforces generations at the actual boundary;
merely checking a generation before sending repeats the original race.

This design therefore provides an implementable single-authority _topology and
protocol_, not evidence that the current Next.js deployment provides its egress
or process-fencing primitives. Those adapters and crash proofs remain activation
requirements. There is no universal post-revocation recall guarantee.

## Required deterministic review evidence before wiring

Use barriers/hooks and an instrumented synthetic transport, not timing sleeps:

1. Two worker processes submit effects through one authority. Revoker-first
   denies both; effect-first blocks revocation until the recorded handoff.
2. Pause between authorization and actual handoff. A revoker cannot commit
   through that gap. A mutation releasing the queue after the pre-check fails.
3. Pause after flow consume, revoke, then request provider start: no outbound
   handoff; an earlier consume does not bypass current-session checks.
4. Provider starts first, then revoke while its response waits: later durable
   finalization is rejected by §4; no callback outcome leaks outside a freshly
   ordered response operation. No automatic retry on ambiguous start.
5. Handoff timeout/error with partial bytes: record earlier releases, abort and
   prove quiescence, or freeze admission. Do not claim partial bytes recalled.
6. Drop commit acknowledgement with the original revoker transaction held open:
   effect admission stays closed; reconciliation waits on a conflicting row lock.
7. Simulate stale replicas, two authority queues, detached transport writes,
   process restart and split brain. Every unsupported topology fails closed;
   a lease-only mutation must fail the old-writer test.
8. Externally returned errors/status/redirects are also protected handoffs. Tests
   scan payloads/logs for tokens, identity conflicts and other-principal data.

Real PostgreSQL contention evidence, real transport semantics and operational
fencing evidence are separate from a fake coordinator test. Passing synthetic
unit tests cannot authorize a live provider, real tester, private content or
hosted enablement. Retention purge refuses missing configuration; no period is
selected here. Existing G1–G6 and legal/privacy gates remain applicable.

## Disconnected v2 session contracts delivered alongside this design

`apps/web/src/lib/session-instance.ts` defines strict server-row snapshots and a
version/domain-separated `v2` cookie. It reuses the existing session-token HMAC
and seven-day lifetime implementation; existing v1 parsing/signing and public
authentication are unchanged. The cookie identifies an instance, never a local
principal or authorization grant. A future persistence adapter must CSPRNG-mint
at least 128-bit instance ids; string shape cannot prove randomness.

Validation requires the exact signed instance/issue time, matching existing
principal, matching current epoch, enabled principal, nonrevoked row and a
strictly unexpired row lifetime no longer than seven days. It returns only
principal id, instance binding and deadline, rejecting v1 fallback. These are
**checks of supplied snapshots**, not database freshness or effect fencing. No
production caller imports this module. It creates no row, cookie response,
provider call, session rotation or retention job. Persistence follows G1 and the
separately reviewed store/lifecycle implementation; this design creates no tables.
