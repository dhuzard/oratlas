# Assessment protocol interoperability

## Status and scope

> **Non-normative for the source protocols; normative for ORAtlas import, preservation and display behaviour.**

This document defines how ORAtlas handles assessments produced under three distinct protocols. It
does not amend TRUST.md or Computational Review TRUST, validate either methodology, or define a
scientific crosswalk between them.

The rules below apply whenever ORAtlas imports, preserves, exposes, compares, or independently
reassesses a source record. An immutable source assessment remains attributable to its native
protocol, assessment unit, version, assessor, and provenance.

## Pinned baselines

This document describes exact repository states, not moving branches.

| Protocol layer                | Protocol/version identity                                                                                                                | Immutable baseline                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| TRUST.md v0.4                 | Released v0.4 convention and schema; annotated release candidate `v0.4.0-rc.1`                                                           | `Neuronautix/TRUST.md@354beab9732bc72e357507c3a3f4b2f67b3cfced`                                    |
| Computational Review TRUST v2 | Rubric/schema version `2.0.0`                                                                                                            | `Neuronautix/ComputationalReviewTemplate_trust-knowledge@165f336608eed7d22f6c6505da57a4e3577070cc` |
| ORAtlas TRUST                 | Protocol `trust-poc-1.0`; subject schema `oratlas-trust-subject-1`; node-relation subject schema `oratlas-trust-node-relation-subject-1` | `dhuzard/oratlas@102d3fa96d47e9e7773720b0c36802f888cca4fe`                                         |

The TRUST.md entry pins annotated tag `v0.4.0-rc.1`, tag object
`e2eecd709992d00e18799c12e5e1b3136dbd421e`, tree
`7d99eeb52252b56f469345a70c273c3484b3c6fe`, and schema blob
`e20dd44832409fbfb16783cd8d7fdc44aa26c124`. ORAtlas must not silently treat later source
content as equivalent to these baselines.

## The three layers

| Layer                         | Assessment unit                                                            | Primary output                                                |
| ----------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| TRUST.md v0.4                 | Repository, artifact, claim, or externally referenced relation declaration | Ordinal profile, lifecycle, supersession, and provenance      |
| Computational Review TRUST v2 | Review claim as written                                                    | Five-component deterministic audit and experimental aggregate |
| ORAtlas TRUST                 | Immutable claim–evidence relation                                          | Multidimensional independent relation assessment              |

The shared word “TRUST” does not establish shared semantics. A common label, ordinal term, numeric
range, reviewer status, or provenance field is interoperable only to the extent stated below.

## Classification terms

- **Equivalent** — the concept has the same operational meaning and may be preserved in a common
  field without semantic transformation.
- **Related but not equivalent** — the concepts concern similar information but differ in unit,
  definition, allowed values, computation, or authority. They must remain separately identified.
- **Source-native only** — ORAtlas may preserve and display the value with its native protocol
  identity, but must not use it as an ORAtlas criterion or platform decision.
- **Not crosswalkable** — no deterministic, scientifically defensible translation is defined.
  ORAtlas must not calculate or imply one.

## Concept-level mapping

| Concept                   | TRUST.md v0.4                                                                                                       | Computational Review TRUST v2                                                                      | ORAtlas TRUST                                                                                                 | Classification and required handling                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol identity         | `trust_md_version` `0.4`                                                                                            | `rubric_version`/`schema_version` 2.0.0                                                            | `protocolVersion` `trust-poc-1.0`                                                                             | **Equivalent as identity metadata only.** Preserve the native identifier verbatim; never collapse the three protocols under an unversioned “TRUST” label. |
| Assessment unit           | Repository, artifact, claim, or external relation reference                                                         | Claim as written                                                                                   | Exact immutable claim–evidence relation                                                                       | **Related but not equivalent.** Unit must be explicit and preserved. A broader-unit assessment cannot be promoted to a narrower unit.                     |
| Ordinal expression        | Assessment-scoped vocabularies for evidence support, calibration, source integrity, and optional fitness conclusion | Derived claim label from deterministic component scores and caps                                   | Per-criterion seven-value vocabulary including `not-assessed` and `not-applicable`                            | **Related but not equivalent; not crosswalkable.** Identical-looking words do not authorize conversion.                                                   |
| Numerical value           | Optional non-probabilistic 0–100 refinement scoped to one assessment                                                | Deterministic 0–100 claim audit aggregate                                                          | Optional 0–1 advisory mean of assessed ORAtlas ordinals                                                       | **Not crosswalkable.** Preserve native scale, method, and limitations. Never rescale or compare as if cardinally commensurate.                            |
| Dimensions/components     | Evidence support, calibration, and source integrity; purpose and fitness are separate assessment fields             | Traceability, robustness, uncertainty calibration, source integrity, transferability/scope control | Ten relation criteria defined in `docs/trust-model.md`                                                        | **Related but not equivalent; native components are source-native only.** Similar names do not establish identical questions or scoring rules.            |
| Missingness               | Missing, explicit `not-assessed`, `not-applicable`, and low support are distinct                                    | Native schema and audit rules                                                                      | Missing, `not-assessed`, and `not-applicable` remain distinct; unassessed values are excluded from aggregates | **Equivalent only where the source state is explicit and meanings match.** Do not turn absence into low support or zero.                                  |
| Review process status     | `unreviewed`, `agent-reviewed`, `human-reviewed`, `adjudicated` with required provenance                            | Source-native human review and adjudication state                                                  | Imported assertion plus separate Atlas-owned verification marker                                              | **Related but not equivalent.** Source status is provenance, not platform authority.                                                                      |
| Assessor/provenance       | Assessment series/id/version, assessor, protocol, timestamp, declared independence, basis, and lifecycle provenance | Validator, agent and human decision provenance                                                     | Source provenance plus immutable subject hash and Atlas verification provenance                               | **Equivalent for literal provenance facts; related but not equivalent for authority.** Preserve actor, time, method, and source without promotion.        |
| Aggregate                 | Top-level cross-assessment aggregation forbidden; optional summary scoped to one assessment and protocol            | Experimental deterministic claim aggregate with component detail and caps                          | Optional advisory criterion mean, method-labelled                                                             | **Source-native only and not crosswalkable.** Aggregates remain bound to their protocol and unit.                                                         |
| Verification/adjudication | Declares completion of a source review process                                                                      | Declares source-side review of the claim audit                                                     | Separate hash-bound ORAtlas editor marker                                                                     | **Not equivalent.** Only the Atlas marker changes ORAtlas verification state.                                                                             |

## Field handling rules

### Equivalent fields and facts

ORAtlas may normalize only literal, semantics-preserving facts:

- protocol identifier and version, retained verbatim;
- assessor identity and type, when supplied;
- assessment timestamp, when supplied;
- source repository, commit, tree, release, and artifact identity;
- the declared assessment unit;
- stable source identifiers and evidence pointers;
- an explicit missingness state where the native definition matches the stored state.

Normalization may change storage shape or field naming, but not meaning. The original record must
remain recoverable byte-for-byte or through a content-addressed immutable capture, and its hash must
be retained.

### Related but not equivalent fields

The following may be displayed adjacent for comparison but must remain in protocol-labelled
namespaces:

- bands, labels, ratings, and status vocabularies;
- component or dimension names;
- human/agent review states;
- evidence and rationale fields;
- aggregate values;
- claims of independence, adjudication, or verification.

A user interface must present the native protocol, version, unit, scale, and method at the point of
display. Similar terminology must not be presented as a matched criterion unless a later,
versioned, reviewed crosswalk explicitly establishes that mapping.

### Source-native-only fields

Computational Review TRUST v2 component scores, rules, caps, labels, aggregate, and source review
decisions are source-native assertions. TRUST.md v0.4 dimension vocabularies, fitness conclusions,
optional refinements, assessment-scoped summaries, and conformance claims are likewise source-native
unless ORAtlas independently evaluates its own relation criteria.

Source-native data may support discovery, provenance inspection, or side-by-side display. It must
not populate ORAtlas criterion columns, set an ORAtlas aggregate, satisfy an ORAtlas verification
requirement, or affect an Atlas-owned editorial marker.

### Not-crosswalkable values

No conversion is defined between:

- TRUST.md bands or 0–100 refinements and Computational Review TRUST v2 labels or scores;
- either source protocol's dimensions/components and ORAtlas's ten criteria;
- a claim-level result and its individual claim–evidence relations;
- source human review/adjudication and ORAtlas verification;
- any native aggregate and the ORAtlas `ordinal-mean-1.0` aggregate.

ORAtlas must preserve these values without synthesizing a common score, ranking, implied
equivalence, or consensus statement.

## Normative prohibitions

ORAtlas importers, storage projections, APIs, exports, user interfaces, and agents **must not**:

1. Copy a claim-level score, label, review state, or assessment onto every evidence relation.
2. Translate Computational Review TRUST v2 components or TRUST.md dimensions into ORAtlas
   criteria by name, position, numerical similarity, or heuristic inference.
3. Convert numerical thresholds, bands, or aggregates between protocols, including 0–100 to 0–1
   rescaling.
4. Promote a source `human-reviewed` or `adjudicated` state into ORAtlas verification.
5. Combine native and ORAtlas assessments into one aggregate, composite score, consensus value, or
   ranking.
6. Treat multiple agent agreement as human review or scientific validation.
7. Treat a missing or `not-assessed` value as zero, low support, or `not-applicable`.
8. Rewrite a captured native record when an independent ORAtlas assessment is added.
9. Replace a protocol version in place. A changed protocol produces a new, separately identified
   assessment record.
10. Describe an assessment at one unit as evidence that another unit was assessed.

## ORAtlas import behaviour

For every imported assessment, ORAtlas must:

1. Resolve and store the immutable source identity: repository id, commit SHA, tree SHA when
   available, selected tag/release when applicable, artifact path, and content hash.
2. Store the native protocol name/version and declared assessment unit.
3. Preserve the complete native record and its explicit provenance.
4. Mark source review assertions as source assertions.
5. Initialize public platform verification as `unverified-import`.
6. Leave all ten ORAtlas criteria `not-assessed` unless a separate ORAtlas assessment actually
   evaluates the immutable relation.
7. Reject malformed records rather than falling back to a more permissive protocol shape.
8. Record unsupported protocol versions as unsupported without guessing a compatible version.
9. Keep later corrections, supersessions, and reassessments as linked immutable records.

If a source claim assessment is transported once per citation relation for technical reasons, each
copy must remain explicitly identified as the same claim-level source assertion. It must not be
stored or displayed as a relation-level result.

## Preservation and display behaviour

A source-native panel must show, at minimum:

- native protocol and exact version;
- native assessment unit;
- source repository and immutable revision;
- assessor/review provenance;
- native dimensions/components and aggregate method, if any;
- a visible statement that the record is a source assertion and is not ORAtlas verification.

A separate ORAtlas panel may show an independent relation assessment and platform verification.
The two panels must not share an unlabeled score, badge, colour legend, or aggregate. Side-by-side
comparison must identify non-equivalence and missing criteria explicitly.

Exports must retain this separation. A consumer must be able to distinguish the unmodified native
assessment, the ORAtlas relation assessment, and the ORAtlas verification marker without consulting
UI prose.

## Independent reassessment and disagreement

An ORAtlas assessor may evaluate the same immutable claim–evidence relation without altering the
source assessment. The new assessment must identify its protocol version, assessor, timestamp,
subject hash, and relation endpoints.

Disagreement is represented as coexisting, attributable assessments or challenges against the same
immutable subject. ORAtlas must not average disagreement away or report false consensus. Any later
adjudication is a new decision record with its own authority and provenance; it does not rewrite the
source protocol's result.

## Conformance tests

At minimum, automated tests for this boundary must demonstrate that:

- a Computational Review TRUST v2 claim score repeated for transport does not populate relation
  criteria or an ORAtlas aggregate;
- all ten ORAtlas criteria remain explicitly `not-assessed` for the Ethical Debt source fixture;
- source `human-reviewed` remains `unverified-import` without a current Atlas marker;
- missing, `not-assessed`, `not-applicable`, and low-support results remain distinguishable;
- malformed relation subjects cannot fall back to a claim-level parser;
- an independent ORAtlas reassessment does not change the stored source record or its hash;
- an unknown protocol version fails with an explicit unsupported-version diagnostic;
- API and export representations preserve protocol, version, unit, provenance, and authority
  separation.

## Change control

Changes to this document require review whenever they alter import, preservation, display, export,
verification, or aggregation behaviour. A source protocol release does not update these rules
automatically.

The next mandatory update is triggered by a stable TRUST.md v0.4 release or any v0.5 release
candidate. That update must pin the tag, commit, tree, and schema blob; compare the executable
specification with the baseline above; and record semantic differences before ORAtlas accepts the
new pin as a supported protocol.
