# Identity persistence and session-instance design (S1) — reviewed durable-identity component

**Status: PROPOSED DURABLE-IDENTITY COMPONENT design, independently reviewed on 2026-10-20;
detailed retention/lifecycle policy choices remain open. It is NOT a complete S1 production or HTTP design, and full S1
remains incomplete.** It specifies the durable transaction protocol only. It does not authorize any HTTP
callback result, fresh-read endpoint or provider-adapter wiring, and it contains no response-release
or provider-exchange-start ordering contract (§5, which records those as activation blockers). It is
not owner-approved schema or implemented persistence. Independent re-review found no remaining
intrinsic blocker/correctness/regression finding in the durable protocol; that is not validation
of the missing §5 contracts or production safety. The owner approved I1, I2, I3 and
ADR §14/§15 on 2026-10-20 and _commissioned_ this design (S1); commissioning is not approval of
anything below. The 2026-10-21 [owner follow-up](private-workspace-owner-decisions.md#follow-up-decisions-approved-2026-10-21)
selects server-side session instances plus epochs and the seven-day maximum,
with local/CI synthetic-only development. D11 stays provisional; detailed I4
retention and identifier-reuse rules remain pending. The
G1 PostgreSQL harness is partial and G1 is not passed. Nothing here changes code, schema or config.

Baseline: `1cb74a4`. Inputs: [identity-link foundations](identity-link-foundations.md),
[ORCID preflight](orcid-linking-preflight.md), [owner register](private-workspace-owner-decisions.md),
[ADR-0001 §8, §14.2](private-workspace-security-architecture.md),
[G1 harness](private-workspace-g1-harness.md).

## 1. Current facts this design starts from

- `oratlas_session` is `${userId}.${issuedAtMs}.${HMAC-SHA256 base64url}` (`session-token.ts`),
  7-day server-checked lifetime. It carries no instance id; `destroySession()` only deletes the
  cookie, so nothing server-side is revoked. A v1 token cannot be bound to a flow or revoked.
- `ResolvedSession` (`identity-link-foundations.ts`) requires `sessionBinding` that is not the
  cookie value or principal id, and `IdentityLinkStore` already names `insertFresh`,
  `consumeIfMatches`, `finalize`. The module's second `resolveSession` is a pre-check only.
- GitHub login uses a separate 128-bit hex `oratlas_oauth_state` cookie compare and no session
  binding. It is unchanged here. `User.orcid`/`orcidVerifiedAt` are manual/legacy fields.
- `user.authz_epoch` (ADR §8) does not exist. D5 adopted epochs and did **not** choose a session
  table. Epochs are retained.

## 2. Semantics fixed by approved baseline

- ORCID is the primary researcher identifier; a GitHub local account remains a complete way to use
  the product. ORCID is not mandatory and gives no workspace authority.
- Manual entry: valid checksum plus an ORCID API match is **API-recognized, ownership
  unverified**. An API error or timeout is **inconclusive** (neither recognized nor nonexistent).
  Only an authenticated OAuth link proves identifier control, and only control: never access,
  membership, credit, authorship or account merge. Manual and verified assertions stay separate
  fields and are never silently reconciled.
- Ownership key is the immutable tuple `(provider, issuer, environment, subject)`. The local
  `namespace_key` is a routing label and flow binding only, never an ownership scope.
- One subject per `(provider, issuer, environment)` per principal; a second fails closed.

## 3. Proposed additive tables (names and columns are proposals)

String/enum conventions follow CLAUDE.md (String columns, contracts-validated, Postgres-portable).

**`session_instance`** (rationale: a binding that is neither cookie nor principal needs a
server-side identity, and "revoke this session" needs a row to fence; epochs alone are per
principal and cannot name one session). D5 originally did not choose a session table; the 2026-10-21 owner follow-up
now selects server-side instances plus epochs. The concrete schema and adapter
remain technical proposals for review, not implemented persistence.

| Column                          | Constraint / note                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `id`                            | PK, ≥128-bit CSPRNG opaque, URL-safe. This is `sessionBinding`.                         |
| `user_id`                       | FK `User.id`, `ON DELETE RESTRICT`, NOT NULL                                            |
| `authz_epoch_at_issue`          | integer; valid only while equal to the principal's current epoch (once that exists)     |
| `issued_at`, `expires_at`       | timestamptz NOT NULL; `expires_at > issued_at`                                          |
| `revoked_at`, `revoked_by_kind` | nullable; `revoked_at` written once (trigger or conditional `UPDATE … WHERE … IS NULL`) |

Instance id, principal binding, epoch-at-issue and issue time are immutable in
the future adapter/schema. Never refresh an old instance to a new epoch; mint a
new instance after reauthentication instead. Expiry cannot be extended beyond
the original seven-day maximum. These are storage invariants to implement and
test, not claims that the disconnected snapshot validator enforces write access.

Cookie v2 (proposed, separate versioned reader; v1 reader untouched) carries the instance id plus
issue time and HMAC. The cookie is authentication evidence; the row is authority.

**`identity_link_flow`**: `id` PK; `namespace_key`; `provider`, `issuer`, `environment` (written
once); `principal_id` FK; `session_instance_id` FK; `state_digest` CHAR(64) **UNIQUE** (SHA-256 of
the canonical 43-char state; raw state never stored); `issued_at`, `expires_at` (CHECK
`expires_at > issued_at`); `consumed_at` nullable. UNIQUE
`(id, namespace_key, provider, issuer, environment, principal_id, session_instance_id)` as an FK
target.

**`identity_link_receipt`**: `id` PK; `flow_id` **UNIQUE**; `receipt_digest` **UNIQUE** (the raw
≥128-bit receipt exists only in the finalizing request's memory); copies of key, tuple, principal,
session instance, `expires_at`; composite FK over the flow's unique tuple above, so a receipt
cannot diverge from its flow; `terminal_at` and `outcome` (`linked | already-linked | conflict |
rejected`) both NULL until the one terminal write, then both NOT NULL (CHECK).

**`identity_link`**: `id` PK; `principal_id` FK; `provider`, `issuer`, `environment`, `subject`;
`namespace_key_at_link` (informational); `receipt_id` nullable FK (`ON DELETE SET NULL`, see §9);
`created_at`. **UNIQUE `(provider, issuer, environment, subject)`** (cross-principal ownership,
independent of key) and **UNIQUE `(principal_id, provider, issuer, environment)`** (I2
cardinality). No `updated_at`, no unlink or status column: lifecycle is unresolved (§8).

Tuple/subject columns are immutable: the adapter never issues `UPDATE` on them, enforced by a
PostgreSQL trigger in a raw-SQL migration. That trigger is not SQLite-portable; whether to accept
a PG-only migration step against the portability convention is a technical choice for review.

## 4. Real-PostgreSQL transaction protocol

All steps use `READ COMMITTED` (default). No design claim depends on `SERIALIZABLE` or on a
snapshot reading the revoker's later commit; ADR §14.2 says neither orders a finalizer against a
revoker. Ordering comes from **row locks that conflict**.

**Fence.** Finalizers take `SELECT … FOR SHARE` on the principal row and the `session_instance`
row. The revoker (`UPDATE session_instance SET revoked_at …`, epoch bump, or `DELETE` of the
principal) takes a conflicting row lock on the same row. `FOR SHARE` conflicts with
`FOR NO KEY UPDATE`/`FOR UPDATE`; `FOR KEY SHARE` would **not** conflict with a non-key `UPDATE`
and is forbidden here. Finalizers do not block each other. The lock is held until `COMMIT` of the
durable effect, so each finalization is ordered before the revocation commit or fails after it.

**Lock order (deterministic, all actors):** principal row → `session_instance` row(s) in ascending
`id` → `identity_link_flow` → `identity_link_receipt` → `identity_link` writes. Revoke-all takes
the principal row first, then sessions ascending. Never lock backwards, so no cycle among these
actors. `lock_timeout` and `statement_timeout` are set `LOCAL` and bounded; values are an
operations choice, not invented here. A timeout aborts the tx and surfaces as `unavailable`.

**Authoritative session validity (every stage, under these locks).** Re-read the
principal and session from the authoritative primary: both must exist; the
session must belong to that principal; the principal must be enabled;
`session.authz_epoch_at_issue` must equal the current `principal.authz_epoch`;
the session must be nonrevoked and unexpired at the current DB clock. The
flow/receipt tuple, principal and session binding must also match where present,
and all applicable flow/receipt/operation deadlines must hold. An old snapshot,
matching cookie signature or a row's mere existence is never sufficient. Apply
this predicate in begin, consume, finalize and reconciliation; epoch bumps and
principal disablement invalidate pending effects even if the session row was
not individually marked revoked. No such database adapter exists yet.

**Step A: `begin` (`insertFresh`).** One tx: lock principal and session `FOR SHARE`; require
the full authoritative validity predicate above, including current epoch and enabled principal;
`INSERT` flow, treat `23505` on
`state_digest` as `collision`. Flow `expires_at = min(issued + flowTtl, session.expires_at)`.

**Step B: consume, then exchange.** One short tx: take the same locks; enforce the
full authoritative session validity predicate, then execute one conditional statement:
`UPDATE identity_link_flow SET consumed_at = clock_timestamp() WHERE state_digest = $d AND
namespace_key/tuple/principal/session all equal AND consumed_at IS NULL AND expires_at >
clock_timestamp() RETURNING …`; zero rows ⇒ `rejected` and nothing changes. In the same tx insert
the receipt. Commit. Single use is the row transition, not an in-process check, so two instances
racing one `state` yield exactly one `consumed`. **The provider exchange runs after this commit,
outside any transaction, holding no DB lock.** A crash after consume burns the state (user
restarts); the design never "un-consumes". Consume committing does **not** fence the exchange
start: revocation can commit between consume and the outbound call, and no DB lock is held then.
That gap is unresolved and is an activation blocker (§5).

**Step C: finalize.** One bounded tx, after the exchange:

1. Lock principal then session `FOR SHARE`; re-read both under the lock (a read taken before is
   never trusted). Enforce the full authoritative validity predicate, including enabled principal,
   session ownership and equality of the current epoch. Any invalid condition ⇒ write terminal
   `rejected`, commit, return `denied`.
2. `SELECT … FROM identity_link_receipt WHERE receipt_digest = $r FOR UPDATE`; require
   unterminated, with key, tuple, principal and session equal to the request; assertion tuple equals
   the receipt's tuple (the verified subject is accepted only for the bound tuple).
3. `INSERT INTO identity_link … ON CONFLICT DO NOTHING RETURNING id` (no conflict target, so it
   covers both unique constraints). A concurrent inserter of the same keys makes this statement
   wait for its commit/abort; afterwards the winner is visible to the next statement.
4. No row returned ⇒ the failed insert may have hit either unique constraint, so classify with
   **two** consistent lookups in this tx, each after the conflicting inserter has committed (the
   `ON CONFLICT DO NOTHING` wait guarantees visibility to the next statement): (a) by
   `(provider, issuer, environment, subject)`: same principal ⇒ `already-linked`, other principal ⇒
   `conflict`; (b) if (a) finds nothing, by `(principal_id, provider, issuer, environment)`: a row
   with a **different subject** ⇒ `conflict` (per-principal cardinality, I2). Looking up only the
   attempted tuple+subject cannot see (b). If neither lookup finds a row (the winner rolled back or
   was deleted meanwhile), retry step 3 once, then `unavailable`; never infer success or a
   specific cause. Output is the generic class only (`already-linked` or `conflict`) and never
   contains the other principal, the other subject or constraint names.
5. Write the receipt terminal outcome **in this same tx**.
6. **Final deadline check as the last statement before `COMMIT`:** `clock_timestamp() <
least(flow.expires_at, session.expires_at, $deadline)`, else write terminal `rejected` and
   commit that instead of the link (rollback to a savepoint taken before step 3). Wall clock is
   `clock_timestamp()`, never `now()` (transaction start). Waiting on locks therefore cannot
   extend a deadline. The unavoidable residual is commit latency after this check; it is bounded
   by the timeouts above and is **not** claimed to be zero. Store and module clocks must be the DB
   clock or have a stated skew bound (open technical item).

Link, terminal receipt and release of the locks become visible atomically at `COMMIT`.

**Ambiguous commit.** If the connection drops after `COMMIT` was sent, the result is
`unavailable`, never "not linked". The original backend may still be running server-side, so
**receipt expiry is not evidence that the original transaction is absent**, and an unlocked read of
an unterminated expired receipt proves nothing. Reconcile in a new tx by `receipt_digest` (the
finalizing request still holds the raw receipt) **through the same locks as finalize**: principal
`FOR SHARE`, session `FOR SHARE`, then `receipt FOR UPDATE`, under `lock_timeout`. The receipt lock
conflicts with the original finalizer, so the reconciler either waits for the original to commit or
abort, or times out and stays `unavailable`. Only the state re-read **after acquiring the receipt
lock** counts:

Enforce the same authoritative principal/session validity and request binding
under these locks before reconciliation can return a result or retry an effect.
If the principal is disabled, the epoch moved, the session is revoked/expired or
binding is invalid, return `denied` without releasing a prior outcome. An
internal reconciliation of a historical commit is not authorization to expose
that result to an invalid session. A missing row or uncertain lock/commit state
remains `unavailable`. Retrying finalize additionally requires all current
flow/receipt/operation deadlines; a historical terminal receipt is not a fresh
effect permit.

- terminal `linked`/`already-linked`/`rejected`/`conflict` ⇒ report that.
- still unterminated, so the original finished without effect (or never ran): if past `expires_at`,
  the reconciler itself writes terminal `rejected` under the held lock and commits, then reports
  "not linked, restart"; a late original then finds a terminal receipt and writes nothing. If
  unexpired, retry the idempotent finalize in this same tx (single-use receipt).
- principal or session no longer present, or lock timeout ⇒ `unavailable`; never "not linked".

Without the receipt, an internal store read by the authenticated principal (not an endpoint) reads its own link for the tuple; a present
matching link is reported as `already-linked`; absence of a link is **not** proof of non-linking
while a finalizer may be in flight, so it is reported as "unknown" and may be retried.

**Deletion, rollback, races.** A principal that no longer exists at step C ⇒ `denied`, nothing
written. A delete attempted during C waits behind the `FOR SHARE` lock; since `ON DELETE RESTRICT`
applies while sessions, flows or links reference the principal, account deletion needs its own
lifecycle (§8). A failure in steps 3-6 rolls back the link and terminal receipt together, so they
cannot disagree. Uniqueness races (two principals, two aliases, one subject) are decided by the
unique indexes, not by lookup-then-insert.

## 5. Scope boundary: what this component does NOT fence

The fence in §4 orders the **durable identity effect** against revocation. It cannot hold a DB lock
across response bytes or an outbound provider call: after `COMMIT` the lock is gone, and a later
revocation cannot recall bytes already handed to the network. ADR §14.2 requires an externally
visible effect fence; this component does **not** provide one, and a minimal status plus a freshly
authenticated read do **not** establish release ordering. This is not a complete S1 design and
nothing below is compliance already met.

**Unfenced, explicit activation blockers (each needs a separate concrete, reviewed
coordinator/ordering contract before any production wiring):**

1. **Protected response release.** Ordering of response hand-off against revocation. No cross-resource
   atomicity (DB lock plus network write) is claimed or inventable here; connection loss and
   split-brain between the DB and the HTTP layer are not solved.
2. **Live provider exchange start.** Not fenced merely because the prior consume committed (§4B).
   Failure to fence the start is a blocker for **live** provider verification even if only an
   identity is proven, because the call is an outbound effect carrying the authorization code.

**Not authorized by this component:** any HTTP callback result (including a generic route whose
status, body or redirect depends on the outcome), any fresh-read endpoint, and any provider-adapter
wiring. A static, generic acknowledgement issued before asynchronous protected work is recorded only
as an **optional future public, non-result protocol that needs its own review**; it is not a
workaround for the blockers above.

**Test scope.** The injected verifier remains synthetic in the first persistence tests; no real
provider is called. Ownership proof is not a workspace processing permission: if any future flow
sent workspace-derived data to a provider, that start would need its own grant-revocation fence.
This design makes **no universal post-revocation recall guarantee** (ADR §14.2 item 4).

## 6. Cross-instance state, receipts, leaks

State is one-time and expected to reach exactly one exchange across instances because consume is a
conditional row update (§4B). Receipts are bound to tuple, key, principal and session instance by
the composite FK and re-compared in step C; they are single-use by `terminal_at`. Different keys for
one tuple need separate flows; the same subject through an alias is one owner. Conflict responses
are identical in shape for "another principal owns it" and "you hold another subject"; the 2026-10-21 owner choice requires a generic conflict without
identifying another account or the conflicting cause (§8). Errors from constraint violations are mapped to fixed statuses;
SQL error text and constraint names are never returned or logged with subjects.

## 7. Unresolved provider/CSRF details

Not invented here: ORCID PKCE support, exact redirect matching, `/authenticate` versus OIDC,
token-revocation semantics (all unverified in the preflight), and how the link-initiation request
itself is CSRF-protected (it must not be a bare GET with side effects). State/PKCE/nonce handling
is decided at preflight and the adapter must not assume support. No access or refresh token, and
no raw state, code or receipt, is stored or logged; the verifier returns only the tuple and
subject. No platform-admin bypass: administrators have no path to create, move or finalize a link.

## 8. Separate policy gaps (decisions, not defaulted)

Session revocation (logout, revoke, epoch bump) invalidates **pending flows bound to that session**
via the fence; it does **not** remove existing `identity_link` rows. Invalidating a link
assertion is a different act. The 2026-10-21 owner follow-up requires reauthentication
for link/unlink, unlink invalidation of the assertion and affected pending work,
and immediate access disablement/session revocation on deletion. It prohibits
automatic account merging and identifier transfer. The concrete invalidation
representation/adapter is not yet implemented by this proposed schema. Detailed
history retention, erasure, recovery, identifier reuse and release of uniqueness
constraints remain pending; `ON DELETE RESTRICT` prevents inventing an immediate
physical cascade while those decisions are unresolved.

## 9. Phased migration and rollback (descriptions, not migrations)

1. **P0 Review and decisions.** Independent review of this document; owner chooses §10 items.
2. **P1 Additive migration.** Create the four tables with no reader or writer. Rollback: drop the
   empty tables; once rows exist, disable via flag and keep data (dropping needs a retention
   decision).
3. **P2 Session instance.** Mint `session_instance` and a v2 cookie at sign-in behind a flag
   default off. `resolveSession` returns a binding **only** for v2 tokens. A v1 cookie resolves for
   existing pages but returns `null` to the linking path, so linking fails closed until the user has
   a bound session. Old GitHub login is unchanged until its wiring is separately reviewed.
   Rollback: stop issuing v2; v2 cookies stop resolving and users sign in again.
4. **P3 PG store adapter** implementing `IdentityLinkStore` plus the contention tests of §11,
   with a synthetic injected verifier. This is the durable component only, not full S1.
5. **P4 Mock route wiring** and **P5 live activation** are separate reviews and are **blocked**
   until the §5 release-ordering and provider-start-ordering contracts are designed and reviewed;
   P5 also needs G6 (allowlist, default-off flag, kill switch, runbook). Hosted enablement does not
   bypass G6. Full S1 remains incomplete through P3.

Privacy: purge jobs for expired/consumed flows, terminal receipts and `session_instance` rows are
built but **have no default periods and refuse to run unconfigured**; no number is chosen here (I4
pending). `identity_link.receipt_id` is `SET NULL` so receipt purge never forces link deletion;
that technical choice still needs implementation review. Real researcher ORCID iDs are personal data: until D11 (counsel/DPIA)
and the applicable G2/G3 gates, use synthetic identifiers only and store no real private content.

## 10. Policy decisions versus technical choices

**Owner session choice resolved 2026-10-21:** server-side session instances plus
epochs, seven-day maximum; see the [owner register](private-workspace-owner-decisions.md#follow-up-decisions-approved-2026-10-21).
Synthetic local/CI development is allowed without choosing retention periods;
purge refuses missing configuration.

**Owner/policy (still unresolved):** detailed retention/purge triggers, final erasure,
identifier reuse/recovery and constraint release, plus D11. Approved baseline:
reauthenticated link/unlink, unlink invalidates the assertion and pending work,
generic conflicts, manual and verified fields stay separate with verified display
preferred and mismatch explicit, no automatic merge/transfer, deletion immediately
disables access and revokes sessions. Concrete field migration and lifecycle
adapters still need implementation review.
**Technical (proposed here, for review):** `FOR SHARE` fence and lock order; `READ COMMITTED` with
`clock_timestamp()` deadline; composite-FK receipt binding; terminal receipt atomic with link;
PG-only immutability trigger; DB clock as store authority; durable-only scope with release and
provider-start ordering explicitly left to a separate design (§5); v2 cookie with fail-closed v1
for linking.

## 11. Proposed tests (real PostgreSQL, deterministic barriers, not implemented)

Use separate pooled connections per actor and named hook points in the adapter. Assert "blocked" by
polling `pg_locks` for `granted = false`, never by sleeping. Reuse the disposable-target rules of
the G1 harness; absent PostgreSQL fails, it does not skip.

- Two instances, alias keys for one tuple, same subject: one `linked`, one `conflict`/`already-
linked`; duplicate principal-per-tuple second subject ⇒ `conflict`.
- Consume replay, wrong session instance, wrong key/tuple: one `consumed`, flow untouched on
  mismatch; two instances racing one state call the verifier once.
- Deadline expires during a lock wait and during finalization: terminal `rejected`, no link.
- Finalizer-first (revoker blocks until commit; link stands) and revoker-first (finalizer sees
  `revoked_at`, no link); revocation after a preliminary unlocked read; principal delete during C.
- Per-principal cardinality, different subject: a principal holds subject A for a tuple, a second
  finalize for subject B (no row with B exists) fails the insert and classifies `conflict` via
  lookup (b), with no other-subject data in the result or logs. Also the case where the winner
  rolled back between insert and lookup ⇒ one retry, then `unavailable`.
- Ambiguity with the original finalizer in flight after nominal expiry: hold the original tx open
  past `expires_at` (barrier), run reconcile; assert via `pg_locks` that reconcile blocks on the
  receipt lock, and that after the original commits the re-read is terminal `linked` (no false
  "not linked"). Variant: original aborts ⇒ reconcile writes terminal `rejected` under lock and a
  late original finalize writes nothing. Variant: lock timeout ⇒ `unavailable`.
- Forced rollback after step 3 leaves neither link nor terminal receipt; connection loss after
  `COMMIT` reconciles to `linked` or `unavailable`, never "not linked"; reconcile paths of §4.
- No account merge, no `User.orcid` write, no cross-principal data in any result or log.
- Negative: a `FOR KEY SHARE` or `SERIALIZABLE` variant must fail the revoker-first test, proving
  the test would catch a fairy-guarantee implementation.

## 12. Implementation acceptance and gates

Do not begin P1 until: this design has independent review, §10 owner items are decided, and a
provider preflight is current. Acceptance: all §11 tests pass on real PostgreSQL in CI; the foundation
unit tests still pass unchanged; no route, OpenAPI, config or environment change; a reviewer
confirms the lock order and that §5's release and provider-start blockers remain recorded as open. Storing any real private content still
needs D11 confirmation plus G2 and G3; G1 remains not passed until independently reviewed; hosted
or live enablement needs G6. Full S1, any route result and live provider verification stay
blocked until the §5 contracts exist and are reviewed. Retention and D11 positions are unchanged. Nothing here claims verification, trustworthiness, or peer review of
any identity.

## S1 coordination follow-up (proposed reference topology)

[Protected response and provider-start coordination](identity-effect-coordination-design.md)
specifies a single service-owned egress/revocation authority, actual handoff
ordering, ambiguous commit recovery and explicit failover/transport blockers.
It also records disconnected v2 session snapshot contracts. It does not assert
that the existing deployment supplies those primitives or remove §5 activation
blockers without the specified independent review and implementation evidence.
