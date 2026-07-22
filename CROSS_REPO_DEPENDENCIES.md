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

## 2. Neuronautix/TRUST.md — native TRUST methodology and interchange convention

- **Repository:** `https://github.com/Neuronautix/TRUST.md` (immutable GitHub repository id
  `1261792093`).
- **Role:** Owns the human- and machine-readable TRUST assessment convention, its schemas,
  validation rules, lifecycle model, examples, migration guidance, and methodology text.
  ORAtlas owns the _archival representation_ and platform verification of TRUST records,
  never the upstream convention or its scoring guidance.
- **What ORAtlas consumes:** explicit protocol-version identity and validated source-native
  documents only. Structured ingestion must validate against a pinned upstream schema; prose
  is preserved but never interpreted into ratings or crosswalks.
- **Current pin:** annotated tag `v0.4.0-rc.1`; tag object
  `e2eecd709992d00e18799c12e5e1b3136dbd421e`; commit
  `354beab9732bc72e357507c3a3f4b2f67b3cfced`; tree
  `7d99eeb52252b56f469345a70c273c3484b3c6fe`; schema blob
  `schema/v0.4/trust.schema.json` at `e20dd44832409fbfb16783cd8d7fdc44aa26c124`.
- **Drift risk:** a protocol revision upstream (new criteria, changed rating scale) must
  arrive in ORAtlas as a **new protocol version**, coexisting with the old — never as a
  silent reinterpretation or crosswalk (ORA-D04; decision §7 in `ORATLAS_DECISIONS.md`).
- **Backlog links:** ORA-D04, ORA-A04; decisions §7, §10.
- **Coordination needed:** schema or crosswalk changes require validation with this
  repository's maintainers. ORAtlas may preserve arbitrary `TRUST.md`/`FAIR.md` bytes but may
  claim structured compatibility only for an explicitly pinned and validated protocol.

## 3. Neuronautix/ComputationalReviewTemplate_trust-knowledge — source-review TRUST v2

- **Role:** Owns the five-component Computational Review TRUST v2 rubric used by the Ethical
  Debt source review. It is distinct from both the standalone `Neuronautix/TRUST.md`
  convention and ORAtlas's relation-level TRUST protocol.
- **What ORAtlas consumes:** protocol identity and source attribution only. The Ethical Debt
  fixture's source assertions remain under this native protocol; ORAtlas preserves them and
  explicitly leaves its own non-equivalent criteria `not-assessed`.
- **Pinned baseline:** commit `165f336608eed7d22f6c6505da57a4e3577070cc`, as documented in
  `docs/assessment-protocol-interoperability.md`.
- **Crosswalk boundary:** there is no crosswalk among Computational Review TRUST v2,
  standalone TRUST.md, and ORAtlas TRUST. Any future crosswalk requires its own immutable,
  versioned artifact and participation by every affected methodology owner
  (`ORATLAS_DECISIONS.md` §7).

## 4. dhuzard/ethical-debt-AI-review — first reference review and integration fixture

- **Role:** The first real review intended for the archive, and the source of the frozen
  integration fixture (ORA-A03).
- **Repository:** `https://github.com/dhuzard/ethical-debt-AI-review` (immutable GitHub
  repository id `1291083149`).
- **Current state:** the fixture source is ratified by `ORATLAS_DECISIONS.md` §13 and checked in
  under `packages/extractor/src/fixtures/ethical-debt-v0.1.0-trust-preview.3`. Its manifest hash,
  offline transport, extractor path, and submission journey are covered by ORA-A03 tests.
- **Pin:** the artifact-bearing lightweight tag `v0.1.0-trust-preview.3` is frozen as follows:

  | Field                            | Value                                                              |
  | -------------------------------- | ------------------------------------------------------------------ |
  | GitHub repository id (immutable) | `1291083149`                                                       |
  | Release tag                      | `v0.1.0-trust-preview.3` (lightweight)                             |
  | Commit SHA                       | `955e2994e0c6a042be80851b2125c2064c211dcf`                         |
  | Tree hash                        | `095ceeb0ab7f5d9d3bc32f77869dcc856c707806`                         |
  | Source `TRUST.md` blob           | `29db889ac19ca7ab33e3ae7bc7a8637614989aaf`                         |
  | Source `FAIR.md` blob            | `9d164253a351b9083efe2f71089500051ba1a2fb`                         |
  | Review manifest blob             | `39c8ee17291f211713d94554174eb63734ef2c44`                         |
  | TRUST assessments JSONL blob     | `c3058ec573eeebba32c502b71986ba5084a08778`                         |
  | Fixture manifest SHA-256         | `9f13f8dfc35cca0cf0a602b3304bcc0c9fe94e751c448d020b63e789f27abb23` |

- **Rules:** the fixture is captured once at the pin via the ORA-K02 script and checked in;
  CI never contacts the live repository; updating the pin is a deliberate, reviewed re-capture
  with a new pin table appended above (history preserved, matching platform provenance norms). If
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
