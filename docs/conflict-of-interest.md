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

## Rollout boundary

This implementation applies the shared contract and enforcement to formal challenge resolutions
and dismissals. Applying the same snapshot to assessment creation/adjudication and the remaining
formal and legacy editorial-decision records is separate follow-up work; those surfaces must not be
described as COI-complete until they adopt this contract and recusal rule.
