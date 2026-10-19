# R0 follow-up review: private-workspace security gate (#202)

- **Status:** review ledger with **PROPOSED** refinements, **pending owner ratification**.
  [ORAtlas #202](https://github.com/dhuzard/oratlas/issues/202) remains **open, awaiting the
  owner's boundary decision**. This document does not close #202 and does not claim the private
  workspace is secure, verified or fully assured.
- **Base:** `main` at `c249d61` (ADR-0001 merged by #211); focused repairs (§10) applied on
  `4140d58`.
- **Changes:** documentation, the #208 projector tests and the architecture import guard. No
  production code, schema, API, UI or dependency change.
- **Related:** [ADR-0001](./private-workspace-security-architecture.md) (§14 holds the proposals),
  [`private-research-credit.md`](./private-research-credit.md) (#208),
  [`source-credit-interop.md`](./source-credit-interop.md) (#210).

## 1. Historical decisions (unchanged)

The owner accepted ADR-0001 on 2026-10-19 and recorded D1–D11 (ADR §12). This review does not
alter them. **D11** (retention numbers and the institution = controller, ORAtlas = processor
assumption) is **provisional** until counsel and a DPIA confirm it. **D3** deferred finer
object-level ACLs; the proposals keep that deferral. Gate G0 ("decisions recorded") is met. The G0
acceptance does **not** ratify anything in ADR §14 or in this document.

## 2. Supplied state (observed by the parent session, not re-checked here)

| Item                     | State as supplied                                                                 |
| ------------------------ | --------------------------------------------------------------------------------- |
| PR #211 (ADR-0001)       | Merged; all CI checks `SUCCESS`; reviews, comments and review comments all empty. |
| Issue #202               | Open.                                                                             |
| Publication of this work | Local only. Branch push and PR creation are disabled by `.pi/autonomy.yaml`.      |

This worker made no GitHub calls; the rows above are the parent's observations.

## 3. Source observations at `c249d61`

| #   | Observation                                                                                                                                                                                                                                      | Where                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| O1  | The projector returns the strict parsed DTO or `null`. It checks owner equality first, then asks `read` and `cross-project-process` for each source **project**. Only a literal `true` continues; throws and rejections yield `null`.            | `packages/knowledge/src/private-research-credit.ts`                                  |
| O2  | The authorization callback receives `{ principalId, projectId, permission }` only: no artifact ID, version, hash, object class or `withheld` flag.                                                                                               | same                                                                                 |
| O3  | The record arrives preloaded. The projector cannot authorize before protected bytes are read.                                                                                                                                                    | same                                                                                 |
| O4  | The projector holds no state, so it keeps no cross-request cache. It has no epoch, ordering or atomicity mechanism.                                                                                                                              | same                                                                                 |
| O5  | `@oratlas/contracts` re-exports the private cross-finding and source-credit observation contracts with `export *`. `@oratlas/knowledge` re-exports the projector and the three source-credit adapters by name. Public code imports both barrels. | `packages/contracts/src/index.ts`, `packages/knowledge/src/index.ts`                 |
| O6  | No `apps/web/src` module imports a private symbol today. The one dynamic barrel access is `(await import("@oratlas/contracts")).createVerifierSchema`, a public symbol.                                                                          | `apps/web/src/lib/scientific-verification.ts`                                        |
| O7  | No private-workspace package, `/api/private/**` route, `lib/private/**` module, `private_ws` schema, RLS policy or KMS integration exists.                                                                                                       | repository tree                                                                      |
| O8  | The cross-finding credit `person` requires a non-empty `displayName` and has no `withheld` variant, while source-credit observations do have `{ kind: "withheld" }`. A withheld contributor cannot be represented in a cross-finding record.     | `packages/contracts/src/private-research-credit.ts`, `source-credit-observations.ts` |
| O9  | ADR §13 lets G2 unlock storing private content before G3 adds encryption, private audit, T-ADM, T-LOG and the backup leak check.                                                                                                                 | ADR §13                                                                              |
| O10 | ADR §8 claims a consistent snapshot sees a mid-request revocation by the final commit. A snapshot does not see a bump committed after it began.                                                                                                  | ADR §8                                                                               |
| O11 | ADR §3.2, §7 and §10 equate deleting a workspace key with erasure, including in backups. Wrapped-key copies in backups stay usable while a KEK version that wrapped them is usable.                                                              | ADR §3.2, §7, §10                                                                    |

## 4. Projector principal matrix

Evidence comes from `packages/knowledge/src/private-research-credit.test.ts` over synthetic
fixtures. "Callback" means the `authorize` function passed in by a test; no real membership,
session or storage is involved.

| Principal                    | Fixture                                    | Projector result            | Callback invoked?     | Proves                                              | Does not prove                                        |
| ---------------------------- | ------------------------------------------ | --------------------------- | --------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| Anonymous                    | principal `null`, `undefined`, `""`        | `null`                      | No                    | Fails closed without a principal                    | Session handling, HTTP status, timing                 |
| Authenticated, no membership | owner with no grants                       | `null`                      | Yes (first call only) | Fails closed when the callback denies               | That the callback reflects real membership            |
| Owner, A-only                | `user:R` with both A grants                | `null`                      | Yes                   | B grants are required                               | Exact-object or class policy (O2)                     |
| Owner, B-only                | `user:R` with both B grants                | `null`                      | Yes                   | A grants are required                               | same                                                  |
| Owner, A+B                   | `user:R` with all four grants              | Exact, unchanged strict DTO | Yes, four calls       | DTO, credit assertions, software activity unchanged | Authorization before load (O3); epochs (O4)           |
| Owner, any one grant missing | each of the four grants removed            | `null`                      | Yes                   | Each grant is independently required                | Revocation ordering against concurrent work           |
| Non-owner A+B member         | `user:Q`, callback would allow all         | `null`                      | No                    | `owner-only` is enforced before any grant           | Behaviour of any future shared-suggestion feature     |
| Revoked (later request)      | each grant removed between two calls       | First: DTO. Second: `null`  | Yes                   | No state is carried between calls                   | In-flight revocation, already-released bytes (§14.2)  |
| Platform `EDITOR`/`ADMIN`    | label `user:platform-admin`, no membership | `null`                      | No                    | A label confers nothing in the projector            | Editorial route isolation (T-PUB, T-ADM)              |
| Infra admin                  | label `user:infra-admin`, no membership    | `null`                      | No                    | Same as above, nothing more                         | **No fixture can prove ciphertext or KMS isolation.** |

Callback failure modes (sync throw, async rejection, non-boolean, string `"true"`) all yield `null`.
A test also records the exact callback requests, documenting O2.

## 5. Channel map: available versus future evidence

"Available" lists what exists in the repository today. Nothing in this column is a runtime test of
a private endpoint, because no private endpoint exists. No mocked-response harness is offered as
runtime proof.

| Channel                               | Available evidence today                                                               | Future evidence (ADR §11, §14.6)   |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| Metadata, JSON-LD, OpenGraph          | None specific. The static import guard covers only literal imports in `apps/web/src`.  | T-PUB                              |
| Counts, cursors, rank, graph topology | None.                                                                                  | T-PUB, T-GRID, T-NOINF             |
| Index and search                      | ADR F9 observation (no persistent index). No test.                                     | T-PUB; D9 amendment if ever needed |
| Exports and snapshots                 | None.                                                                                  | T-PUB                              |
| Caches and ETags                      | None.                                                                                  | T-CACHE                            |
| Provenance and credit                 | Projector tests: DTO unchanged, assertions not upgraded, software stays software (§4). | T-ATTR, T-REL, T-POL               |
| Notifications                         | None.                                                                                  | T-ATTR                             |
| Logs and audit                        | None.                                                                                  | T-LOG                              |
| Third-party lookups                   | None.                                                                                  | T-ATTR, T-LLM                      |
| Timing                                | None. The projector returns early on owner mismatch, so it is not constant-work.       | T-TIME                             |
| Import reachability                   | Bounded static guard (§6).                                                             | T-IMP (complete), T-ROLE           |
| Revocation and in-flight work         | Projector "subsequent request" tests only.                                             | T-REV, T-MID (§14.2)               |
| Database, RLS, KMS, backups, erasure  | None.                                                                                  | T-ROLE, T-RLS, T-ADM, T-ERASE      |

## 6. Static import guard: scope and limits

`scripts/architecture-boundaries.test.ts` now parses every non-test source file under
`apps/web/src`, outside the future `lib/private/**` and `app/api/private/**` namespaces, and fails if
it:

- imports a private module directly: the projector, the source-credit adapters, the private
  cross-finding and source-credit observation contracts, the future `@oratlas/private-workspace`
  package or the future app-local private namespace. Relative `.js` paths, root `packages/…` and
  `apps/…` paths, `@/` and `@oratlas/<pkg>/<subpath>` specifiers are normalized;
- selects a private name from `@oratlas/contracts` or `@oratlas/knowledge`, including aliased,
  type-only and re-exported names. The private names are derived from the barrels' own source;
- accesses a barrel opaquely: namespace, star, default or import-equals forms, or a dynamic
  `import()` or `require()` whose selected names cannot be proven from the syntax. The specifier is
  read from the first argument, so `import(x, options)` and extra `require` arguments do not hide
  it;
- reaches a known barrel by another path: relative, root `packages/…`, `@oratlas/<pkg>/src/index`,
  `@oratlas/<pkg>/index`, the `src` directory or the package root all canonicalize to the same
  barrel, and the same name rules apply.

In-memory fixtures cover positive and negative cases, including comments, strings and look-alike
paths.

Limits: path canonicalization is bounded to the two known barrels (`@oratlas/contracts` and
`@oratlas/knowledge`); it is not general module resolution (no tsconfig `paths`, symlinks or
package `exports` maps). It does not see computed specifiers, private values re-exported under another name through
a new barrel or app module, runtime data flow or database credentials. It is a precursor to T-IMP,
not T-IMP and not proof that a public endpoint cannot reach private data.

## 7. Executed checks

Run in this worktree at base `c249d61` plus the five changed files. Long logs are in
`/tmp/r0-202-*.log`.

`pnpm` is not installed on the review machine, so commands ran as `corepack pnpm …` (pnpm
10.33.0). Some scripts spawn a bare `pnpm`, so the second pass prepended a temporary directory to
`PATH` with a `pnpm` wrapper that runs `exec corepack pnpm "$@"`. No global shim or install was
changed.

| Command                                                                                       | Result                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm install --frozen-lockfile`                                                     | Pass; lockfile unchanged.                                                                                                                                                                                                           |
| `corepack pnpm --filter @oratlas/db db:generate`                                              | Pass (ignored `packages/db/generated/`). No database was reset or seeded.                                                                                                                                                           |
| `vitest run` on the projector, private contract, source-credit adapter and architecture tests | Pass: 4 files, 116 tests (projector 22, contract 7, adapters 39, architecture 48).                                                                                                                                                  |
| `corepack pnpm lint`                                                                          | Pass.                                                                                                                                                                                                                               |
| `corepack pnpm format:check`                                                                  | Pass.                                                                                                                                                                                                                               |
| `corepack pnpm typecheck`                                                                     | First pass failed: `sh: 1: pnpm: not found` (the script runs `pnpm -r`). With the wrapper: pass.                                                                                                                                    |
| `corepack pnpm test`                                                                          | First pass failed only where tests spawn bare `pnpm`: `spawnSync pnpm ENOENT` in two db integration tests and exit 127 in `scripts/eval-grounding.test.ts`. With the wrapper: pass, 235 files (6 skipped), 1610 tests (16 skipped). |
| `corepack pnpm schema:check`                                                                  | Pass.                                                                                                                                                                                                                               |
| `corepack pnpm openapi:check`                                                                 | Pass.                                                                                                                                                                                                                               |
| `corepack pnpm --filter @oratlas/web build`                                                   | First pass failed: `NEXT_PUBLIC_BASE_URL is required in production` (no env). With CI's build env (`SESSION_SECRET`, `NEXT_PUBLIC_BASE_URL=https://ci.oratlas.example`): pass.                                                      |

Not run: `test:e2e` (no application code changed, and it needs a seeded database); any Postgres,
RLS, KMS, endpoint or timing test, because none exists (RR10).

## 8. Residual risk register

| ID   | Risk                                                                                                                                        | Current mitigation                                     | Next control                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| RR1  | Revocation races a concurrent read, job or provider call; a snapshot alone does not order them.                                             | None at runtime; the projector rechecks per call only. | §14.2 fenced finalization; T-MID; streaming spec |
| RR2  | Wrapped DEK copies in backups, replicas or recovery material keep "deleted" data decryptable; derived suggestions lack their own key.       | None.                                                  | §14.3; T-ERASE; wrapping decision before G5      |
| RR3  | Anyone able to deploy code or change KMS/IAM bindings can obtain plaintext.                                                                 | Stated as an honest limit (ADR §7).                    | Organizational controls; break-glass (D7)        |
| RR4  | Ciphertext and opaque IDs leak sizes, volumes, timing, access patterns and ID linkage to database and backup administrators.                | None.                                                  | Metadata minimization; T-ADM scope (§14.5)       |
| RR5  | The static guard misses computed imports, laundering barrels or aliases, and data flow.                                                     | Bounded guard (§6).                                    | Private package + T-IMP, T-ROLE                  |
| RR6  | The projector receives a preloaded DTO and a project-only callback, so it cannot enforce load-time, exact-object, class or withheld policy. | Documented boundary (`private-research-credit.md`).    | Private service per §14.4; T-POL                 |
| RR7  | Withheld contributors are not representable in a cross-finding record (O8).                                                                 | None.                                                  | Contract decision before #207 work               |
| RR8  | Credit assertions are not consent; no consent or dispute workflow exists.                                                                   | Assertions stay `proposed`/source-declared.            | #203, #207; T-REL                                |
| RR9  | Retention and controller/processor roles are provisional (D11); no DPIA yet.                                                                | G2 requires counsel and DPIA.                          | Counsel, DPIA                                    |
| RR10 | No private endpoint, Postgres role split, RLS, KMS or timing test exists, so none of those properties has evidence.                         | Feature does not exist.                                | G1–G6                                            |

## 9. Owner ratification checklist

None of these is decided. Each item needs an explicit owner decision.

- [ ] §14.1: G2 alone unlocks synthetic fixtures only; real private content requires G2 **and** G3.
- [ ] §14.2: fenced, service-owned finalization; revised T-MID; separate streaming specification.
- [ ] §14.3: erasure-claim conditions; independently erasable derived-record keys; choice of
      wrapping and recovery dependencies before G5.
- [ ] §14.4: authorization precedence, keeping the D3 deferral of object-level ACLs.
- [ ] §14.5: evidence wording and the two operator classes.
- [ ] §14.6: test-matrix changes (T-MID, T-ADM scope, T-ERASE, T-POL, T-GATE).
- [ ] Interim rule: follow the stricter of the original text and §14 until ruled.
- [ ] RR7: how withheld contributors are represented (or excluded) in cross-finding records.
- [ ] D11: counsel confirmation and DPIA before any real private data.
- [ ] Future evidence plan: G1 harness (T-IMP, T-ROLE, T-PUB) before any `private_ws` table.
- [ ] Whether #202 can close, and on which evidence.

## 10. Focused repairs after independent review

An independent reviewer reported three findings against the first follow-up. Each is repaired
without production code changes.

| #   | Kind        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                      | Repair                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Correctness | ADR §14.2 offered `SELECT … FOR SHARE`, an epoch predicate or `SERIALIZABLE` retries as fenced-finalization examples. `SERIALIZABLE` alone does not order a finalizer that read the old epoch against a revoker that commits afterwards: the history stays serializable as finalizer-then-revoker while the derived write or response leaves after the revocation. A predicate that only reads another row has the same gap. | The examples are removed. The proposal now requires a shared, conflicting fence or lock covering the actual finalization boundary (persistence, response release, job effects), distinguishes serialization order from real commit or release order, and leaves deterministic interleaving tests (T-MID) to later work. Still **proposed, pending owner approval**; bytes already transmitted stay unrecallable; no protocol is implemented. |
| 2   | Test gap    | The guard accepted only calls with exactly one argument, so `import("@/lib/private/store", {})` and `import("@oratlas/knowledge", {}).then(…)` escaped.                                                                                                                                                                                                                                                                      | The first literal argument is inspected whatever follows. Fixtures cover direct private, opaque barrel, selected private and member access with options, `require` with extra arguments, and a public selected import with options.                                                                                                                                                                                                          |
| 3   | Test gap    | The barrel lookup keyed on the exact specifier, so relative, root or `src/index` paths to an existing barrel returned no violation.                                                                                                                                                                                                                                                                                          | Specifiers canonicalize to the known barrels (bounded, see §6 limits). Fixtures cover named, aliased, type-only, re-export, star, namespace and dynamic forms through those paths, plus public named imports through the same paths.                                                                                                                                                                                                         |

Related wording fixes in ADR-0001: §14.3 said wrapped copies stay "unwrappable"; it now says
"decryptable" for as long as a KEK version that wrapped them is usable (the meaning is unchanged).
The §7 cross-reference now says "either every key-encryption key version or every wrapped-key copy",
matching §14.3 rule 1. Both remain proposals pending ratification.

### Checks for these repairs

Run on `4140d58` plus the three changed files, with `PATH=/tmp/r0-202-pnpm-shim:$PATH` for the
`pnpm` wrapper. Logs are `/tmp/r0-202-focused-*.log`. The §7 table above is historical first-pass
evidence for the earlier five-file state and is not restated as current.

| Command                                                                                                                                                                                                                                                   | Result                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `corepack pnpm install --frozen-lockfile`; `corepack pnpm --filter @oratlas/db db:generate`                                                                                                                                                               | Pass; lockfile unchanged; no database reset.                                                     |
| `corepack pnpm exec vitest run` on `packages/knowledge/src/private-research-credit.test.ts`, `packages/contracts/src/private-research-credit.test.ts`, `packages/knowledge/src/source-credit-adapters.test.ts`, `scripts/architecture-boundaries.test.ts` | Pass: 4 files, 134 tests (projector 22, contract 7, adapters 39, architecture 66).               |
| `corepack pnpm lint`; `corepack pnpm format:check`; `corepack pnpm typecheck`                                                                                                                                                                             | Each exits 0.                                                                                    |
| `corepack pnpm test`                                                                                                                                                                                                                                      | Pass: 235 files (6 skipped), 1628 tests (16 skipped); +18 over the first pass, all in the guard. |

Not re-run for this repair: `schema:check`, `openapi:check`, `web build` and `test:e2e` (no code,
schema or API change).
