## Summary

Offline source-credit implementation and repair across two commits (b6381a1 + 91e557a):

**b6381a1 — 0.2.0 implementation:** Versioned source-credit observations with structured native provenance. Adapters emit oratlas.source-credit-observations/0.2.0 (legacy 0.1.0 kept unchanged, version-gated). Adds:
- Contract: producer pins (contract + commit + id prefix), ORCID checksum/status/evidence agreement, example-DOI flag, roster member-field redaction and offline elevation rules, sorted unique collision-free IDs, report count consistency, separate legacy-label counts, producer-declared omissions
- Diggypaper: frozen shape constants, producer/audience/release/export-status provenance, finding origin, snapshot ref, rights, agent type, contribution ID distinct from person ID
- CRT: passage disclosure, assessment protocol/status/curator pseudonym, structured mapping decision, disclosure facts, agent ID distinct from run, legacy role labels preserved and counted
- ORCID: frozen validate_export consent/redaction/elevation rules, ORCID status and assertion provenance, output DOI/rights on credit claims
- 13 PINS byte-pinned fixture/schema files, full goldens, nested-permutation and negative tests

**91e557a — Repairs:** Two findings from prior review:
1. **Diggypaper entry IDs:** Added `sourceEntryId: bounded.nullable()` to 0.2.0 evidence. Diggypaper emits native `entries[].entry_id`; CRT emits `null`. Maintains granular author credit provenance without breaking compatibility.
2. **ORCID empty strings:** Removed extra `minLength: 1` constraints rejecting frozen-schema-valid documents. Empty fields become `null` before validation, never substantiating verification. Neutral contract output remains non-empty.

**Migration:** 0.2.0 has explicit version gate; 0.1.0 unchanged and valid.

Refs #209, #198, #199, #204, #206. Note: #198/#199 existing integration is not blocked/unblocked by #209. #204/#206 require owner §14 ratification (independent prerequisite for private workspaces and real data). #203 local identity, workspace grants/source entitlements/revocation/processing/release security evidence and D11 counsel/DPIA before real private data. G4 synthetic only; real curation/rights and browser gaps remain. No runtime activated.

## Testing

**Full suite (236 test files, 1851 tests):** lint, typecheck, schema-check, openapi-check all pass. No regressions.

**Focused integration (87 tests):**

```bash
pnpm exec vitest run packages/extractor/src/evidence-lineage.test.ts \
  apps/web/src/lib/crt-diggypaper-lineage.integration.test.ts \
  apps/web/src/components/SourceEvidenceLinksCard.test.tsx \
  scripts/evidence-lineage/verify-fixture.test.ts
pnpm evidence-lineage:verify  # 21 files verified
```

Result: all pass. Fixture byte-pins (Diggypaper, CRT, ORCID) match upstream exactly.

**Build:** PASSED with CI environment (NEXT_PUBLIC_BASE_URL set). Initial failure due missing Prisma client resolved on parent re-run. CSS ::highlight warning non-fatal. See `/tmp/oratlas209-validation/ci-build.log`.

## Validation evidence

See `docs/source-credit-209-validation.md` for full review findings, repair details, and risk assessment.

## Rollback

Straightforward via normal reviewed revert of whole implementation+repair changes. No need regenerate goldens. No migrations, no breaking API changes.

---

To create and push this PR:

```bash
git push <GitHub remote URL> pico/batch-209-offline:pico/batch-209-offline
gh pr create --repo dhuzard/oratlas --draft --base main --head pico/batch-209-offline \
  --title 'Offline source-credit crosswalk: pinned provenance and golden regressions' \
  --body-file docs/source-credit-209-draft-pr.md
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
