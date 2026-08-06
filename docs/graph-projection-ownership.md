# Graph projection ownership

Status: accepted for the current architecture

Tracking issue: [#145](https://github.com/dhuzard/oratlas/issues/145)

## Decision

ORAtlas intentionally retains two graph projections with different owners:

- the **canonical graph record projection** is the stable, versioned public record API;
- the **graph presentation projection** is a reader-facing discovery view used only by the
  interactive `/graph` page.

They share stored graph identity and public-visibility rules, but they are not interchangeable DTOs
and must not be merged merely because both currently query Prisma. Exact edge identity is their
explicit interoperability seam: when both expose the same confirmed edge, its id, canonical
direction, exact endpoint versions, relation type, status, and provenance must agree.

## Ownership matrix

| Concern                       | Canonical graph record                                                                               | Graph presentation                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Contract                      | `canonicalGraphResponseSchema` 2.x                                                                   | `publicGraphResponseSchema` 1.x                                                                  |
| Query owner                   | `canonical-graph-query.ts`                                                                           | `graph-query.ts`                                                                                 |
| Consumers                     | `GET /api/graph`, Explore, exact occurrence pages                                                    | `/graph` page only                                                                               |
| Primary purpose               | Durable record traversal and agent/API consumption                                                   | Human discovery and visualization                                                                |
| Seed                          | Required stable node id; optional exact version id                                                   | Exactly one stable node id or a topic query                                                      |
| Version semantics             | Exact requested/readable version retained in `seed`                                                  | Latest readable snapshot-backed version per node                                                 |
| Traversal                     | One incident-edge page; explicit incoming/outgoing/both direction                                    | Breadth-first presentation traversal, depth 0–3                                                  |
| Edge states                   | Source assertions, confirmed edges, or authoritative union                                           | Confirmed edges or privacy-minimal open proposals                                                |
| Node representation           | Full immutable source, payload, provenance, aliases, contributors, and identifiers                   | Compact title/repository/snapshot view model                                                     |
| TRUST                         | Exact confirmed-edge assessment array in the record                                                  | Optional presentation filter plus compact compatibility field                                    |
| Filters                       | Direction, exact relation, record status                                                             | Topic, kind, relation, proposal/confirmed state, TRUST presence                                  |
| Pagination                    | Exact record cursor, max 100                                                                         | Signed mutation-sensitive presentation cursor, max 50                                            |
| Search                        | None                                                                                                 | Bounded in-process topic seed discovery                                                          |
| Proposal visibility           | Never exposed                                                                                        | Explicit opt-in, privacy-minimal, open proposals only                                            |
| Repository-backed requirement | Supports repository and review/claim/citation occurrence sources                                     | Requires the compact repository/snapshot projection                                              |
| Failure posture               | Reject the page if any selected exact edge is invalid; reject unreadable records and invalid cursors | Omit invalid stored edges; reject a corrupt current seed, oversized frontiers, and stale cursors |

## Shared invariants

The two projections may share low-level predicates or adapters only when these invariants remain
covered by both integration suites:

1. Confirmed edge ids and canonical source/target direction never change by traversal direction.
2. Endpoint version ids are exact and owned by their declared stable nodes.
3. Unreadable, tombstoned, corrupt, or structurally invalid records fail closed.
4. TRUST remains exact-edge scoped and never becomes a node/paper truth score.
5. Private proposal evidence, editorial notes, prompts, and agent-run data never enter either
   projection.
6. Cursor formats remain projection-specific public compatibility surfaces.

`graph-query.integration.test.ts` exercises one shared seed through both query stacks and asserts
the common edge-identity seam plus deliberately different node/query representations.

## Dependency direction

The canonical record projection is not implemented in terms of the presentation projection, and
the presentation projection is not implemented in terms of the canonical response DTO. Both may
depend on:

- shared public-snapshot visibility predicates;
- the confirmed-edge publication predicate;
- the exact-edge TRUST provider;
- narrowly extracted pure edge-identity helpers.

Presentation-only search, multi-depth traversal, proposal mapping, and signed cursors stay in the
presentation owner. Canonical source mapping, source-assertion traversal, exact-version selection,
and record pagination stay in the canonical owner.

## Migration guidance

Future refactoring may rename the internal presentation module or place shared predicates in a
feature folder. It must retain forwarding exports until all callers move. Any proposal to remove or
combine a contract requires a separate compatibility issue with OpenAPI, cursor, deep-link, and
consumer migration evidence; it is not part of the architecture refactor.
