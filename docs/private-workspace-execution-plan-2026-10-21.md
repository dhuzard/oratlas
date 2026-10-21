# Private-workspace execution plan — 2026-10-21

Initial baseline: `154b399235c3320b3080ce54066434b52d2d0eb4`; implementation checkpoint
`9ed83ed391c7415ee58db5aabde804923167ff1d` after #225–#229. This plan tracks the requested
#202 → #203/#204 → #206 → #205 dependencies against actual code and the ratified
owner decision register. It does not redefine the ADR's G1–G6 gates.

| Issue                                                 | Current evidence                                                                                                                                                                | Implementation in this wave                                                                                                                                 | Remaining acceptance                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#202](https://github.com/dhuzard/oratlas/issues/202) | Closed; security architecture and owner refinements recorded.                                                                                                                   | Preserve the public/private boundary and test it in every slice.                                                                                            | Gate completion needs executable evidence; D11 remains provisional.                                                                                                                   |
| [#203](https://github.com/dhuzard/oratlas/issues/203) | Unconnected link orchestrator and proposed S1 durable design; #225 added checksum/recognition; #229 adds disconnected v2 instance validation and reference effect coordination. | Checksum validation before profile writes; injected, synthetic public-record recognition with explicit unverified/inconclusive results.                     | Reviewed provider contract, session-instance implementation and durable/effect fences, detailed retention/recovery policy, live callback and researcher directory.                    |
| [#204](https://github.com/dhuzard/oratlas/issues/204) | Partial G1-empty PostgreSQL roles; expanded 895-record program exercises 56/133 files and 57/143 methods.                                                                       | Expand public read/export/scholarly/editorial captures with native source fixtures, exact denial/state/audit assertions, and typed cursor error regression. | Remaining public/non-HTTP surfaces, independently accepted G1, then G2 synthetic workspace authority/invitations/revocation and G3 protection.                                        |
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

| Order                          | Delivery                              | Required exit evidence                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                              | G1 public boundary coverage           | Inventory every exported route method and principal case; real handler fixtures, rendered pages/metadata and non-HTTP channels; reviewed independent captures, least-privilege database role tests and unchanged public contracts. No private tables until complete G1 acceptance.  |
| 2 (design can run alongside 1) | Sessions and finalization             | Reviewed session-instance, epoch, lifecycle, protected-response release and provider-start contracts. Then durable adapters with real multi-connection PostgreSQL replay, rollback, expiry and revocation races. No live provider or protected HTTP wiring before its own evidence. |
| 3                              | G2 synthetic workspace authority      | Separate storage/client/credentials; explicit controller membership and invitations; independent read/process/export/release capabilities; RLS and revocation/finalization evidence under populated A/B principals.                                                                 |
| 4                              | G3 protection, then source connectors | Key and backup threat model, private audit and bounded erasure claims; exact artifact/version/hash source entitlements, replay/expiry/revocation and two-producer contract acceptance.                                                                                              |
| 5                              | Personal discovery and disclosure     | Principal-owned deterministic candidates with exact two-source provenance and #207 credit. Concurrent-principal isolation, revoked saved-output denial and separate approval from every private origin before disclosure.                                                           |

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

## Current next implementation boundary

#228 records approved policy and method obligations; #229 delivers only unused
session validation plus a reviewed reference topology. No runtime session store
or effect coordinator is present. The expanded G1 batch has independent module
reviews and real restricted-role capture evidence, but does not complete G1.
Next: remaining 86 methods (mostly mutation/provider/worker workflows), a real
Next serving/HTML/metadata capture stage, then separately scoped non-HTTP/timing
evidence and independent complete-gate acceptance. G1 still precedes private
tables. No further owner decision is needed to continue this synthetic work.
