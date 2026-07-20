# Cross-repository dependencies

ORAtlas archives and reviews artifacts produced elsewhere. This file tracks what this repository
depends on in each upstream, how the dependency is consumed, and the exact pins used by
deterministic fixtures. **ORAtlas never vendors or duplicates upstream code** (see the
ownership boundary in `ORATLAS_BACKLOG.md` non-goals): dependencies are on published file
conventions and frozen content captures only. CI is fully offline; live upstream access happens
only in local capture scripts (ORA-K02).

## 1. AllenNeuralDynamics/ComputationalReviewTemplate — review production

- **Role:** The upstream template that compatible review repositories are built with, forked
  from, or structurally compatible with. ORAtlas does not own or reimplement review
  production, MyST authoring, or evidence-package generation.
- **What ORAtlas consumes:** file conventions only — `myst.yml`, `content/`, bibliography,
  `evidence/`, `provenance/`, `skills/`, `plugins/`, release/DOI conventions. These drive the
  deterministic compatibility signals in `packages/extractor/src/compatibility.ts`
  (template full name is matched literally: `allenneuraldynamics/computationalreviewtemplate`).
- **Last structural inspection:** 2026-07-10 (recorded in `PLAN.md`).
- **Drift risk:** template layout changes silently degrade compatibility classification for
  new submissions (existing accepted versions are immutable and unaffected). Mitigation:
  re-inspection notes in `PLAN.md`; per-facet compatibility (ORA-A01) reduces blast radius.
- **Backlog links:** ORA-A01, ORA-A04 (TRUST.md/FAIR.md conventions, issue #18).

## 2. Neuronautix/ComputationalReviewTemplate_trust-knowledge — native TRUST methodology

- **Role:** Owns the native Computational Review TRUST methodology. ORAtlas owns the
  _archival representation_ of TRUST records (criteria, statuses, provenance, verification
  markers), never the methodology, its rubric text, or its scoring guidance.
- **What ORAtlas consumes:** the record semantics behind `TRUST_CRITERIA`
  (`packages/contracts`), `protocolVersion` identity, and the JSONL record forms documented
  in `docs/trust-model.md` and `docs/review-manifest.md`.
- **Drift risk:** a protocol revision upstream (new criteria, changed rating scale) must
  arrive in ORAtlas as a **new protocol version**, coexisting with the old — never as a
  silent reinterpretation or crosswalk (ORA-D04; decision §7 in `ORATLAS_DECISIONS.md`).
- **Backlog links:** ORA-D04, ORA-A04; decisions §7, §10.
- **Coordination needed:** any structured ingestion of TRUST.md/FAIR.md (issue #18) should be
  validated against this repository's definitions before contracts encode semantics.

## 3. dhuzard/ethical-debt-AI-review — first reference review and integration fixture

- **Role:** The first real review intended for the archive, and the source of the frozen
  integration fixture (ORA-A03).
- **Current state in this repo:** **no references exist yet** — no fixture, no test, no doc
  mention. The integration is entirely outstanding.
- **Pin:** _not yet chosen._ To be recorded here when ORA-A03 starts, as:

  | Field                            | Value |
  | -------------------------------- | ----- |
  | GitHub repository id (immutable) | TBD   |
  | Release tag                      | TBD   |
  | Commit SHA                       | TBD   |
  | Tree hash                        | TBD   |
  | Fixture manifest SHA-256         | TBD   |

- **Rules:** the fixture is captured once at the pin via the ORA-K02 script and checked in;
  CI never contacts the live repository; updating the pin is a deliberate, reviewed re-capture
  with a new row appended above (history preserved, matching platform provenance norms). If
  the live repository's artifacts are only partially compatible, the fixture asserts that
  honest report — it is not "fixed up".
- **Backlog links:** ORA-A03, ORA-K02, ORA-A02.

## Consumption principles (all upstreams)

1. Conventions in, never code in: ORAtlas reads file layouts and record formats; it does not
   import upstream implementations.
2. Every deterministic test pin is recorded here with immutable identifiers (repo id + commit
   SHA at minimum) and content hashes.
3. Upstream drift creates new records/versions on the ORAtlas side; it never rewrites
   existing classifications, assessments, or fixtures.
4. Suggestions back upstream (e.g. issue #18's "suggest improvements") are relayed by a
   maintainer; ORAtlas agents do not open issues/PRs on upstream repositories.
