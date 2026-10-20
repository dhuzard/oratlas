# Identity persistence and session-instance design (S1)

**Status: PROPOSED technical design, pending independent review and owner policy choices.** It is
not owner-approved schema, not implemented, and not reviewed. The owner approved I1, I2, I3 and
ADR §14/§15 on 2026-10-20 and _commissioned_ this design (S1); commissioning is not approval of
anything below. D11 stays provisional; I4 retention and identifier-reuse details are pending. The
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
principal and cannot name one session). This is a proposal for review, **not** a claim that D5
adopted a session table; an alternative is epoch-only (one `user.authz_epoch`/generation, kill all
sessions, no per-session binding), which cannot satisfy `sessionBinding` as written.

| Column                          | Constraint / note                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `id`                            | PK, ≥128-bit CSPRNG opaque, URL-safe. This is `sessionBinding`.                         |
| `user_id`                       | FK `User.id`, `ON DELETE RESTRICT`, NOT NULL                                            |
| `authz_epoch_at_issue`          | integer; valid only while equal to the principal's current epoch (once that exists)     |
| `issued_at`, `expires_at`       | timestamptz NOT NULL; `expires_at > issued_at`                                          |
| `revoked_at`, `revoked_by_kind` | nullable; `revoked_at` written once (trigger or conditional `UPDATE … WHERE … IS NULL`) |

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

**Step A: `begin` (`insertFresh`).** One tx: lock principal and session `FOR SHARE`; require
session not revoked, `expires_at > clock_timestamp()`; `INSERT` flow, treat `23505` on
`state_digest` as `collision`. Flow `expires_at = min(issued + flowTtl, session.expires_at)`.

**Step B: consume, then exchange.** One short tx: take the same locks; one conditional statement:
`UPDATE identity_link_flow SET consumed_at = clock_timestamp() WHERE state_digest = $d AND
namespace_key/tuple/principal/session all equal AND consumed_at IS NULL AND expires_at >
clock_timestamp() RETURNING …`; zero rows ⇒ `rejected` and nothing changes. In the same tx insert
the receipt. Commit. Single use is the row transition, not an in-process check, so two instances
racing one `state` yield exactly one `consumed`. **The provider exchange runs after this commit,
outside any transaction, holding no DB lock.** A crash after consume burns the state (user
restarts); the design never "un-consumes".

**Step C: finalize.** One bounded tx, after the exchange:

1. Lock principal then session `FOR SHARE`; re-read both under the lock (a read taken before is
   never trusted). Missing/deleted principal, `revoked_at` set, or expired ⇒ write terminal
   `rejected`, commit, return `denied`.
2. `SELECT … FROM identity_link_receipt WHERE receipt_digest = $r FOR UPDATE`; require
   unterminated, with key, tuple, principal and session equal to the request; assertion tuple equals
   the receipt's tuple (the verified subject is accepted only for the bound tuple).
3. `INSERT INTO identity_link … ON CONFLICT DO NOTHING RETURNING id` (no conflict target, so it
   covers both unique constraints). A concurrent inserter of the same keys makes this statement
   wait for its commit/abort; afterwards the winner is visible to the next statement.
4. No row returned ⇒ classify with a follow-up `SELECT` on the tuple+subject: same principal ⇒
   `already-linked`; other principal or another subject held by this principal ⇒ `conflict`.
   Classification output never contains the other principal or subject.
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
`unavailable`, never "not linked". Reconcile in a new tx by `receipt_digest` (the finalizing
request still holds the raw receipt): terminal `linked`/`already-linked` ⇒ report that;
terminal `rejected`/`conflict` ⇒ report that; unterminated and past `expires_at` ⇒ safe to report
"not linked, restart" (the receipt can no longer finalize); unterminated and unexpired ⇒ stay
`unavailable` and retry the idempotent finalize (single-use receipt makes retry safe). Without the
receipt, a fresh authenticated session reads its own link for the tuple; a present matching
link is reported as `already-linked`.

**Deletion, rollback, races.** A principal that no longer exists at step C ⇒ `denied`, nothing
written. A delete attempted during C waits behind the `FOR SHARE` lock; since `ON DELETE RESTRICT`
applies while sessions, flows or links reference the principal, account deletion needs its own
lifecycle (§8). A failure in steps 3-6 rolls back the link and terminal receipt together, so they
cannot disagree. Uniqueness races (two principals, two aliases, one subject) are decided by the
unique indexes, not by lookup-then-insert.

## 5. DB durability versus HTTP release

The fence above orders the **durable identity effect** against revocation. It cannot hold a DB lock
across response bytes: after `COMMIT` the lock is gone, and any later revocation cannot recall
bytes already handed to the network. This design makes **no universal post-revocation recall
guarantee** (ADR §14.2 item 4).

Chosen scope: this document covers **identity durable finalization only**. It defines no release
coordinator extending the fence until response hand-off. Until a separate response-release design
exists, the `complete` route response is suppressed to a minimal status with no subject, link row,
other-account information or receipt, and the caller re-reads link state through a freshly
authenticated, `private, no-store` request. If a later design adds a coordinator, it must hold a
conflicting fence until response hand-off and is out of scope here.

**Provider call.** The code exchange is an outbound effect on the identity provider, carrying the
code and no workspace content. Revoking the session fences its _start_ (consume, Step B) and the
durable result (Step C), not an exchange already in flight. Ownership proof is not a workspace
processing permission: if any future flow sent workspace-derived data to a provider, that start
would need its own grant-revocation fence and is not authorised by a link.

## 6. Cross-instance state, receipts, leaks

State is one-time and expected to reach exactly one exchange across instances because consume is a
conditional row update (§4B). Receipts are bound to tuple, key, principal and session instance by
the composite FK and re-compared in step C; they are single-use by `terminal_at`. Different keys for
one tuple need separate flows; the same subject through an alias is one owner. Conflict responses
are identical in shape for "another principal owns it" and "you hold another subject"; whether
telling a caller that a subject they just proved they control is already linked elsewhere is
acceptable is a policy item (§8). Errors from constraint violations are mapped to fixed statuses;
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
assertion is a different act and is unspecified: unlink, account deletion, identifier reuse after
unlink or deletion, history retention, and whether the unique constraints release on those events
are I3/I4 details still pending. Until decided, the schema has no unlink path and `ON DELETE
RESTRICT` applies; the system fails closed rather than silently activating or reassigning.
No automatic account merge ever occurs.

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
4. **P3 PG store adapter** implementing `IdentityLinkStore` plus the contention tests of §11.
5. **P4 Mock route wiring** and **P5 live activation** are separate reviews; P5 needs G6
   (allowlist, default-off flag, kill switch, runbook). Hosted enablement does not bypass G6.

Privacy: purge jobs for expired/consumed flows, terminal receipts and `session_instance` rows are
built but **have no default periods and refuse to run unconfigured**; no number is chosen here (I4
pending). `identity_link.receipt_id` is `SET NULL` so receipt purge never forces link deletion;
that choice is itself flagged. Real researcher ORCID iDs are personal data: until D11 (counsel/DPIA)
and the applicable G2/G3 gates, use synthetic identifiers only and store no real private content.

## 10. Policy decisions versus technical choices

**Owner/policy (unresolved):** session table versus epoch-only; retention periods and purge
triggers; unlink/deletion/identifier-reuse and constraint release; whether to disclose "already
linked elsewhere"; relationship of verified links to `User.orcid`/`orcidVerifiedAt`; D11.
**Technical (proposed here, for review):** `FOR SHARE` fence and lock order; `READ COMMITTED` with
`clock_timestamp()` deadline; composite-FK receipt binding; terminal receipt atomic with link;
PG-only immutability trigger; DB clock as store authority; identity-durable scope with suppressed
response; v2 cookie with fail-closed v1 for linking.

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
- Forced rollback after step 3 leaves neither link nor terminal receipt; connection loss after
  `COMMIT` reconciles to `linked` or `unavailable`, never "not linked"; reconcile paths of §4.
- No account merge, no `User.orcid` write, no cross-principal data in any result or log.
- Negative: a `FOR KEY SHARE` or `SERIALIZABLE` variant must fail the revoker-first test, proving
  the test would catch a fairy-guarantee implementation.

## 12. Implementation acceptance and gates

Do not begin P1 until: this design has independent review, §10 owner items are decided, and a
provider preflight is current. Acceptance: all §11 tests pass on real PostgreSQL in CI; the foundation
unit tests still pass unchanged; no route, OpenAPI, config or environment change; a reviewer
confirms the lock order and the response-suppression scope. Storing any real private content still
needs D11 confirmation plus G2 and G3; G1 remains not passed until independently reviewed; hosted
or live enablement needs G6. Nothing here claims verification, trustworthiness, or peer review of
any identity.
