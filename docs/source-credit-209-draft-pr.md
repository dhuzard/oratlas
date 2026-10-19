## Summary

Repair two findings from offline source-credit adapter review (#209):

1. **Diggypaper native entry IDs preserved:** Added `sourceEntryId: bounded.nullable()` field to 0.2.0 evidence projection. Diggypaper emits the native `entries[].entry_id`; CRT emits `null`. Maintains granular author credit provenance without breaking compatibility.

2. **ORCID roster: accept frozen-schema-valid empty strings:** Removed extra `minLength: 1` constraints that rejected documents valid under the pinned frozen schema. Empty fields become `null` before validation, never substantiating verification. Neutral contract output remains non-empty.

Both repairs are **additive and non-breaking:**

- Evidence 0.2.0 schema unchanged except for new field (0.1.0 legacy untouched)
- No producer contract changes (Diggypaper/CRT/ORCID pins stable)
- Goldens regenerated from exact upstream commits; byte-pins verified

Fixes #209. Unblocks #198 #199 (existing integrations). Prerequisites #204 #206 remain for private workspaces and real data.

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

**Build:** Pending. Requires `NEXT_PUBLIC_BASE_URL` env var (not a code issue).

## Validation evidence

See `docs/source-credit-209-validation.md` for full review findings, repair details, and risk assessment.

## Rollback

Straightforward: revert commit, regenerate 0.2.0 goldens. No migrations, no breaking API changes.

---

To create and push this PR:

```bash
git push <GitHub remote URL> pico/batch-209-offline:pico/batch-209-offline
gh pr create --repo dhuzard/oratlas --draft --base main --head pico/batch-209-offline \
  --title 'Offline source-credit crosswalk: pinned provenance and golden regressions' \
  --body-file docs/source-credit-209-draft-pr.md
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
