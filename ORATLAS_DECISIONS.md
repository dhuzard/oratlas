# ORAtlas open decisions — governance and scientific judgment

These questions require human governance or scientific judgment. **Agents and contributors must
not resolve them by implementation default**; backlog items in `ORATLAS_BACKLOG.md` that depend
on them are marked `blocked` (tracked by ORA-L03). The decision slate below was ratified by the
maintainer on 2026-07-22. Implementations must preserve the recorded boundaries and explicitly
cite the relevant section when unblocking dependent backlog items.

Format per entry: current state in the codebase, the open question, and what depends on it.
Decider for §§1–13: Damien Huzard (`dhuzard`). Decision date: 2026-07-22.

## 1. Structural versus scientific verification

- **Current state:** Platform markers (`TrustVerification`, `human-reviewed`/`adjudicated`)
  are documented as review of the captured structure, "not that the scientific claim is
  correct" (`docs/trust-model.md`).
- **Open question:** Is structural review the permanent ceiling of what an ORAtlas marker may
  assert, or will there ever be a distinct, explicitly-labelled scientific-review record? If
  the ceiling is permanent, should the UI wording be strengthened further?
- **Decision:** ORAtlas verification markers assert structural review only. Any future
  scientific review must be a separate, explicitly labelled record type; no existing marker
  may imply scientific correctness. Strengthen UI wording wherever the distinction is not
  already explicit.
- **Rationale:** Keeping structural and scientific assertions in separate records prevents a
  platform integrity check from being mistaken for scientific endorsement.
- **Depends on it:** wording in ORA-H01; scope of any future assessment type.

## 2. Whether aggregates should be displayed at all

- **Current state:** Aggregates are optional, advisory, method-labelled (`ordinal-mean-1.0`),
  never shown without criterion detail.
- **Open question:** Should any aggregate be displayed publicly at all — and if several
  assessments of one relation exist (ORA-D01), is any per-relation summary permissible, or is
  the criterion profile list the only honest display?
- **Decision:** A method-labelled aggregate may be displayed only within the assessment that
  produced it and only alongside its full criterion profile. ORAtlas must never calculate or
  display a cross-assessment aggregate. Multiple assessments are compared as complete,
  uncollapsed profiles.
- **Rationale:** A source method may be preserved without inventing a platform-wide summary
  that erases assessor, protocol, or disagreement provenance.
- **Depends on it:** ORA-D02 display rules, ORA-D03 hardening, ORA-I01 export shape.

## 3. Non-compensatory criteria

- **Open question:** Are some TRUST criteria non-compensatory — i.e., can a `very-low` on
  `identityIntegrity` or `sourceAccess` be offset by high ratings elsewhere in any summary
  view, or must such criteria gate any summary entirely?
- **Decision:** `identityIntegrity` and `sourceAccess` are non-compensatory. A `very-low`
  rating on either must produce a visible warning and may not be concealed or offset by an
  aggregate. It does not by itself block archival publication.
- **Rationale:** Identity and inspectability failures materially qualify every downstream
  interpretation, while preservation should remain possible with honest warnings.
- **Depends on it:** any aggregate/summary display (§2); ORA-D02 disagreement weighting.

## 4. Assessor qualifications

- **Open question:** Does ORAtlas record or require any assessor qualification (human domain
  expertise, agent model identity/version), and is qualification displayed, required, or
  ignored? Current schema stores assessor type/id strings without semantics.
- **Decision:** Store assessor qualification as provenance. Agent assessments require model,
  provider, and version identity. Human expertise, affiliation, and identifiers are
  self-declared and optional. Qualifications are displayed but initially do not determine
  eligibility or ordering.
- **Rationale:** Readers need attributable assessor context before the project has evidence
  for a defensible qualification or ranking policy.
- **Depends on it:** ORA-D01 display ordering, ORA-D02 adjudication inputs.

## 5. Adjudication authority

- **Open question:** Who may adjudicate between disagreeing assessments and resolve
  challenges — editors only, designated adjudicators, review contributors ever? Can an
  adjudication itself be challenged?
- **Interim safe default (explicitly provisional):** ORA-E01/E02 build with editors-resolve
  and keep the authority check swappable; ORA-D02 does not start until this is decided.
- **Decision:** Editors and explicitly designated adjudicators may adjudicate. A person may
  not adjudicate their own assessment, contribution, challenge, or declared conflict. Review
  contributors do not resolve challenges concerning their own contributions. Adjudications
  are immutable outcomes that may themselves be challenged.
- **Rationale:** This preserves accountable editorial authority while retaining a formal path
  to contest an adjudication.
- **Depends on it:** ORA-D02, ORA-E01, ORA-E02, ORA-F02.

## 6. Conflict-of-interest representation

- **Open question:** What COI declarations are collected (self-declared only?), on which
  records (assessments, adjudications, challenge resolutions, editorial decisions), how they
  display, and whether any COI ever blocks an action or is provenance-only.
- **Decision:** Collect immutable, self-declared, publicly visible COI snapshots for
  assessments, adjudications, challenge resolutions, and editorial decisions. COI is
  provenance-only except for direct self-involvement, which requires recusal or an explicit,
  public, audited administrator override.
- **Rationale:** Public provenance supports accountability without inventing an unvalidated
  severity taxonomy, while direct self-adjudication needs an enforceable boundary.
- **Depends on it:** ORA-F02.

## 7. Assessment crosswalk policy

- **Current state:** No crosswalk exists; ORA-D04 will enforce that none is invented silently.
- **Open question:** Is a crosswalk between protocols (e.g., a future TRUST v2 ↔ v1, or
  FAIR-derived ↔ TRUST) ever permissible as an explicit, versioned, editorially-owned
  artifact — and if so, who authors and validates it? The standalone convention is owned by
  `Neuronautix/TRUST.md`, while Computational Review TRUST v2 is owned by
  `Neuronautix/ComputationalReviewTemplate_trust-knowledge`; a crosswalk needs every affected
  methodology owner's involvement.
- **Decision:** A crosswalk is permissible only as an explicit, immutable, versioned artifact
  approved by ORAtlas editors and validated with the relevant methodology owner. Crosswalks
  are never implicit, automatic, or retroactive.
- **Rationale:** Protocol evolution needs a reviewable scholarly object rather than a silent
  reinterpretation of archived assessments.
- **Depends on it:** ORA-D04 documentation section; any future protocol-evolution story.

## 8. Evidence independence

- **Current state:** Deterministic shared-source detection informs synthesis (PR #21).
- **Open question:** What is the endorsed definition of "independent evidence" beyond
  shared-DOI/dataset rules — shared authors? shared lab? derived datasets? — and may
  independence ever be presented as a computed property rather than raw shared-source facts?
- **Decision:** Publish raw overlap facts when available, including shared works, datasets,
  authorship, laboratories, and derivation links. Do not reduce them to an automated binary
  or scalar claim that evidence is "independent."
- **Rationale:** Dependence is contextual and scientific; exposing the underlying facts is
  reproducible without overstating what the platform can infer.
- **Depends on it:** ORA-C02 scope ceiling, contradiction-map presentation.

## 9. Public versus private editorial data

- **Current state:** Synthesis records have a strict public allowlist / private denylist;
  other editorial data (submission notes, override rationales, moderation rationales) has
  conventions but no single ratified boundary document.
- **Open question:** Ratify one boundary: which editorial records are public (accountability)
  vs private (candor), including challenge-moderation and adjudication rationales, and
  retention rules under takedown (`docs/operations/privacy-and-takedown.md`).
- **Decision:** Public data includes lifecycle state, outcome, timestamps, and the responsible
  resolver login. Private data includes free-text editorial and moderation rationales,
  remover identity, role snapshots, submission notes, and removed bytes. Content hashes and
  audit metadata are retained indefinitely. Removed bytes are purged after 90 days unless a
  documented legal hold applies.
- **Rationale:** The public record remains attributable and auditable without exposing candid
  deliberation or retaining removed personal content indefinitely.
- **Depends on it:** ORA-F03 closure criteria, ORA-E02 moderation display, ORA-J01 leakage
  definitions.

## 10. Requirements for calling a protocol calibrated

- **Open question:** What evidence would justify describing any assessment protocol as
  "calibrated" (inter-assessor agreement data? benchmark sets? none, ever, within ORAtlas)?
  Until decided, no ORAtlas surface may use the word "calibrated" about any protocol.
- **Decision:** "Calibrated" may be displayed only when a published, versioned calibration
  report provides benchmark cases, multiple assessors, agreement metrics, and limitations.
  ORAtlas records and links that evidence but does not self-certify calibration.
- **Rationale:** Calibration is an empirical claim that must remain attributable to a
  reviewable evidence artifact.
- **Depends on it:** ORA-D02 disagreement-rate display, any protocol-metadata surface.

## 11. Immutable assessment identity and replay

- **Decision:** Every assessment is an immutable record with a stable `assessmentId`.
  Corrections create a new record linked by `supersedesAssessmentId`; supersession never
  deletes or hides history. Replay hashes cover canonical semantic content and provenance,
  excluding database-generated identifiers and storage timestamps.
- **Decision:** Complete assessment arrays are canonical. A legacy singleton projection is
  emitted only when exactly one assessment exists. Deterministic ordering is assessment time,
  assessor type, assessor id, protocol version, then assessment id.
- **Rationale:** These rules make replay, coexistence, pagination, and compatibility behavior
  deterministic without mutating the scholarly record.
- **Depends on it:** ORA-D01, ORA-D02, ORA-D03, ORA-I01.

## 12. Source-native TRUST.md and FAIR.md ingestion

- **Decision:** Preserve `TRUST.md` and `FAIR.md` as immutable, bounded, escaped source-native
  documents. Extract only path, presence, byte length, content hash, source revision, and an
  explicitly validated protocol identifier. Do not infer criteria, ratings, scores,
  assertions, or crosswalks from prose.
- **Rationale:** ORAtlas can preserve and surface upstream documents without claiming to own
  or reinterpret their methodology.
- **Depends on it:** ORA-A04, ORA-H01, ORA-I01.

## 13. Ethical Debt reference fixture

- **Decision:** Use `dhuzard/ethical-debt-AI-review` as the first frozen integration fixture,
  pinned to artifact-bearing tag `v0.1.0-trust-preview.3`, commit
  `955e2994e0c6a042be80851b2125c2064c211dcf`, and tree
  `095ceeb0ab7f5d9d3bc32f77869dcc856c707806`.
- **Rationale:** This tag contains the review manifest, source-native TRUST/FAIR documents,
  ORAtlas JSONL exports, provenance, and honest non-crosswalk assessment semantics required
  for the first end-to-end fixture.
- **Depends on it:** ORA-A03, ORA-A04, ORA-K02.

## 14. Disagreement detection and active queue scope

- **Decision:** Within one exact protocol identity, any difference between two explicit ordinal
  criterion ratings is a disagreement. Missing, `not-assessed`, and `not-applicable` values are
  coverage gaps, not ratings, and therefore do not create a disagreement.
- **Decision:** The open disagreement queue compares only the current heads of immutable
  assessment supersession lineages. Superseded assessments and their historical disagreements
  remain publicly visible, but do not generate active alerts.
- **Rationale:** A zero-distance threshold avoids hiding minority assessments, while separating
  absent coverage from contrary judgement. Lineage-head queueing prevents corrected assessments
  from leaving stale operational alerts without erasing the scholarly record.
- **Depends on it:** ORA-D02.
