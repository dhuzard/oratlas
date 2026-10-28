# Run 2 exact-claim comparison fixture

The home example resolves two **synthetic** accepted review claims by review slug and source-local claim ID, then writes their exact review-version IDs into the comparison URL. The copied URL contains exact occurrence references; it does not keep resolving a moving “latest” alias.

| Side | Source-local fixture                                    | Declared scope                        | Recorded evidence direction                            |
| ---- | ------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| A    | `hippocampal-replay-computational-review` / `claim-001` | rodent hippocampus; electrophysiology | `supports` the source-local `ref-wilson1994`           |
| B    | `cortical-oscillations-attention-review` / `claim-003`  | human cortex; intracranial EEG        | `contradicts` the source-local `ref-wilson1994-shared` |

Both citations declare the same example DOI, `10.5555/oratlas.example.wilson1994`. That is **source reuse**, not independent corroboration or proof that the two claims scientifically contradict one another. The claims have different text, declared populations and methods. The DOI uses a reserved example prefix and is displayed as text, never as an outbound DOI link. The example is unavailable when either exact public claim cannot be resolved; it does not substitute a different claim.

The first comparison read supports exact legacy claim paths (`/claims/{reviewVersionId}/{localClaimId}`), exact canonical claim-version paths (`/nodes/{nodeId}/versions/{nodeVersionId}`), and immutable external occurrence API references (`/api/publication-claim-occurrences/{id}`). A registered external occurrence need not have a canonical graph binding. Its recorded selector and source binding can provide an exact quote and locator; its preserved ORAtlas publication version is distinct from its publisher address, which may later change. Repository-object claim nodes without an honest claim-occurrence projection are outside this slice.

The page is a bounded read. It shows recorded source assertions and editor-confirmed graph relations where available, with a completeness caveat when the neighborhood or evidence list is truncated. Pending or rejected editorial proposals are outside the public read. Opening, copying or revisiting a comparison never merges claims or confirms a relationship. Withheld or tombstoned legacy review versions remain unreadable; the external publication schema has no withdrawal state, so this slice does not invent one.

Source fixture: [`packages/db/src/seed/data.ts`](../../../packages/db/src/seed/data.ts). Identity and lifecycle rules: [`docs/external-publications.md`](../../external-publications.md), [`ORATLAS_DECISIONS.md`](../../../ORATLAS_DECISIONS.md).
