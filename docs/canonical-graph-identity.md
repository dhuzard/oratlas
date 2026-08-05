# Canonical graph identity and compatibility migration

Status: **accepted architecture; expand, source-union compatibility, and dual-write prepared, not yet deployed**.

## Decision

The canonical knowledge model is one graph. Reviews, claims, cited works, figures, datasets, and
code have stable node identities; immutable records have exact node-version identities; scientific
relations are canonical graph edges. Relational review records remain useful projections and
compatibility subjects, not a second knowledge authority.

This decision is deliberately additive. It does not manufacture repository provenance, merge
ambiguous works, infer claim continuity, or rewrite the identifiers and hashes on which existing
TRUST, challenge, verification, and adjudication records depend.

## Stable identity and source union

A stable node says _which scholarly object this is_. A node version says _which immutable state of
that object is being addressed_. Node identity uses an explicit, discriminated source union:

| Node kind                   | Stable identity source                                   | Exact version source                                            |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `review`                    | exactly one node for `Review.id`                         | exactly one graph version for each `ReviewVersion.id`           |
| `claim`                     | an explicit stable claim binding                         | the exact claim occurrence and its owning `ReviewVersion.id`    |
| `work`                      | an Atlas global work id, with preserved alias assertions | the cited-work record selected by the canonical edge            |
| `figure`, `dataset`, `code` | repository id plus repository-local node id              | the immutable repository snapshot already used by node versions |

The union is exclusive. A repository-backed version uses its real snapshot and capture provenance;
a review-backed version uses its real `ReviewVersion`. Synthesis reviews therefore do not receive
fake repositories, snapshots, commits, trees, or captures. Database constraints and write services
must reject zero-source and multiple-source states.

There is one stable `review` node per `Review`, not one per release. Every `ReviewVersion` maps to
one exact version of that node, including repository and synthesis versions. The mapping is unique
in both directions. Changing the review head changes a projection; it never changes historical
node-version identity.

### Claims

Every claim write must name both a stable claim node and the exact graph version representing that
claim occurrence. A `Claim` cannot point only at a stable node, because doing so loses the immutable
version that the text and relation came from.

Atlas must not infer stable claim identity across review versions from a repeated local id,
normalized text, anchor, position, or similarity. An explicit source declaration or reviewed
identity decision may connect versions. During backfill, an otherwise unbound claim receives a
non-merged stable identity for its own occurrence and an exact version; possible continuity can be
proposed later without changing published identity.

### Globally identified works and local fallback

`work` is an Atlas-global scholarly-work identity, not a repository-local citation id. DOI, PMID,
OpenAlex, and other supported aliases are normalized assertions attached to the work and retained
with their source occurrence and role. Raw/source spelling and canonical value remain auditable;
aliases are never discarded merely because a preferred display alias exists.

Automatic reuse of a global work is allowed only when the complete alias evidence is compatible.
If a connected alias set asserts incompatible values for the same scheme or otherwise makes the
merge ambiguous, resolution fails closed: Atlas records the conflict, creates no cross-occurrence
identity assertion, and does not pick a winner. The citation occurrence remains attached to an
occurrence-local fallback work keyed to its exact `ReviewVersion` and local citation identity. A
citation with no usable global alias follows the same fallback. Fallback nodes are real graph
identities, not claims that two occurrences describe different works; a later reviewed merge is an
audited identity operation that preserves every alias and old reference.

## Canonical evidence edge and compatibility projection

Each claim-to-work evidence assertion becomes a canonical edge from the claim's exact node version
to the stable work node, with an exact target version where the source establishes one. Imported
repository evidence is a **source assertion**. It is distinct from an editor-confirmed relation and
must not acquire `confirmed-by-editor` provenance or `confirmed` status merely because it was
successfully parsed, backfilled, or displayed.

`ClaimEvidenceRelation` is retained as a compatibility projection and stable legacy subject. Each
row is linked 1:1 to its canonical evidence edge; each such edge has exactly one compatibility row.
The migration does not replace a relation row, change its id, or reinterpret its type. New writes
create the edge and projection atomically, and reads fail closed if the 1:1 binding or semantic
fields disagree.

This preservation is mandatory because dependent records address that stable subject. Existing
`TrustAssessment`, `TrustVerification`, formal challenge, challenge-transition, and
`TrustAdjudication` ids, foreign keys, canonical subject hashes, filed-content hashes, assessment
hashes, disagreement hashes, outcome hashes, and adjudication reference hashes remain byte-for-byte
unchanged. They are not recomputed against a new id. The canonical edge is linked alongside the
existing subject; a later contract may expose the edge without invalidating the historical ledger.

## Deployment sequence

This migration follows expand → dual-write → backfill → contract. Each phase is independently
deployable and rollback-safe until the final constraint step.

1. **Expand.** Add nullable source-union fields, review/work kinds, work aliases and conflicts,
   exact claim-version bindings, and the nullable 1:1 canonical-edge link. Add indexes and
   uniqueness constraints that are safe on existing data. Readers continue using current fields.
2. **Dual-write.** Deploy writers that atomically create the canonical graph object and existing
   relational projection. Reads compare both representations and emit mismatch metrics, but retain
   the established public projection while backfill is incomplete. Imported assertions remain
   imported; only an explicit editorial action confirms them.
3. **Backfill.** In bounded, restartable, idempotent batches, create one review node and exact
   version per existing review record; create conflict-aware work identities or occurrence-local
   fallbacks; create explicit per-occurrence claim identities where no reviewed binding exists;
   and link every relation 1:1 to its canonical edge. Record counts, conflicts, skips, and hashes in
   a validation manifest. Do not invent repositories or snapshots and do not infer cross-version
   claim identity.
4. **Contract.** After validation reports zero missing, duplicate, or semantically divergent
   bindings, make required claim node/version and 1:1 edge fields non-null, enforce the source-union
   constraints, switch canonical reads to the graph, and retain compatibility projection checks.

The first expand migration intentionally adds only nullable relational bindings and stable-key
metadata. The following compatibility migration relaxes repository/snapshot ownership and installs
database-native discriminated-union guards. Repository nodes require real repository ownership;
review, claim-occurrence, and work nodes require a global stable key and no repository; every node
version requires exactly one real source among repository snapshot, review version, claim
occurrence, or citation occurrence. Existing repository-backed readers fail closed on rows without
repository provenance.

Dual-write materializes each accepted relational review version in the same database transaction:
one stable review node and exact version, one non-merged claim-occurrence node and exact version per
claim, conflict-aware canonical or occurrence-fallback work nodes with exact citation versions, and
one source-assertion edge per legacy claim-evidence relation. The legacy relation id remains the
edge discriminator and its nullable `nodeEdgeId` becomes the 1:1 compatibility binding. Imported
edges use `source-assertion`/`imported-from-review`; they have no confirmer and never enter the
editor-confirmed public projection. Title and license are optional for canonical source records, so
the graph stores no invented display metadata. Existing TRUST subject hashes exclude the additive
binding and remain unchanged.

The database migration is an upgrade migration, not `db push` and not a production `db:reset`.
Before the expand migration job, operators must take and verify a real Cloud SQL backup according
to the deployment runbook, record its identifier in the change record, and prove the restore path
is available. `prisma migrate deploy`, backfill, validation, and the contract migration must not
start unless that backup gate passes. Local `db:reset` remains development-only and is not evidence
that a production upgrade is safe.

## Consequences and non-goals

- Canonical traversal can eventually return complete, reader-agnostic graph records while
  recommendation and presentation remain derived layers.
- Review and work are now reserved graph kinds at the shared contract boundary. This ADR alone does
  not make current Prisma or runtime paths accept their payloads.
- No historical scientific assertion is upgraded to editorial confirmation by migration.
- No alias conflict or missing identifier is papered over with a guessed global work.
- No reader profile, recommendation score, label, link, or viewport cap belongs to canonical node
  identity.
