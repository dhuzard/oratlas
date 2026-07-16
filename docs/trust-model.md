# TRUST model

TRUST in Open Review Atlas is a **transparent, multidimensional assessment of a specific
claim–evidence relation**. It is deliberately **not**:

- the probability that a paper is "true",
- a single universal score for an entire paper,
- a quality ranking of a journal or author.

## Unit of assessment

A TRUST assessment attaches to an **evidence relation**, never to a citation or knowledge node
globally. The same cited paper, dataset, code release, or figure can be relevant to one claim and
irrelevant to another.

Two backward-compatible repository record forms are supported:

- The original `trustRecordSchema` addresses a `ClaimEvidenceRelation` using `claimId` and
  `citationId`.
- `nodeRelationTrustRecordSchema` addresses dataset, code, or figure evidence using a required
  `subjectType: "node-relation"` and a complete `subject`: `claimNodeId`, `evidenceNodeId`,
  `evidenceKind`, and `relationType`. A cross-repository evidence target also carries its immutable
  GitHub repository ID and commit SHA.

There is intentionally no bare-node form. Dataset evidence uses `uses-dataset` or `derives-from`,
code evidence uses `uses-code` or `derives-from`, and figure evidence uses `derives-from`. Both
endpoints are part of the subject; assessing a dataset, code release, or figure without the claim
relation is invalid. The combined `trustAssessmentRecordSchema` lets new importers accept both
forms without changing legacy claim–citation consumers. A record containing either `subjectType`
or `subject` is treated as node-relation intent and must pass the strict schema; malformed hybrids
cannot fall back to the permissive legacy parser.

Node-only repositories declare the JSONL stream in `node-manifest.json` as
`trustAssessments: { "format": "jsonl", "path": "nodes/trust.jsonl" }`. The legacy
`review-manifest.json` artifact remains supported. Mixed repositories may declare both paths; the
bounded inspector fetches both routing manifests before routed artifacts, and the extractor reads
and deduplicates both streams without turning node publication into prose-review publication.

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

## Repository assertions and platform verification

Repository artifacts may assert `agent-proposed`, `human-reviewed`, `adjudicated`, or
`superseded`, and a relation may assert `humanReviewed: true`. Atlas preserves those exact source
assertions (status, assessor, evidence, timestamp, aggregate—including explicit `null`), but never
treats them as platform verification. Every imported assessment and relation is publicly
`unverified-import`/`humanReviewed = false` until an Atlas editor records a separate marker.

The one-to-one `TrustVerification` marker records `human-reviewed` or `adjudicated`, the reviewer
foreign key, their role at review time, a rationale, and a canonical subject hash. For citation
evidence, the hash covers the criterion JSON, evidence, source assertions, relation, claim, and
citation. For node evidence, it covers the same assessment material plus the edge and both exact
immutable node versions, including their raw payload and provenance JSON. Endpoint mismatches are
rejected before hashing. A later mutation of any covered field makes the marker stale and public
reads fail closed to `unverified-import`. Legacy rows without source provenance also fail closed
and appear in the editorial queue.

Repository assertions on node relations are normalized by
`normalizeImportedNodeRelationTrustRecord`. Their asserted review status and aggregate are
preserved as source provenance, while the public state is always `unverified-import` and the
aggregate is omitted from compact node-edge and editorial summaries because those views do not
expand criterion detail. `resolveNodeRelationTrustVerification` uses the same canonical SHA-256
marker rules as legacy claim–citation verification; only a current Atlas-owned marker can promote
the assessment.

The persisted unit is a mandatory `NodeRelationTrustAssessment → NodeEdgeProposal` relation with a
separate one-to-one `NodeRelationTrustVerification`. Acceptance requires the exact extracted author
edge, stable local ids, node kinds, relation type, capture/submission ownership, source repository
id and commit, plus exact cross-repository id/commit when present. Confirmation does not rewrite the
assessment. Rejected, proposed, or superseded proposals and incomplete/mismatched confirmed edges
remain private and make any previous marker stale.

The node-relation canonical subject hash covers the parsed imported record and every material
assessment field, proposal lifecycle field, confirmed-edge field, stable endpoint key, complete
claim/evidence node version, repository/snapshot identity, inspection capture, submission, frozen
target, and current confirmer role. Verification uses the node assessment's own revision CAS and
writes its marker plus audit event atomically. Public node detail and standalone edge APIs share the
same fail-closed resolver and expose only compact status/protocol metadata on authoritative edges.

Verification writes require the current subject hash and the applicable assessment revision; a
transaction uses both as optimistic-concurrency guards before writing the marker and audit event. The endpoint
also requires an editor session, exact same-origin `Origin`, same-origin Fetch Metadata when
present, and `Content-Type: application/json`.

Presentation is fail-safe: only the known `human-reviewed` and `adjudicated` workflows receive a
human-reviewed badge. Imported, superseded, mixed, or unknown status values receive an explicit
warning and are never promoted to human-reviewed by a fallback label.

## What the UI shows

The claim, citation, support relation, criterion ratings (with status and rationale), limitations,
repository assertion, current platform-marker state, and — only when an Atlas-computed aggregate
is displayed — its method. Atlas structural review is not scientific peer review and does not
establish that a claim or paper is correct.
