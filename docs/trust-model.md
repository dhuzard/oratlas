# TRUST model

TRUST in Open Review Atlas is a **transparent, multidimensional assessment of a specific
claim–citation relation**. It is deliberately **not**:

- the probability that a paper is "true",
- a single universal score for an entire paper,
- a quality ranking of a journal or author.

## Unit of assessment

A TRUST assessment attaches to a **`ClaimEvidenceRelation`** (a claim ↔ citation pair with a
relation type), never to a citation globally. The same cited paper can support one claim strongly
and be irrelevant to another.

## Criteria

Ten criteria (`packages/contracts` `TRUST_CRITERIA`):

`identityIntegrity`, `entailment`, `sourceAccess`, `populationRelevance`,
`interventionExposureRelevance`, `outcomeRelevance`, `methodologicalSafeguards`,
`statisticalSafeguards`, `replicationConvergence`, `conflictDependency`.

Each criterion carries:

- an **ordinal rating**: `very-low`, `low`, `moderate`, `high`, `very-high`, `not-assessed`,
  `not-applicable`,
- a **status**: `assessed` / `not-assessed` / `not-applicable`,
- an optional **rationale** and **evidence pointer**,
- the assessor, timestamp, and protocol version.

## Aggregate (optional)

An aggregate is optional and **advisory**. When shown it must carry the algorithm/version that
produced it. The POC provides `ordinal-mean-1.0` (`packages/trust`): the mean of **assessed**
ordinal criteria only — `not-assessed`/`not-applicable` are excluded, never counted as zero.
`computeAggregate` returns `null` when nothing was assessed; it never invents a score.

The criterion-level record is always authoritative. The UI never shows an aggregate without
accessible criterion detail and the aggregate method.

## Review status

`agent-proposed` → `human-reviewed` → `adjudicated`, or `superseded`. Agent-proposed assessments
are clearly labelled in the UI (the `agent-proposed` provenance badge) and are distinguishable
from human-reviewed records everywhere they appear.

## What the UI shows

The claim, the citation, the support relation, each criterion rating (with status and rationale),
limitations, provenance, whether the assessment is agent-proposed or human-reviewed, and — only
when an aggregate is displayed — its method.
