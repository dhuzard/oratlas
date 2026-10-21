# Local synthetic alpha: effect-ordering fixture

**Status: local, synthetic, single-process test fixture only.** It establishes a _local fixture
contract_ for ordering externally visible effects against revocation (ADR-0001 §14.2) using a real
Node HTTP transport on loopback. It is **not** PostgreSQL evidence, not a distributed or
multi-instance protocol, not full S1, not G1 evidence and not a production design. It wires no
route, endpoint, provider, schema, table, migration, config or package; nothing in `apps/` or
`packages/` imports it. G1 is not passed, D11 stays provisional, and this fixture authorizes no
private tables, adapters or live provider calls. Session table, retention, unlink and identifier
reuse remain undecided ([identity design §8, §10](identity-persistence-session-design.md)).

Code: `scripts/local-synthetic-alpha/` (`scenario.ts`, `permits.ts`, `harness.ts` and three
`*.test.ts` files). Baseline `05a4854`; introduced in `ba125ae`, repaired after independent
review (§6).

## 1. What it models

The identity design (§5) leaves two activation blockers open: ordering of **protected response
release** and of a **live provider exchange start** against revocation. This fixture gives both a
concrete, falsifiable local protocol so that a later real design has an executable reference for
the required ordering property:

> Each effect (response hand-off, fixed denial, provider start, revocation commit) is ordered
> either before the revocation commit of its domain, or it is denied with no admission and no
> hand-off.

It does not show that any real system has this property.

## 2. Assumptions (exact)

- One Node.js process, one event loop, one logical **sole owner** of every synthetic domain. The
  gate is an in-memory FIFO; there is no lock shared with any other process or database.
- Two fixed, independent synthetic authorization domains: `alpha`, `beta`. No operation spans
  domains; an unknown domain is refused.
- All inputs are synthetic and frozen (`SYNTHETIC_ALPHA_SCENARIO`). No real user, collaborator,
  workspace, ORCID iD or provider identifier exists anywhere in the fixture.
- The HTTP server and its only intended client both belong to the fixture, on the literal IPv4
  address `127.0.0.1`, ephemeral port. No external network is used.
- The "store" and the "provider" are inert scenario data (`allow | deny | error`, `ok | error`)
  plus named barriers the test opens. No store query, no provider network call exists.
- Arbitrary JavaScript cannot be sandboxed, so arbitrary callbacks are **not accepted at all**:
  the owner never runs caller-supplied code. Every callback and internal method in the owner is
  trusted fixture code acting on trusted fixture data.

## 3. Public API

```ts
const harness = await createHarness(SYNTHETIC_ALPHA_SCENARIO); // claims the registry, then listens
harness.request(caseId); // real HTTP GET by the fixture's own client → RequestHandle
harness.runSyntheticProvider(caseId); // synthetic job admission → ProviderHandle
harness.revoke(domain); // queued in the same FIFO gate → RevokeHandle
await harness.stop(); // one-shot teardown → TeardownReport
harness.barriers.reached(opId, stage); // await a scripted barrier ("store" | "pre-boundary" | "completion")
harness.barriers.open(opId, stage); // let the owner continue past it
harness.trace(); // frozen copy of frozen trace events (read-only)
harness.waitForTrace(type, opId?); // data matcher, not a callback
harness.status(); // owner state, per-domain generation/revoked/queue/active, jobs
harness.operation(opId); // frozen operation snapshot incl. transport flags
```

Callers choose frozen case ids and domains, never URLs, bodies, headers, credentials or
callbacks. `createHarness` accepts only a scenario branded by `defineSyntheticScenario`, which
validates exact keys, enums and bounded printable ASCII, rejects functions, accessors and
non-plain objects, and deep-freezes a copy. Validation inspects every own key and property
descriptor **before** using any value and takes values from data descriptors only, so an accessor
is rejected without its getter running. Records must have an ordinary (or null) prototype and
exactly the contract's enumerable string data keys (no symbols, non-enumerable or extra keys);
`gated` must be a dense `Array.prototype` array of at most the stage count, with own keys exactly
its indices plus `length` (no holes, symbols or extra properties) and enumerable data elements.
This covers ordinary objects and arrays only: a `Proxy` can still run its traps while being
inspected, and arbitrary JavaScript is not sandboxed. There is no configurable public mode.
`RequestHandle.cancel()` is an owner-level withdrawal; `abortTransport()` simulates connection
loss by destroying the fixture client's socket. `ServerResponse` objects, permits, queues and the
permit authority are private class fields and never leave the owner.

## 4. Protocol

**Owner states:** `running | poisoned | stopped`. **Operation phases:**
`queued → held → resolving → admitted | denied → settled` (an invalidated queued operation goes
directly to its final decision `invalidated`).

1. **One FIFO gate per domain.** Every domain mutation, including revocation, is an operation in
   that domain's queue. Only the head (`active`) runs. New work cannot overtake a queued revoker.
2. **Generation captured when queued.** Each domain has an auth state `{ generation, revoked }`.
   An operation records `expectedGeneration` at enqueue time.
3. **Acquire, then recheck.** When an operation becomes `held` it re-reads the current auth state
   and cancellation; stale, revoked or cancelled work is denied without resolving the store.
4. **Hold the gate during inert store resolution.** Waiting on the synthetic store (and any
   barrier) is not an effect, but the gate stays held throughout.
5. **Recheck before mint; consume at the boundary.** After resolution the owner rechecks owner
   state, cancellation, transport and generation, then mints a permit and consumes it as the first
   step of the effect boundary, in the same synchronous step. Consumption rechecks owner state,
   gate holder, transport loss, cancellation and generation again.
6. **Permits** (`permits.ts`): empty frozen null-prototype objects interpreted only through the
   minting authority's private `WeakMap`, bound to `(domain, generation, operationId, kind)` with
   kinds `http-release | http-denial | provider-start | revoke-commit`. Single use: any
   presentation of a known permit spends it, whatever the verdict. No permit, closure or
   effect-capable reference is handed to any caller.

**HTTP boundary.** Real `node:http`. One fixed finite response per operation: `writeHead` plus one
synchronous `end(fixedBody)`; no streaming, early writes, `flushHeaders`, redirects,
informational responses or upgrades (`upgrade`/`connect` sockets are destroyed; `checkContinue`
and `checkExpectation` get the fixed 404). `finish`, `error` and `close` handlers are installed
**before** `end`. The gate is held until `finish` or a terminal transport failure. Three flags
are tracked separately: `handoffAttempted`, `finishObserved` (Node handed the bytes to the OS)
and `clientReceived` (the fixture client read every byte). **`finish` is not receipt.** A throw
from the hand-off may follow a partial hand-off, so it is conservatively classified terminal: the
socket is destroyed and nothing is retried. Denials (`404 not found` for revoked/stale/store-deny,
`503 unavailable` for cancelled/store-error) are owner-generated fixed responses through the same
boundary under the same gate, never a delayed callback. Headers are fixture-private:
`Cache-Control: private, no-store`, `Vary: Cookie`, fixed `Content-Type`/`Content-Length`,
`X-Content-Type-Options: nosniff`, `Connection: close`, no `Date`, no validators. The production
cache helper is **not** imported (the root architecture guard forbids scripts importing `apps/`).
Requests that are not a pending fixture operation get the fixed 404 and touch no domain.

**Provider start.** Admission is synchronous and owner-controlled: consume the `provider-start`
permit and record one frozen job; there is no provider network. The gate is released at
admission. Completion (`ok | error`) is recorded later, holds no permit and can start nothing; a
failure after admission does not erase the start. A retry or a new stage would be a new
operation needing a new gate permit.

**Revocation.** Runs in the same FIFO gate, consumes a `revoke-commit` permit, and commits the
synthetic epoch bump (`generation += 1`, `revoked = true`, trace `revoke.commit`). Invariant: an
old-generation admission or hand-off precedes `revoke.commit`, or the operation is denied with no
admission and no hand-off.

**Cancellation.** Queued: prevents admission. Active and unresolved or before the boundary: the
permit is never minted (and would be refused at consumption); the gate is still held until the
inert resolution settles, so a late resolution cannot resurrect it and cancellation is never an
unlock. After hand-off or provider admission: ignored, nothing is recalled. A definitive ordinary
rejection (synthetic store `error`) before any effect was delegated is a safe release.

**Connection loss and poisoning.** Connection loss alone never releases a held gate. If the gate
holder's transport closes or fails before `finish` (or the hand-off throws), the owner becomes
`poisoned`: new work is rejected, every queued or active operation is invalidated, server-side
sockets are destroyed, gate ownership is retained (the holder stays `active`), queued revokers
never commit and no replacement starts. A transport lost while merely queued holds nothing; that
operation is denied without effect when it reaches the head.

**Reentrancy.** Owner-private execution runs inside an `AsyncLocalStorage` context. Any public
mutating call (`request`, `runSyntheticProvider`, `revoke`, `cancel` on either handle,
`abortTransport`, `barriers.open`, `stop`, `createHarness`) observed inside it is rejected
immediately, same- or cross-domain, before it changes any state (`abortTransport` destroys no
socket and so cannot poison the owner from inside owner context). Read-only calls (`trace`,
`waitForTrace`, `status`, `operation`, `barriers.reached`) are not guarded. Private
completion handlers never enqueue. `simulateOwnerContextForTesting` exists only to falsify this
guard; the owner context is only ever consulted to refuse calls, so the probe grants nothing.

**Registry and stop.** A process-global sole-owner registry (`Symbol.for` key on `globalThis`) is
claimed **before** `listen`; a second owner is refused while one is live or poisoned. `stop()` is
one-shot: owner `stopped` (every permit refused), queued and active operations invalidated, all
sockets destroyed, listener closed. The registry is cleared only after teardown verifies the
listener closed and every tracked socket closed; otherwise it stays claimed and no automatic reuse
happens. A failed `listen` releases the registry only if nothing is listening. This registry is
not a guard against another OS process, an independent revoker (not allowed in this fixture) or
multiple production instances.

## 5. Failure and liveness (stated plainly)

- **Safety over availability.** A hung store resolution, barrier or transport blocks its domain,
  including revocation, indefinitely. There is no timeout and no forced unlock while effect-capable
  work is outstanding.
- **Poisoning is terminal for the owner.** Only `stop()` ends it; recovery is a new owner after a
  verified teardown.
- **Bytes handed to the OS are not recallable.** A released response may reach the client after
  revocation is requested, and possibly after poisoning; the fixture records `finishObserved` and
  never claims receipt from it.
- **Process crash** ends local future egress only. Bytes already handed to the kernel may still
  leave. There is no distributed failover, persistence or crash recovery guarantee.
- Node's own server timeouts may close a stalled socket; that is connection loss and poisons the
  owner rather than releasing a gate.

## 6. Tests and results

Deterministic: interleavings use named barriers and awaited trace/transport events, never sleeps
or timers. Positive authority is asserted on what the real loopback client received and on
recorded jobs, not only on the owner's trace. Files: `permits.test.ts` (7), `scenario.test.ts`
(33), `effect-ordering.test.ts` (23).

| Area                   | Test (abbreviated)                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effect wins            | HTTP release `handoff → finish → revoke.commit` with revoker queued before hand-off; client gets 200 and the exact bytes; later request gets 404. Provider admitted before commit; completion inert.        |
| Revoker wins           | Old-generation request queued behind the revoker: 404 over the wire, store never resolved, no release permit minted.                                                                                        |
| FIFO / fairness        | `holder, first, second, revoker, after` held in order; first two 200, `after` 404.                                                                                                                          |
| Independence           | `beta` completes while `alpha` is held and a revoker is queued; `beta` generation unchanged.                                                                                                                |
| Store/provider errors  | Store deny → fixed 404; store error → fixed 503 and the gate releases; provider store error → no job; failure after admission keeps the job, no retry, gate released at admission.                          |
| Transport              | Throw after `end` → poison, exactly one hand-off, queued revoker invalidated; socket destroyed at hand-off → terminal, no `finish`, client incomplete.                                                      |
| Cancellation           | Queued → 503, no store resolution; unresolved → gate still held until resolution, then 503; pre-boundary → no release permit; post-admission → ignored, nothing recalled.                                   |
| Poison                 | Client abort while unresolved with queued revoker and queued request: poisoned, holder retained as `active`, revoker and request invalidated, new work refused, late barrier open → zero permits/hand-offs. |
| Permits (standalone)   | Accept once; replay; forged lookalikes, spread copies and other-authority permits; wrong domain/operation/kind/generation (each burns the permit).                                                          |
| Reentrancy             | Same- and cross-domain `request`/`revoke`/`runSyntheticProvider`/`stop` and `createHarness` refused inside owner context; owner remains usable.                                                             |
| Reentrant handles      | Holder at its store barrier: `abortTransport`, both `cancel`s and `barriers.open` refused in owner context; no poison, no `transport.lost`, nothing cancelled or opened; holder then gets its 200.          |
| Registry / stop        | Second owner refused while live and while poisoned; verified stop releases; `stop` idempotent; stopped owner refuses work; listener `ECONNREFUSED` after stop; late barrier after stop has no effect.       |
| Scenario / API surface | Deep-frozen, copied input; functions, accessors, unknown keys/domains/kinds, non-ASCII, class instances refused; unbranded clones refused; unknown/wrong-kind case ids, URLs, `__proto__` refused.          |
| Inert-data validation  | Getters on a `gated` index, case field, `kind`, whole case, case map and name refused with a zero getter-call counter; holes, extra/symbol/non-enumerable keys, subclasses, overlong arrays refused.        |
| Real transport         | Exact bytes, `Content-Length`, `private, no-store`, `Vary: Cookie`, no `ETag`/`Last-Modified`/`Date`; foreign paths get 404 and change no domain state.                                                     |

Initial results at `ba125ae` (Node v24.21.0, tools from an existing install, no generation):
focused suite 45/45 on five consecutive runs. Falsification check: four deliberate harness
mutations were each caught by at least one test and then reverted (release on connection loss; no
generation recheck; gate released before `finish`; terminal failure released instead of
poisoned).

**Repair validation** (after independent review of `ba125ae`; same Node, tools from the parent
checkout's existing install via a temporary, since-removed `node_modules` symlink; no install,
build or client generation). Two review findings were reproduced and fixed:

1. `scenario.ts` read `gated` elements with `value[index]`, so an ordinary array whose index 0 was
   a getter had the getter invoked and its return value accepted, contradicting the inert-data
   contract. Validation now inspects keys and descriptors before use (see §3).
2. `RequestHandle.abortTransport` lacked the reentrancy guard, so calling it inside owner context
   while `alpha-read` held its store barrier destroyed the client socket and poisoned the owner
   instead of being rejected. It now throws `reentrant abortTransport rejected` first. Poisoning
   still fails closed on real connection loss; no unauthorized egress was found by the review.

Exact checks: focused suite 63/63 (7 + 33 + 23) on five consecutive runs; with
`scripts/architecture-boundaries.test.ts` 179/179; the `tsc` command below, `eslint` and
`prettier --check` all clean. Against the `ba125ae` versions of the files, the new tests fail
(1 in `effect-ordering.test.ts` with the old `harness.ts`; 6 in `scenario.test.ts` with the old
`scenario.ts`, including both array-index getter cases) and pass with the fix. The full
workspace suite was not run here.

Commands:

```bash
pnpm exec vitest run scripts/local-synthetic-alpha scripts/architecture-boundaries.test.ts
pnpm exec tsc --noEmit --strict --target ES2022 --lib ES2022 --module NodeNext \
  --moduleResolution NodeNext --noUncheckedIndexedAccess --noImplicitOverride \
  --noFallthroughCasesInSwitch --isolatedModules --esModuleInterop --skipLibCheck --types node \
  scripts/local-synthetic-alpha/*.ts
pnpm exec eslint scripts/local-synthetic-alpha && pnpm exec prettier --check scripts/local-synthetic-alpha docs/local-synthetic-alpha-ordering.md
```

The root `vitest.config.ts` already discovers `scripts/**/*.test.ts`; the tests use only loopback
on an ephemeral port.

### Independent review and parent integration (2026-10-20)

Independent re-review closed both correctness findings: array descriptors are validated without
executing getters, and reentrant transport abort is rejected before touching the socket. No new
intrinsic local ordering defect or material test gap was found. This does not expand the trusted,
single-process fixture assumptions or approve production S1.

Fresh installed parent validation passed **2,177 tests / 249 files** (16 tests / 6 existing opt-in
PostgreSQL files skipped); the combined G1/ordering/architecture focused run passed **262 tests**.
Workspace lint/typecheck, schema/OpenAPI checks, explicit script-aware TypeScript compilation,
supported-file formatting and diff checks also passed. No browser demonstration, persistence adapter,
build or browser E2E was added or run by this slice. Parent logs are recorded in the G1 implementation
record. The epic is **partial**, not complete; no gate is passed merely by this fixture.

## 7. What a real design still needs (not provided here)

- **Real PostgreSQL session fence.** The in-memory gate stands in for the shared, conflicting
  fence of ADR §14.2 / identity design §4. A real design must show the same ordering with real
  row locks across separate connections, including that a response or provider start does not
  leave after its check went stale, with `pg_locks`-based deterministic tests (identity design
  §11). Holding a DB lock across a network write is itself unresolved there.
- **Multi-instance / distributed ordering.** One process and one owner are assumed. Several
  instances, failover, split brain between DB and HTTP layer, and an independent revoker are out
  of scope and unsolved.
- **Next.js integration.** Route handlers, streaming responses, the framework's own buffering and
  caching, and where `finish` is observable in that stack are not modelled. Streaming and
  paginated responses need their own specification (ADR §14.2 item 5).
- **Live provider.** Ordering of a real outbound exchange start (identity design §5 item 2) is
  modelled only as synchronous local admission. A real adapter needs its own reviewed contract,
  G6 controls and a grant-revocation fence for any workspace-derived data.
- **Policy.** Session table versus epoch-only, retention, unlink, identifier reuse, D11 and the G1
  gate are unchanged and undecided by this fixture.
