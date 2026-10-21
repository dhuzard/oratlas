# Private-workspace execution plan — 2026-10-21

Baseline: `154b399235c3320b3080ce54066434b52d2d0eb4`. This plan tracks the requested
#202 → #203/#204 → #206 → #205 dependencies against actual code and the ratified
owner decision register. It does not redefine the ADR's G1–G6 gates.

| Issue                                                 | Current evidence                                                                                          | Implementation in this wave                                                                                                                                                           | Remaining acceptance                                                                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#202](https://github.com/dhuzard/oratlas/issues/202) | Closed; security architecture and owner refinements recorded.                                             | Preserve the public/private boundary and test it in every slice.                                                                                                                      | Gate completion needs executable evidence; D11 remains provisional.                                                                                                                   |
| [#203](https://github.com/dhuzard/oratlas/issues/203) | Unconnected link orchestrator and proposed S1 durable design; existing manual route validates only shape. | Checksum validation before profile writes; injected, synthetic public-record recognition with explicit unverified/inconclusive results.                                               | Real provider contract, session-instance decision, durable fences, lifecycle/retention decisions, live callback and researcher directory.                                             |
| [#204](https://github.com/dhuzard/oratlas/issues/204) | Partial G1-empty PostgreSQL roles, synthetic public principals and route snapshots.                       | Extend real-handler captures to public artifact metadata, packets and protected preserved-file denials across all six principals, repeated reset-based runs and exact-byte exclusion. | Remaining public/non-HTTP surfaces, independently accepted G1, then G2 synthetic workspace authority/invitations/revocation and G3 protection.                                        |
| [#206](https://github.com/dhuzard/oratlas/issues/206) | Source-credit adapters exist; CRT has an offline project descriptor; live source grants do not exist.     | Closed private descriptor observations, pinned real CRT fixture/adapter and explicitly synthetic Diggypaper fixture, no access effect.                                                | Principal-scoped source grant verification, registry integration, expiry/replay/revocation, secure source retrieval and protected result release.                                     |
| [#205](https://github.com/dhuzard/oratlas/issues/205) | Owner-only credit projection exists; it is not an authorization service.                                  | Preserve its dependency boundary; do not duplicate its project-level callback or activate discovery routes early.                                                                     | Exact object/source permissions and processing consent, fenced finalization, private persistence and revocation, then deterministic candidates and #207 credit/disclosure acceptance. |

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

## Open policy and engineering decisions

The current S1 design explicitly leaves session table versus epoch-only binding,
retention/deletion/reuse, and verified-versus-legacy profile mapping open. The
local single-process effect-ordering fixture is not a distributed finalization
fence. A real design still needs protected-response and provider-exchange-start
ordering across separate connections/processes. Preserve the approved narrowing
policy: identifier control, authorship and institutional/operator roles grant no
workspace access.

Authoritative references: [owner register](private-workspace-owner-decisions.md),
[S1 design](identity-persistence-session-design.md),
[G1 evidence](private-workspace-g1-harness.md),
[descriptor observations](private-project-descriptor-observations.md).
