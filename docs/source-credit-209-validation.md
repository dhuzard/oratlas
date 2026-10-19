# Offline source-credit validation: #209 implementation and repair evidence

**Branch commits:** `b6381a1` (feat: 0.2.0 implementation) + `91e557a` (fix: Diggypaper entry IDs and ORCID empty strings)

**Test suite:** all integration + unit passed; 236 test files, 1851 tests (6 skipped files, 16 skipped tests). No regressions.

## b6381a1: 0.2.0 implementation (versioned source-credit observations)

Adapters now emit `oratlas.source-credit-observations/0.2.0` with structured native provenance. Legacy 0.1.0 schema unchanged and version-gated (each schema rejects the other's version).

**Contract (packages/contracts/src/source-credit-observations.ts):**
- Producer pins enforced (contract + commit + ID prefix)
- ORCID checksum validation and status/evidence agreement
- Example-DOI flagging
- Roster member-field redaction and offline elevation rules
- Sorted unique collision-free IDs
- Report count consistency, separate legacy-label counts
- Producer-declared omissions and explicit omitted-field codes

**Diggypaper (packages/knowledge/src/source-credit-diggypaper.ts):**
- Strict frozen shape and constants (implies_authorship false)
- Producer/audience/release/export-status provenance
- Finding origin, snapshot ref, rights, agent type
- Contribution ID distinct from person ID
- FCC_validate identity/privacy subset

**CRT (packages/knowledge/src/source-credit-crt.ts):**
- Passage disclosure, assessment protocol/status/curator pseudonym
- Structured mapping decision, disclosure facts
- Agent ID distinct from run
- Legacy role labels preserved and counted

**ORCID (packages/knowledge/src/source-credit-orcid.ts):**
- Frozen validate_export consent/redaction/elevation rules
- ORCID status and assertion provenance
- Output DOI/rights on credit claims
- Agreement with producer's candidate_contacts reading

**Fixtures:**
- `packages/knowledge/src/fixtures/source-credit-interop/PINS.json`: 13 byte-manifest files (ORCID verified at ff5aff9)
- Golden outputs: `packages/knowledge/src/fixtures/source-credit-interop/golden/{diggypaper,crt,orcid}.observations.json`
- Nested-permutation and negative test cases

## 91e557a: Two findings from prior review (repaired)

### 1. Diggypaper native entry IDs were lost in 0.2.0 projection

**Finding:** The 0.2.0 evidence schema did not include the native `Diggypaper.entries[].entry_id` field. Downstream consumers lost the granular provenance link to the exact author credit assignment.

**Repair:** Added `sourceEntryId: bounded.nullable()` as a required field in both Diggypaper and CRT projections (0.2.0). Diggypaper now emits the native `entry_id`; CRT emits `null`. Observation counts and report identifiers are unchanged. Goldens regenerated (field addition only).

**Evidence:**

- `packages/knowledge/src/source-credit-diggypaper.ts` — emit `sourceEntryId`
- `packages/knowledge/src/source-credit-crt.ts` — emit `sourceEntryId` (null case)
- `packages/contracts/src/source-credit-observations.ts` — schema field added
- `packages/knowledge/src/fixtures/source-credit-interop/golden/{diggypaper,crt}.observations.json` — exact byte golden regenerated

### 2. ORCID roster: frozen-schema-valid empty strings rejected by adapter

**Finding:** The roster schema allows empty `source_record_version`, `reference`, `display_name`, and `local_role` fields. The adapter enforced extra `minLength: 1` constraints not present in the frozen schema, rejecting valid documents.

**Repair:** Dropped extra min-length rules from ORCID evidence adapter. The frozen schema digest check and redaction occur on the original document. Empty strings then become `null` before the remaining rules and output. An empty reference never substantiates verification or provenance. The neutral contract output remains non-empty.

**Evidence:**

- `packages/knowledge/src/source-credit-orcid.ts` — minLength constraints removed, empty→null logic explicit
- `packages/knowledge/src/source-credit-observations.test.ts` — added 94 lines of test cases for empty field handling
- `packages/knowledge/src/source-credit-adapters.test.ts` — 164 lines of integration tests covering all three adapters

## Verification scope and commands

All integration and unit tests passed in local replay:

```bash
pnpm exec vitest run packages/extractor/src/evidence-lineage.test.ts apps/web/src/lib/crt-diggypaper-lineage.integration.test.ts apps/web/src/components/SourceEvidenceLinksCard.test.tsx scripts/evidence-lineage/verify-fixture.test.ts
pnpm evidence-lineage:verify
```

**Result:** 87 integration tests passed; fixture verification passed (21 files).

**Full suite results at 91e557a:**

| Phase         | Result    | Details                                                                        |
| ------------- | --------- | ------------------------------------------------------------------------------ |
| Lint          | ✓ Pass    | No violations                                                                  |
| Typecheck     | ✓ Pass    | All 19 workspace projects                                                      |
| Test          | ✓ Pass    | 236 files / 1851 tests (6 skipped / 16 skipped)                                |
| Schema check  | ✓ Pass    | All contracts validated                                                        |
| OpenAPI check | ✓ Pass    | API specs valid                                                                |
| Build         | ✓ Pass    | CI env: `NEXT_PUBLIC_BASE_URL=https://ci.oratlas.example`; CSS ::highlight warning non-fatal |

## Architectural advisory (non-blocking)

**ARCHITECTURAL_DEBT:** The neutral 0.2.0 schema permits `sourceEntryId: null` on manually constructed documents without producer validation. Adapters generate consistent values (Diggypaper native ID or CRT null). No runtime inconsistency in adapter output; mitigation is documentation + manual code review for synthetic sources.

## Bounded risks; rollback: straightforward

**Risk boundaries:**
- Partial native semantic validators: 0.2.0 schema permits `sourceEntryId: null` on manually constructed documents without producer validation. Adapters generate consistent values (Diggypaper native ID or CRT null). No runtime inconsistency in adapter output; mitigation is documentation + manual code review for synthetic sources.
- CRT lineage and packet bytes not recomputed in repair. Only evidence projection fields affected.
- Nullable sourceEntryId advisory: field can be null; downstream consumers must handle gracefully.
- No runtime assurances: schema validation occurs at adapter output; no runtime enforcement of producer promise.

**Stability:**
- No schema version bumps on native contracts (Diggypaper/CRT/ORCID producers unchanged)
- Evidence 0.2.0 is additive: 0.1.0 remains unchanged and valid
- Goldens are exact byte matches to pinned upstream commits (Diggypaper `a34d18f`, CRT `a19a8dc`, ORCID `ff5aff9`)
- No migration, no breaking changes to public APIs

**Rollback:** Revert whole implementation+repair changes via normal reviewed revert. No need regenerate goldens.

---

**Status:** Offline mapping and golden fixtures validated. Local-only branch with test results and golden evidence. Not ready for merge. Further work (#204/#206) requires owner §14 ratification for private workspaces and real data. #203 local identity, workspace grants/source entitlements/revocation/processing/release security evidence and D11 counsel/DPIA before real private data. No runtime activated.
