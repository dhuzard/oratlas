# Offline source-credit validation: #209 repair and evidence

**Commit:** `91e557a0a096475fc350c1dfdbf8efb66b14d651` (`fix(knowledge): keep Diggypaper entry ids and accept frozen-valid empty ORCID strings`)

**Test suite:** all integration + unit passed; 236 files, 1851 tests (6 skipped, 16 skipped respectively). No regressions.

## Two findings from prior review (repaired in 91e557a)

### 1. Diggypaper native entry IDs were lost in 0.2.0 projection

**Finding:** The 0.2.0 evidence schema did not include the native `Diggypaper.entries[].entry_id` field. Downstream consumers lost the granular provenance link to the exact author credit assignment.

**Repair:** Added `sourceEntryId: bounded.nullable()` as a required field in both Diggypaper and CRT projections (0.2.0). Diggypaper now emits the native `entry_id`; CRT emits `null`. Observation counts and report identifiers are unchanged. Goldens regenerated (field addition only).

**Evidence:**

- `packages/knowledge/src/source-credit-diggypaper.ts` — emit `sourceEntryId`
- `packages/knowledge/src/source-credit-crt.ts` — emit `sourceEntryId` (null case)
- `packages/contracts/src/source-credit-observations.ts` — schema field added
- `packages/knowledge/src/fixtures/golden/{diggypaper,crt}.observations.json` — exact byte golden regenerated

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

**Full suite results (15:49–15:50 UTC):**

| Phase         | Result    | Details                                                                        |
| ------------- | --------- | ------------------------------------------------------------------------------ |
| Lint          | ✓ Pass    | No violations                                                                  |
| Typecheck     | ✓ Pass    | All 19 workspace projects                                                      |
| Test          | ✓ Pass    | 236 files / 1851 tests (6 skipped / 16 skipped)                                |
| Schema check  | ✓ Pass    | All contracts validated                                                        |
| OpenAPI check | ✓ Pass    | API specs valid                                                                |
| Build         | ⚠ Pending | `NEXT_PUBLIC_BASE_URL` env var required in production build — not a code issue |

## Architectural advisory (non-blocking)

**ARCHITECTURAL_DEBT:** The neutral 0.2.0 schema permits `sourceEntryId: null` on manually constructed documents without producer validation. Adapters generate consistent values (Diggypaper native ID or CRT null). No runtime inconsistency in adapter output; mitigation is documentation + manual code review for synthetic sources.

## Risk: none; rollback: straightforward

- No schema version bumps on native contracts (Diggypaper/CRT/ORCID producers unchanged)
- Evidence 0.2.0 is additive: 0.1.0 remains unchanged and valid
- Goldens are exact byte matches to pinned upstream commits (Diggypaper `a34d18f`, CRT `a19a8dc`, ORCID `ff5aff9`)
- No migration, no breaking changes to public APIs
- Rollback: revert commit, regenerate goldens from 0.2.0 schema pre-patch

---

**Status:** Offline mapping and golden fixtures validated. Ready for PR review and merge to `main`. Further work (#204/#206) is prerequisite for activating private workspaces and real data ingestion.
