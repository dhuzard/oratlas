# Private-workspace execution plan — 2026-10-21

Initial baseline: `154b399235c3320b3080ce54066434b52d2d0eb4`; implementation checkpoint
`8eb0a36c277cf4d08b9dd3f2ff0588d1f78391d0` after #225–#235. This plan tracks the requested
#202 → #203/#204 → #206 → #205 dependencies against actual code and the ratified
owner decision register. It does not redefine the ADR's G1–G6 gates.

| Issue                                                 | Current evidence                                                                                                                                                                | Implementation in this wave                                                                                                                                 | Remaining acceptance                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#202](https://github.com/dhuzard/oratlas/issues/202) | Closed; security architecture and owner refinements recorded.                                                                                                                   | Preserve the public/private boundary and test it in every slice.                                                                                            | Gate completion needs executable evidence; D11 remains provisional.                                                                                                                   |
| [#203](https://github.com/dhuzard/oratlas/issues/203) | Unconnected link orchestrator and proposed S1 durable design; #225 added checksum/recognition; #229 adds disconnected v2 instance validation and reference effect coordination. | Checksum validation before profile writes; injected, synthetic public-record recognition with explicit unverified/inconclusive results.                     | Reviewed provider contract, session-instance implementation and durable/effect fences, detailed retention/recovery policy, live callback and researcher directory.                    |
| [#204](https://github.com/dhuzard/oratlas/issues/204) | Partial G1-empty PostgreSQL roles; six isolated programs declare 2,092 records, 81/133 files and 86/143 methods; real public-index captures remain separate.                    | Expand public read/export/scholarly/editorial captures with native source fixtures, exact denial/state/audit assertions, and typed cursor error regression. | Remaining public/non-HTTP surfaces, independently accepted G1, then G2 synthetic workspace authority/invitations/revocation and G3 protection.                                        |
| [#206](https://github.com/dhuzard/oratlas/issues/206) | Source-credit and pinned CRT descriptor adapters exist after #226; live source grants do not exist.                                                                             | Closed private descriptor observations, pinned real CRT fixture/adapter and explicitly synthetic Diggypaper fixture, no access effect.                      | Principal-scoped source grant verification, registry integration, expiry/replay/revocation, secure source retrieval and protected result release.                                     |
| [#205](https://github.com/dhuzard/oratlas/issues/205) | Owner-only credit projection exists; it is not an authorization service.                                                                                                        | Preserve its dependency boundary; do not duplicate its project-level callback or activate discovery routes early.                                           | Exact object/source permissions and processing consent, fenced finalization, private persistence and revocation, then deterministic candidates and #207 credit/disclosure acceptance. |

## Sequence and validation

The three bounded code slices are independent at this baseline and use isolated
branches. Each needs targeted negative/regression tests, independent review and
green required CI. Merge sequentially, update each branch to current main, and
rerun required checks before its merge. Issue closure requires its full acceptance,
not the presence of a partial implementation PR.

The next security-critical work is G1 completion and the reviewed S1 contracts,
not a private route over the public database. Once those prerequisites are met,
build a separate synthetic workspace store and source-entitlement boundary, then
two-producer connector acceptance, and finally personal candidate discovery.
Real private research and external testing keep their existing G2/G3, D11 and
hosted-enablement conditions. No live provider, private data or deployment is
enabled by this wave.

## Follow-up approved 2026-10-21

The owner approved server-side session instances plus epochs (seven-day maximum),
the explicit identity lifecycle, and local/CI synthetic-only development. See the
[decision record](private-workspace-owner-decisions.md#follow-up-decisions-approved-2026-10-21).
Do not ask again for these choices. Retention periods remain unconfigured; no
live provider, external tester, real private data or deployment is authorized.

| Order                          | Delivery                              | Required exit evidence                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                              | G1 public boundary coverage           | Inventory exported public route methods, principal cases and rendered pages/metadata; reviewed independent captures, least-privilege database role tests and unchanged public contracts. Track standalone operational and timing channels at their applicable later gates. No private tables until complete G1 acceptance. |
| 2 (design can run alongside 1) | Sessions and finalization             | Reviewed session-instance, epoch, lifecycle, protected-response release and provider-start contracts. Then durable adapters with real multi-connection PostgreSQL replay, rollback, expiry and revocation races. No live provider or protected HTTP wiring before its own evidence.                                        |
| 3                              | G2 synthetic workspace authority      | Separate storage/client/credentials; explicit controller membership and invitations; independent read/process/export/release capabilities; RLS and revocation/finalization evidence under populated A/B principals.                                                                                                        |
| 4                              | G3 protection, then source connectors | Key and backup threat model, private audit and bounded erasure claims; exact artifact/version/hash source entitlements, replay/expiry/revocation and two-producer contract acceptance.                                                                                                                                     |
| 5                              | Personal discovery and disclosure     | Principal-owned deterministic candidates with exact two-source provenance and #207 credit. Concurrent-principal isolation, revoked saved-output denial and separate approval from every private origin before disclosure.                                                                                                  |

Each delivery is independently reviewed, updated to current main and merged only
with green required CI. Preserve the gate names and identify partial evidence
explicitly; neither a fixture count nor an owner decision passes a gate.

## Remaining policy and engineering decisions

The session-instance choice and baseline display/lifecycle behavior are now
approved. Detailed retention/erasure/reuse policy and real-data readiness remain
open; synthetic development does not select those policies. The
local single-process effect-ordering fixture is not a distributed finalization
fence. A real design still needs protected-response and provider-exchange-start
ordering across separate connections/processes. Preserve the approved narrowing
policy: identifier control, authorship and institutional/operator roles grant no
workspace access.

Authoritative references: [owner register](private-workspace-owner-decisions.md),
[S1 design](identity-persistence-session-design.md),
[G1 evidence](private-workspace-g1-harness.md),
[descriptor observations](private-project-descriptor-observations.md).

### Gate interpretation correction — 2026-10-21

Earlier wording in this plan treated completion of operational and timing channels
as additional G1 prerequisites. That overstated [ADR §13](private-workspace-security-architecture.md#13-rollout-gates-and-migration-consequences)
and the [existing T-PUB specification](private-workspace-g1-harness.md#t-pub-deterministic-public-contract-harness),
which explicitly tracks non-HTTP and timing evidence separately. Applicable T-LOG,
private-audit and backup evidence belongs to G3; T-TIME belongs to G4. This correction
follows the existing gate definitions and leaves those later obligations unproved.

G1 acceptance still requires independently reviewed evidence for:

- T-IMP public/private import boundaries and the `private, no-store` helper in CI.
- T-ROLE exact restricted identities/grants and empty inaccessible private-schema
  posture, with successful cleanup; populated table/RLS tests remain later.
- T-PUB declared public methods/principals and rendered public contracts against
  identical deterministic seeds/inputs before and after empty-schema provisioning,
  with strict raw response/header comparisons and reviewed goldens in CI.
- An explicit inventory of remaining gaps and independent complete-G1 acceptance.
  Partial method counts, fixtures, owner approvals or auxiliary probes do not pass it.

The same specification permits fixed clocks/IDs and mocked external services. Any
new fixed-input fixture must have its own narrow source/native review, preserve
actual database guards and raw response/state evidence, and state what production
generation behavior it does not test. It must not silently exclude business fields
or widen the existing Date/request-ID header normalization.

## Current next implementation boundary

#228 records approved policy and method obligations; #229 delivers only unused
session validation plus a reviewed reference topology. No runtime session store
or effect coordinator is present. The expanded G1 batches have independent module
reviews and real restricted-role capture evidence, but do not complete G1.
Next: remaining 57 methods (mostly mutation/provider/worker workflows), a real
Next serving/HTML/metadata capture stage and independent G1 acceptance. Separately
track operational and timing evidence against their applicable later gates. The
[real-serving prototype](private-workspace-next-http-prototype.md) observes exact
metadata responses across fresh processes and preserves HTML nonce variance. It
is not yet part of the before/after database lifecycle, and neither its HTML
variance characterization nor its historical build evidence closes that gap.
G1 still precedes private tables. No further owner decision is needed to continue
this synthetic work.

### G1 completion and separately tracked work packages

1. Complete remaining public reads with populated, natively valid protocol,
   verification, certification and execution fixtures, including hidden-container
   and missing-object controls for every principal.
2. Cover mutation and worker/provider methods using their actual authority types.
   User-cookie denial is only denial evidence for a worker endpoint. Success needs
   a valid worker credential or an injected provider boundary, explicit state and
   audit assertions, replay/idempotence controls, and no real external exchange.
3. Integrate an attested production build and fresh real-server captures into each
   reset before/after run. Include rendered HTML, RSC and metadata without stripping
   security headers or rewriting response bodies. Any controlled entropy fixture
   requires separate review and unhooked controls; it cannot prove production nonce
   unpredictability or quietly replace real-entropy observations.
4. Separately inventory and test operational channels against actual entrypoints: jobs and
   CLIs, indexes, backup/restore, logs/audit/metrics, notification delivery and
   outbound lookups. Record unavailable or untested channels as gaps rather than
   treating an absent HTTP response as isolation evidence. ADR §13 places applicable
   T-LOG/private-audit/backup evidence at G3 and T-TIME at G4. Timing needs a stated
   experimental design and bounded claims, not exact wall-clock snapshots.
5. Reconcile the public method/principal/rendered inventory with the evidence,
   repeat restricted-role captures and cleanup, and obtain independent complete
   G1 acceptance. Only then begin private tables and durable session/workspace
   adapters. Keep later populated-role, G2/G3 and real-data gates separate.

Merged #234 keeps the previous 1,165 records unchanged, adds twelve
provider-disabled OAuth cases, and separately resets worker reads (270), known
notification/comment operations (62) and accepted synthesis/discovery reads
(108). Merged #235 adds 96 native deterministic Discuss and federation POST
requests with its own fixture reset, complete unchanged public state and reviewed
golden. Its four-label run exposed a native Discuss database-order dependency;
the selector now preserves verified signed scope order, with a regression and
independent review. The next worker artifact batch adds 379 native requests over
four methods, one existing uploaded-artifact completion and explicit credential
stamp deltas, with only two additional column UPDATE grants. All 86 declared
methods have six user/session cases; worker
authority is explicitly separate from those cookies. Native worker claim history
and real source packet bytes have independent review. The remaining public methods,
rendered Next responses and unaccepted public contracts still prevent G1 closure.
Operational and timing obligations remain separately tracked at their applicable
later gates. Separate production-log prototypes and a metadata-only
Next entropy observer are under development; none yet supplies gate acceptance.
The 24-request fresh-comment-removal observation preserves native timestamp/audit-ID
variation and supplies no strict-equality waiver.

No further owner answer is needed for this synthetic work. The approved session
instance/epoch and identity lifecycle policies are already recorded. Detailed
retention/recovery and erasure/reuse choices, privacy/legal readiness and live
provider activation remain later decisions; development does not choose them
implicitly. G2 authorization/revocation, source connectors and personal discovery
retain the exit evidence and order above.
