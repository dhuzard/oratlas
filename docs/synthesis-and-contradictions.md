# Independence-aware synthesis and contradiction maps

Issue #5 prevents false consensus: counting the same underlying source twice, or
reading a scope difference as a contradiction. Every judgement is a deterministic
rule over declared identifiers and stored relations — no model decides independence
or contradiction. The engine lives in `@oratlas/knowledge` (`synthesize`), and the
web adapter is `apps/web/src/lib/synthesis.ts`.

## Evidence families

Cited works are grouped by union-find. Two works join the same **evidence family**
when they share a declared dataset/cohort accession, or one is a declared derivative
analysis (`derivedFromDois`) of the other. Independent evidence is then counted in
families, never raw citations, so ten papers reanalysing one dataset count as one
independent line of evidence.

This applies equally to graph-native nodes and legacy claim–citation reviews. Citation row IDs are
version-scoped, but canonical DOI, PMID, and OpenAlex aliases are compared across review versions.
Two legacy reviews citing the same work therefore expose that work in `sharedWorkKeys` and count it
as one evidence family; separate archive rows never imply independent replication.

## Circular citations

A citation whose DOI resolves to an archived (non-example) review version points back
into Atlas. Such citations are flagged and excluded from independent-evidence counts.
The seeded archive is entirely synthetic (every version DOI uses the reserved
`10.5555/` example prefix and is flagged non-resolvable), so no seeded citation is
circular; the logic is covered by `synthesis.test.ts` and activates only once real,
non-example review DOIs exist.

## Contradiction classification

Two claims are compared only when they read at least one **shared** evidence family in
opposite directions — claims whose evidence never overlaps are unrelated, not
contradictory. Each qualifying pair is classified:

- **genuine-contradiction** — shared evidence, opposite directions, no declared scope
  difference: a real disagreement.
- **scope-difference** — shared evidence in opposite directions, but the claims declare
  different `population`, `model`, `intervention`, `outcome` or `method`, so they may
  answer different questions.
- **undetermined-scope** — shared evidence in opposite directions, but at least one
  claim declared no scope, so a scope difference can be neither confirmed nor ruled out
  (never silently treated as a genuine contradiction).

Dataset accessions group works only when they look like identifiers (namespaced or
digit-bearing); low-entropy labels like "controls" never union unrelated works.

## Surfaces

- `/synthesis` — the public cross-review contradiction map.
- `GET /api/synthesis/contradictions` — the same data as JSON (no-store).
- Each claim passport shows an independence summary (supporting/opposing works vs
  independent families, shared works, circular citations) and its contradictions.

Comparison is over the current version of each review; passports of superseded
versions therefore render no independence card.

## Data

Claims may declare a `scope` and citations may declare `datasetIds` / `derivedFromDois`
(contracts `claimScopeSchema`, `citationRecordSchema`), stored on `Claim.scopeJson` and
`Citation.datasetIdsJson` / `derivedFromJson`. Absent declarations simply yield fewer
signals; the engine degrades to citation-level counting.
