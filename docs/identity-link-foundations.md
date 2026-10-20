# Identity-link foundations (#203, ORA-203)

Status: **foundation only, not activated.** This page describes
`apps/web/src/lib/identity-link-foundations.ts` and its tests. No route, page, API, database
table, migration, configuration, environment variable or existing module imports or calls it.
Existing sign-in, session, GitHub identity, API and source-credit behaviour is unchanged. No live
provider, endpoint, credential or real person's data is used anywhere; every fixture is synthetic
(`*.invalid` issuer, `synthetic-*` subjects).

## What it is and is not

The module is an internal, framework-free async orchestrator with two public entry points,
`begin(input: unknown)` and `complete(input: unknown)`. It decides whether **the current local
principal has shown control of one external identifier in one allowlisted namespace**, and asks an
injected store to record that link atomically.

It is **not** an OAuth or OpenID client. It builds no authorization URL, calls no endpoint, and
assumes nothing about ORCID, PKCE, token formats or scopes. The identifier is an opaque `subject`
string in a namespace made of exact `provider`, `issuer` and `environment` strings. Nothing is
case-folded, trimmed or URL-normalized.

A link is an **identifier-control assertion only**. It is not a login, account creation, session,
grant, membership, workspace capability, authorship, CRediT role or credit (ADR-0001 §4.1–§4.2,
D4). It never creates, merges, reassigns, replaces or unlinks an account or link, and it writes no
profile field.

## Interfaces and trust obligations

The caller supplies only a configured namespace key and an opaque authentication context. For
`complete`, it also supplies the callback `state` and `code`. Input objects are strict: a
caller-supplied principal, session binding, subject or assertion is rejected (ADR-0001 §4.2 rule
4). Bounds: `state` is exactly 43 canonical base64url characters (256 bits); `code` is 1–512
printable ASCII characters with no whitespace. Configuration is a strict allowlist of 1–16
namespaces with unique keys and unique `(provider, issuer, environment)` tuples, and a
`flowTtlMs` from 1 ms to 30 minutes; that range is a sanity bound, not a chosen policy.

| Dependency                 | Obligation the module relies on                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveSession(ctx)`      | Derives `{ principalId, sessionBinding, validUntilMs }` for an **existing** principal from server-verified credentials only, or returns `null`. `sessionBinding` identifies the session instance and is not the cookie value, the principal id or anything the caller chooses. The module rejects a binding equal to the principal id; it cannot check the rest.          |
| `nowMs()`                  | Returns a non-negative safe-integer millisecond clock.                                                                                                                                                                                                                                                                                                                    |
| `randomBytes(32)`          | Returns 32 cryptographically secure random bytes. The module checks the type and length only; it cannot measure entropy.                                                                                                                                                                                                                                                  |
| `digestState(state)`       | Returns a lowercase-hex 256-bit digest of the canonical state (for example SHA-256). Only this digest is stored.                                                                                                                                                                                                                                                          |
| `verify({namespace,code})` | Establishes provider-side identifier control and returns only `{ status: "verified", provider, issuer, environment, subject }` or `{ status: "rejected" }`. Extra fields (such as tokens) are rejected. The module requires the returned namespace to match the configured one exactly; it never trusts a caller's assertion.                                             |
| `store.insertFresh`        | Inserts a pending flow only if its state digest is new. It never overwrites on collision.                                                                                                                                                                                                                                                                                 |
| `store.consumeIfMatches`   | In one atomic step, at the store's own current time: the flow exists, matches namespace, principal, session binding and digest exactly, and neither the flow nor the session has expired. It then consumes the flow, never restores it, and returns the flow plus an internal receipt.                                                                                    |
| `store.finalize`           | One atomic compare-and-link at the store's own current time. The receipt is valid, unfinalized and bound to the same principal, session and namespace. The principal still exists. The time is before `deadlineMs` and the flow expiry. `(namespace, subject)` is unowned or owned by this principal. A real uniqueness constraint enforces this, not lookup-then-insert. |

The receipt is an internal opaque handle with explicit store trust. It is never returned to the
caller and is not a credential. The module validates every session, flow, receipt, assertion and
store result against a strict schema, plus the bound invariants (exact field match, TTL bound,
issue/expiry ordering), before it reports success. It snapshots inputs, configuration and
dependency references before the first `await`.

**A future persistent store must enforce its own guarantees.** It must revalidate the receipt
binding, the deadline and principal existence inside its own transaction, and enforce subject
uniqueness with a database constraint. The module's pre-checks narrow the window for mistakes but
are not a substitute.

## Flow

1. `begin`: validate the input, look up the namespace, resolve the session (it must not be
   expired), draw 256 random bits, encode them canonically and store the flow's state digest. The
   flow binds the namespace, principal, session binding and issue time. It expires at
   `min(issued + flowTtlMs, session.validUntilMs)`. `begin` returns `{ status: "started", state,
expiresAtMs }`. The raw state leaves only through this return value, for the future caller to
   place in its redirect.
2. `complete`: validate the input, then resolve the session. Consume the flow atomically; a wrong
   or expired state is denied here, before the verifier. Recheck the time, then call the verifier
   **at most once per state**: competing callbacks with the same state cannot both consume it.
   After that await, recheck the flow and session deadlines. Resolve the session again and require
   the identical principal and binding, unexpired. Then finalize with the earliest deadline.

| Result           | Meaning                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `started`        | `begin` only: a pending flow was stored.                                                                                                                          |
| `linked`         | The store committed a new link for the current principal.                                                                                                         |
| `already-linked` | An independent, separately verified flow by the same principal found its own existing link. The record is preserved, not rewritten.                               |
| `conflict`       | The subject belongs to another principal, or this principal already holds another subject in the namespace (see cardinality below). Owner info is never returned. |
| `denied`         | Malformed input, unknown namespace, no or expired session, wrong or replayed state, provider rejection, session change, or a deadline passed.                     |
| `unavailable`    | Invalid configuration or dependencies, or a dependency threw or broke its contract (malformed result, namespace mismatch, flow mismatch, collision).              |

Results never echo input, subjects, receipts or other principals. The module has no logger.

**An ambiguous commit is not proof of "no link".** If `finalize` throws after the store may have
committed, the result is `unavailable`, and the link may or may not exist. A future caller must
reconcile, for example by a later independent flow that returns `already-linked`. It must never
tell the user that nothing was linked.

## What the tests prove, and what they do not

`identity-link-foundations.test.ts` uses a synthetic clock, session map, verifier and in-memory
store. It uses deferred barriers (promises), not sleeps or timers. It covers malformed input,
expired or missing sessions, invalid configuration, RNG and collision failures for `begin`. For
`complete`, it covers wrong principal, session, namespace or state; replay; simultaneous same-state
callbacks with exactly one exchange; expiry before, at, and during the exchange, at the recheck,
and while finalization is queued; malformed, token-bearing and wrong-namespace assertions;
provider failure; logout, session change, principal change and deletion during the await; a
cross-user race for one subject; same-user idempotence across flows; dependency errors and lost
acknowledgements; and that no raw state or code is stored or returned. It also exercises the fake
store contract: single-use receipts, uniqueness, rollback and principal existence.

These tests prove the **orchestrator logic and the contract it expects**. They do not prove:

- real database atomicity, isolation or contention behaviour (the fake is single-threaded
  JavaScript);
- PKCE, OAuth or OpenID security, redirect or callback handling, CSRF or any provider's behaviour;
- entropy of a real RNG, or properties of a real hash;
- atomic or linearizable revocation in production.

## Explicit limitations

- **No session-instance binding exists today.** The current `oratlas_session` cookie carries only
  a user id and issue time (`session-token.ts`). There is no session table, no session-instance id
  and no server-side revocation registry; D5 chose epochs, not a session table. A production
  adapter must define a real, non-cookie session binding and a revocation registry before this
  module can be wired to any route.
- **Re-resolving the session is not linearizable revocation.** The second `resolveSession` narrows
  the window. A logout or revocation committed after that check but before `finalize` commits is
  not ordered against the link. Fencing finalization against revocation is required (ADR-0001
  §14.2), and the store's `finalize` is where that fence belongs. Nothing here implements it.
- **ADR epochs and unlink are unresolved.** `user.authz_epoch` (§8), unlink and recovery do not
  exist yet. Their absence does not defer or waive any control above; it means those controls are
  still missing.
- **Per-user cardinality is an owner decision.** Until it is ratified, a second subject for the
  same principal in one namespace fails closed as `conflict` (`other-subject-linked` in the store
  contract). This is a provisional refusal, not a chosen policy.
- **Manual vs verified precedence is an owner decision.** The module never reads or compares any
  manually entered identifier and never changes one.

## Owner decision checklist (unresolved — not defaults)

- [ ] Precedence between manually entered and verified identifiers, and the wording for each.
- [ ] Per-user link cardinality per namespace.
- [ ] Unlink, account recovery, and invalidation of links on account deletion or identity change;
      interaction with `user.authz_epoch`.
- [ ] Retention and privacy of link records, flows and receipts; public versus private display;
      the public wording for a verified link. It must not imply trust, peer review, authorship or
      access.
- [ ] Ratification of ADR-0001 §14 (still proposed), including the §14.2 finalization fence.
- [ ] D11 counsel and DPIA confirmation before any real person's data is stored.

## Next slices (none built now)

1. Owner decisions above, plus an official preflight of the target provider's documentation
   (endpoints, PKCE, issuer and subject semantics, sandbox versus production environments).
2. Real persistence: an additive migration with a unique `(namespace, subject)` constraint,
   atomic single-use flow and receipt rows, a session-instance binding and revocation fence, and
   database contention tests (for example on Postgres).
3. Later, a separately reviewed live activation: route wiring, provider client, feature flag
   default off and kill switch, all behind the gates above.
