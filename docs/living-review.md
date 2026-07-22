# Claim passports and living-review monitoring

Closed implementation [issue #3](https://github.com/dhuzard/oratlas/issues/3) made individual
claims citable, inspectable and update-aware. The behavior below is shipped.

## Claim passports

Every claim of every readable immutable version has a stable passport at
`/claims/{versionId}/{localClaimId}` (JSON at `/api/claims/{versionId}/{localClaimId}`):
identity (version-scoped global claim id), the exact evidence selectors the repository
provided (`sourceLocation`), TRUST presence, deterministic lineage across the review's
versions (same repository-local claim id; text changes surfaced, never inferred), and any
evidence alerts. Passports of tombstoned versions fail closed.

## Evidence monitoring

Editors register externally observed changes to cited works
(`POST /api/monitoring/citation-status`): retracted, corrected, expression-of-concern or
new-evidence, keyed by canonical work aliases (`doi:…`, `pmid:…`, `openalex:…`). The
platform deterministically finds every claim whose evidence cites that work and opens one
`ClaimUpdateProposal` per claim — **conclusions are never rewritten automatically**. Each
proposal is resolved by an editor with an attributable note (updated / no action /
dismissed); signals and resolutions are append-only and audited.

In the POC, signals arrive through the editor API/dashboard; automated registry polling
(Crossref retraction watch, PubMed correction feeds) remains outside the POC. It was discussed in
the now-closed production-readiness umbrella [issue #7](https://github.com/dhuzard/oratlas/issues/7)
but was not implemented by closing that issue. The
signed release compiler and reproducibility attestations belong to the template toolchain
and are likewise out of the archive POC.

## Living-review CI

`GET /api/reviews/{slug}/update-proposals` is a public, no-store endpoint returning
`{ openCount, proposals[] }`. An upstream review repository can gate its release workflow:

```yaml
- name: Fail if evidence alerts are open
  run: |
    count=$(curl -fsS "$ATLAS_URL/api/reviews/$SLUG/update-proposals" | jq .openCount)
    test "$count" -eq 0
```

A retracted source therefore blocks new releases of the review until an editor has
explicitly decided what it means for the affected claims.
