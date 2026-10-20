# Offline source-credit validation: #209 implementation and repair evidence

**Branch commits:** `b6381a1` (feat: 0.2.0 implementation) + `91e557a` (fix: Diggypaper entry IDs and ORCID empty strings)

**Test suite:** all integration + unit passed; 236 test files, 1851 tests (6 skipped files, 16 skipped tests). No failures in the executed checks; skipped coverage is not claimed.

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

**Finding:** The 0.2.0 evidence schema did not include the native `Diggypaper.entries[].entry_id` field. Downstream consumers lost the native credit-entry provenance link (not an authorship assignment).

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
- `packages/contracts/src/source-credit-observations.test.ts` — contract regression cases for nullable/native fields
- `packages/knowledge/src/source-credit-adapters.test.ts` — entry-ID preservation and native-schema-valid ORCID empty-string regressions

## Verification scope and commands

All integration and unit tests passed in local replay:

```bash
pnpm exec vitest run packages/extractor/src/evidence-lineage.test.ts apps/web/src/lib/crt-diggypaper-lineage.integration.test.ts apps/web/src/components/SourceEvidenceLinksCard.test.tsx scripts/evidence-lineage/verify-fixture.test.ts
pnpm evidence-lineage:verify
```

**Result:** 87 integration tests passed; fixture verification passed (21 files).

**Full suite results at 91e557a:**

| Phase         | Result | Details                                                                                      |
| ------------- | ------ | -------------------------------------------------------------------------------------------- |
| Lint          | ✓ Pass | No violations                                                                                |
| Typecheck     | ✓ Pass | All 19 workspace projects                                                                    |
| Test          | ✓ Pass | 236 files / 1851 tests (6 skipped / 16 skipped)                                              |
| Schema check  | ✓ Pass | All contracts validated                                                                      |
| OpenAPI check | ✓ Pass | API specs valid                                                                              |
| Build         | ✓ Pass | CI env: `NEXT_PUBLIC_BASE_URL=https://ci.oratlas.example`; CSS ::highlight warning non-fatal |

## Resume validation

Parent run `run-0cf0d1577248` rechecked the formatted delivery docs with Prettier (pass) and reran the following checks using the existing dependencies in `/tmp/oratlas-209-work`:

```bash
./node_modules/.bin/vitest run packages/contracts/src/source-credit-observations.test.ts packages/knowledge/src/source-credit-adapters.test.ts
./node_modules/.bin/vitest run packages/extractor/src/evidence-lineage.test.ts apps/web/src/lib/crt-diggypaper-lineage.integration.test.ts apps/web/src/components/SourceEvidenceLinksCard.test.tsx scripts/evidence-lineage/verify-fixture.test.ts
./node_modules/.bin/tsx scripts/evidence-lineage/verify-fixture.ts
```

Results: 186 source-credit tests and 87 lineage tests passed; fixture verification passed (21 files). `git diff 91e557a..HEAD -- packages apps scripts` was empty, establishing code identity with the validation worktree. Logs are in `/tmp/oratlas209-resume-validation/fresh-{source-credit,lineage,fixture}.log`. The initial resume attempt lacked `pnpm`; the successful commands above used the installed executables directly. The lineage test emitted the development-only missing-session-secret warning; no server was deployed.

The full suite, lint, typecheck, schema/OpenAPI checks and production build were **not rerun** on resume: their saved logs above were inspected. Browser E2E remains unexecuted. Publication is owner-run only; no push or PR creation was performed.

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
- Adapters explicitly return 0.2.0; existing strict 0.1.0 schema remains unchanged. Consumers must select the correct version.
- PINS binds native fixture/schema bytes to upstream commits (Diggypaper `a34d18f`, CRT `a19a8dc`, ORCID `ff5aff9`). Goldens are generated ORAtlas normalized expected outputs, not upstream files.
- No migration, no breaking changes to public APIs

**Rollback:** Revert whole implementation+repair changes via normal reviewed revert. No need regenerate goldens.

---

Initial full checks failed because the Prisma client was absent; after `pnpm --filter @oratlas/db db:generate`, typecheck and tests passed. Build then required production configuration and passed with the CI environment:

```bash
CI=true NEXT_TELEMETRY_DISABLED=1 SESSION_SECRET=backup-restore-build-secret NEXT_PUBLIC_BASE_URL=https://ci.oratlas.example pnpm --filter @oratlas/web build
```

Browser E2E was not run; no web/runtime code changed. The lineage proof remains synthetic, including 24 pilot Phase 2 exemptions and unresolved real-corpus rights/workflow gaps. No MVP release is claimed. Merge #216 is not owner ratification; no private storage/endpoints, cross-project processing or external-model transmission were enabled.

**Status:** Offline mapping and golden fixtures validated. Local-only branch with test results and golden evidence. Not ready for merge. Further work (#204/#206) requires owner §14 ratification for private workspaces and real data. #203 local identity, workspace grants/source entitlements/revocation/processing/release security evidence and D11 counsel/DPIA before real private data. No runtime activated.
