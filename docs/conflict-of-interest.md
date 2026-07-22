# Conflict-of-interest provenance and recusal

ORAtlas uses one strict, non-ordinal public snapshot vocabulary:

- `none-declared`
- `conflict-declared`
- `not-provided`

The snapshot is immutable provenance. It contains no severity, score, category, or free-text
explanation. Legacy and imported records without a snapshot project as `not-provided`; absence is
never interpreted as a declaration that no conflict exists.

## Challenge outcomes

Every new challenge resolution or dismissal records the resolver's snapshot. Public challenge
lifecycle data exposes the snapshot, outcome, timestamp, and resolver login. Private editorial
rationale and role snapshots remain excluded from the public contract.

A resolver is directly involved when they filed the challenge, authored its response, are a
contributor of record for the challenged review version, authored the challenged assessment under
their GitHub login, or performed the platform verification being challenged. Direct involvement
requires recusal. The sole exception is an `ADMIN` who explicitly exercises the override while
declaring `conflict-declared`; the administrator login and override timestamp are immutable and
public, and the action is retained in the audit log. An override cannot be attached to an
uninvolved outcome.

## TRUST assessment imports

Both claim-citation `TrustAssessment` and node-relation `NodeRelationTrustAssessment` records retain
the source's tri-state snapshot. Missing declarations in legacy repository artifacts are normalized
to `not-provided` before canonical source JSON and source-record hashes are computed, so changing a
declaration creates a distinct append-only source record instead of mutating an existing assessment.
Anonymous graph, node, and bounded-evidence projections expose only the tri-state snapshot.

Repository ingestion is the only current assessment-creation path: it has no platform resolver and
therefore no administrator self-involvement override to exercise. Database guards reject invented
statuses and any later update to the stored snapshot. A future interactive assessment-authoring path
must add actor-based direct-involvement recusal and the public `ADMIN` override provenance before it
can create records; repository import does not invent an actor or a dead override API.

## Editorial decisions

Formal round decisions store the snapshot on the immutable `DecisionLetter`. The legacy direct
decision endpoint creates a separate, one-per-submission immutable provenance record so mutable
submission state is never treated as the decision ledger. Their decision hashes and idempotency
bindings cover the outcome, decision-letter body or private-note hash, public actor login, private
role snapshot, stable submission/round identity, COI snapshot, and the administrator override login
and exercise time. Reads recompute those hashes before publishing a decision. The stored actor login
snapshot, rather than a mutable current account login, drives projections and idempotent retries.

An editor is directly involved when deciding their own submission or a submission for which they
authored a formal report. Direct involvement requires recusal. Only an `ADMIN` may exercise the
explicit exception, and only with `conflict-declared`. Public decision projections contain the
status and, when exercised, the administrator login and time; notes, rationale, role snapshots, and
internal user IDs remain private. Legacy decision rows without provenance project as
`not-provided` rather than `none-declared`.

An assignment-level COI declaration is provenance, not an automatic recusal. A `recused` assignment
cannot make an ordinary decision. The ratified exception remains limited to actual direct
self-involvement, an `ADMIN` actor, an explicit `conflict-declared` input, and public override
provenance; an uninvolved override is rejected. Database guards prevent both updates and deletions
of decision letters and direct-decision provenance.

## Current coverage

The shared contract now covers challenge outcomes, both current TRUST assessment import families,
formal round decisions, and legacy direct editorial decisions. Repository assessment ingestion has
no platform resolver, so it intentionally has no dead administrator-override API; a future
interactive assessment-authoring surface must implement actor recusal before it can create records.
