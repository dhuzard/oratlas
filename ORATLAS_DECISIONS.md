# ORAtlas open decisions — governance and scientific judgment

These questions require human governance or scientific judgment. **Agents and contributors must
not resolve them by implementation default**; backlog items in `ORATLAS_BACKLOG.md` that depend
on them are marked `blocked` (tracked by ORA-L03). When a decision is made, record it in place:
decision, rationale, decider, date — then unblock the dependent backlog items explicitly.

Format per entry: current state in the codebase, the open question, and what depends on it.
None of these is decided by this file's existence.

## 1. Structural versus scientific verification

- **Current state:** Platform markers (`TrustVerification`, `human-reviewed`/`adjudicated`)
  are documented as review of the captured structure, "not that the scientific claim is
  correct" (`docs/trust-model.md`).
- **Open question:** Is structural review the permanent ceiling of what an ORAtlas marker may
  assert, or will there ever be a distinct, explicitly-labelled scientific-review record? If
  the ceiling is permanent, should the UI wording be strengthened further?
- **Depends on it:** wording in ORA-H01; scope of any future assessment type.

## 2. Whether aggregates should be displayed at all

- **Current state:** Aggregates are optional, advisory, method-labelled (`ordinal-mean-1.0`),
  never shown without criterion detail.
- **Open question:** Should any aggregate be displayed publicly at all — and if several
  assessments of one relation exist (ORA-D01), is any per-relation summary permissible, or is
  the criterion profile list the only honest display?
- **Depends on it:** ORA-D02 display rules, ORA-D03 hardening, ORA-I01 export shape.

## 3. Non-compensatory criteria

- **Open question:** Are some TRUST criteria non-compensatory — i.e., can a `very-low` on
  `identityIntegrity` or `sourceAccess` be offset by high ratings elsewhere in any summary
  view, or must such criteria gate any summary entirely?
- **Depends on it:** any aggregate/summary display (§2); ORA-D02 disagreement weighting.

## 4. Assessor qualifications

- **Open question:** Does ORAtlas record or require any assessor qualification (human domain
  expertise, agent model identity/version), and is qualification displayed, required, or
  ignored? Current schema stores assessor type/id strings without semantics.
- **Depends on it:** ORA-D01 display ordering, ORA-D02 adjudication inputs.

## 5. Adjudication authority

- **Open question:** Who may adjudicate between disagreeing assessments and resolve
  challenges — editors only, designated adjudicators, review contributors ever? Can an
  adjudication itself be challenged?
- **Interim safe default (explicitly provisional):** ORA-E01/E02 build with editors-resolve
  and keep the authority check swappable; ORA-D02 does not start until this is decided.
- **Depends on it:** ORA-D02, ORA-E01, ORA-E02, ORA-F02.

## 6. Conflict-of-interest representation

- **Open question:** What COI declarations are collected (self-declared only?), on which
  records (assessments, adjudications, challenge resolutions, editorial decisions), how they
  display, and whether any COI ever blocks an action or is provenance-only.
- **Depends on it:** ORA-F02.

## 7. Assessment crosswalk policy

- **Current state:** No crosswalk exists; ORA-D04 will enforce that none is invented silently.
- **Open question:** Is a crosswalk between protocols (e.g., a future TRUST v2 ↔ v1, or
  FAIR-derived ↔ TRUST) ever permissible as an explicit, versioned, editorially-owned
  artifact — and if so, who authors and validates it? Native TRUST methodology is owned by
  `Neuronautix/ComputationalReviewTemplate_trust-knowledge`; any crosswalk touching it needs
  that project's involvement.
- **Depends on it:** ORA-D04 documentation section; any future protocol-evolution story.

## 8. Evidence independence

- **Current state:** Deterministic shared-source detection informs synthesis (PR #21).
- **Open question:** What is the endorsed definition of "independent evidence" beyond
  shared-DOI/dataset rules — shared authors? shared lab? derived datasets? — and may
  independence ever be presented as a computed property rather than raw shared-source facts?
- **Depends on it:** ORA-C02 scope ceiling, contradiction-map presentation.

## 9. Public versus private editorial data

- **Current state:** Synthesis records have a strict public allowlist / private denylist;
  other editorial data (submission notes, override rationales, moderation rationales) has
  conventions but no single ratified boundary document. The endpoint inventory and current
  behavior are recorded in `docs/editorial-visibility-audit.md`; that inventory does not
  ratify the conventions.
- **Choices requiring an explicit decision:**
  1. For submissions, decide separately whether status/timestamps, submitted and edited
     payloads, validation diagnostics, editor notes, rejection/change-request reasons, and
     accepted override check ids/rationales are public, participant-only, editor-only, or
     published only after acceptance.
  2. For formal review rounds, ratify whether reviewer identity/ORCID, recommendation, report
     body, author response, decision-letter body, editor identity, and COI statement are public;
     specify whether open rounds are embargoed and what event lifts the embargo.
  3. For public lifecycle and update records, ratify the visibility of correction/withdrawal/
     tombstone reasons, citation-status notes and resolution notes, replication withdrawal
     reasons, node-edge proposal rationales, and protocol-proposal resolution rationales.
  4. For community moderation and future challenge workflows, decide whether removed bodies,
     remover identity, removal/moderation rationale, challenge evidence, adjudicator identity,
     and adjudication rationale are public, redacted, participant-only, or editor-only.
  5. Decide whether COAR Notify activity ids are intentionally discoverable public objects or
     capability-like links, and which received headers/origin metadata may accompany them.
  6. Define audience changes after correction, withdrawal, tombstone, account deletion, and
     legal/privacy takedown, plus retention and export rules under
     `docs/operations/privacy-and-takedown.md`.
  7. Require one versioned public allowlist/private denylist (or an equally explicit policy)
     per ratified record family, including treatment of legacy rows and malformed data.
- **Invariant not awaiting a decision:** Expiring inspection capability tokens and raw
  `InspectionCapture.payloadJson` bytes are server-only. Public provenance may expose the
  already-established payload hash, but never the token or source bytes.
- **Depends on it:** ORA-F03 closure criteria, ORA-E02 moderation display, ORA-J01 leakage
  definitions.

## 10. Requirements for calling a protocol calibrated

- **Open question:** What evidence would justify describing any assessment protocol as
  "calibrated" (inter-assessor agreement data? benchmark sets? none, ever, within ORAtlas)?
  Until decided, no ORAtlas surface may use the word "calibrated" about any protocol.
- **Depends on it:** ORA-D02 disagreement-rate display, any protocol-metadata surface.
