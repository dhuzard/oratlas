# Offline MyST and verifier producer contracts

This is a bounded acceptance slice for [#221](https://github.com/dhuzard/oratlas/issues/221).
It complements the evidence-lineage lane for #198. It does not close #221: the
remaining capabilities below must be demonstrated before full acceptance.

Run `pnpm test:producer-contracts`. CI runs this command with no producer checkout,
Python runtime, live API, credentials, or network fixtures. Vitest emits a pass/fail
report with each negative case named. `fixtures/pins.json` records both immutable
producer commits, repository IDs, exact protocol versions, and every file SHA-256.
The lane also runs in the ordinary test suite.

| Producer               | Repository ID | Commit                                     | Protocol                               |
| ---------------------- | ------------- | ------------------------------------------ | -------------------------------------- |
| dhuzard/oratlas-myst   | 1343684403    | `51336a5446b449d4d661a4f46d8f8913a0bac2cb` | manifest/claim `0.2.0`                 |
| dhuzard/oratlas-verify | 1345833003    | `9b8455f5bfe9a411a7f1f06d13e4de97e539ac16` | `reported-statistic-consistency/0.1.0` |

The verifier declares ORAtlas API `1.0.0`, PublicationVersion packet `1.3.0`,
`verification-publication-input/1.0.0`, and ORAtlas commit
`999580bad1fee5b22e8113c5e1c7c9b888eb1217`. Its upstream integration document records
OpenAPI normalized-LF SHA-256
`6e3a2cff2d266e67bbf999186520bb404aea7921a9362a44e1fd2c47f14b0a26`.
The local frozen input is the producer's **mock API fixture**, not a captured response
from that ORAtlas deployment. No claim of live compatibility follows from it.

## What executes

- The unchanged MyST `examples/basic` source files and exact emitted manifest/JSONL
  pass through ORAtlas's real closed adapter and normalizer. Tests recompute document,
  block and claims-stream hashes and locate exact Unicode selector spans. Normalized
  results remain source occurrences and source declarations; no scientific verification
  or canonical graph identity is minted.
- This proves normalization of the pinned source declaration, not source-byte registration.
  The manifest declares a Git repository and commit, while each claim's `documentPath`
  (`index.md` or `results.md`) is relative to the MyST project root. In this capture that
  root is `examples/basic`, but the source descriptor has no root/subdirectory field; the
  registration resolver receives only the descriptor and those document paths. It cannot
  establish from the pinned declaration alone that `examples/basic` is the intended source
  root in the repository. The acceptance test also passes `structuralProvenance: "source-byte"`
  directly to the normalizer; it does not run registration with a Git source resolver. The
  fixture's copied source bytes do match the declared hashes/selectors, but no source-byte
  registration result is demonstrated until the source-root contract is unambiguous and a
  resolver journey is exercised.
- MyST rejections cover unsupported schema, missing/malformed claims, unsafe path,
  inconsistent selector span, duplicate ID, stale stream digest and missing stream.
- Verifier files contain actual execution output from the pinned producer's
  `tests/oratlas/test_client_e2e.py` `FakeORAtlas` fixture, using the real worker and SciPy.
  Capture used Python 3.12.3, oratlas-verify 0.1.1, SciPy 1.18.1, NumPy 2.5.4.
  The report preserves execution timestamps and environment as emitted. The finding
  passes ORAtlas's strict submission schema; the input's canonical digest and the
  report's input/protocol identity are checked. Request hashes bind the raw upload
  to the exact report bytes. Non-finite results and forged certification fields fail.
- The existing SQLite service and HTTP-client acceptance test transfers those exact
  report bytes through prepare/upload/complete. It also tests request/finding replay,
  conflicting replay, immutable input guards, invalid/expired leases, lifecycle, and
  public projection. This transfer is a separate synthetic ORAtlas run: it does not
  claim that the captured scientific report was computed against that run's input.

Verification findings remain evidence. Certification belongs to ORAtlas; unknown
certification fields are rejected by its closed finding contract.

## Capture and producer-owned checks

Capture is a deliberate local operation, never part of CI. Do not silently move pins,
rewrite producer source, or vendor an executor. The source examples are from the
MyST producer's MIT-licensed repository; its license is retained beside the fixture.
The verifier declares Apache-2.0 in its pinned `pyproject.toml`; only synthetic data
and emitted outputs are retained here, with no producer runtime source.

For MyST, use a clean checkout at its pin, `pnpm install --frozen-lockfile`, then:

```sh
pnpm exec tsx src/cli/main.ts export --project examples/basic --source-commit 51336a5446b449d4d661a4f46d8f8913a0bac2cb
```

Copy unchanged `examples/basic/{index.md,results.md,myst.yml,oratlas.yml,references.bib}`
into `fixtures/myst/source`, `.oratlas/oratlas.manifest.json` to `manifest.json`, and
`.oratlas/oratlas/claims.jsonl` to `claims.jsonl`. Paths above are relative to
`scripts/producer-contracts`. The manifest and JSONL bytes are copied without parsing
or formatting. Producer-side checks: `tests/export.test.ts`, `tests/contracts.test.ts`,
`tests/validate.test.ts`, `tests/publication.test.ts` at the pin.

For the verifier, install its dev requirements in an isolated environment, then run:

```sh
python scripts/producer-contracts/capture-verifier.py /path/to/pinned/oratlas-verify
```

The capture script refuses a different commit or dirty tracked source. Review the
changed outputs and manually update `fixtures/pins.json` hashes. Timestamps make a
fresh capture a new artifact; the acceptance command always tests committed bytes.
Producer-owned checks: `tests/oratlas/test_client_e2e.py`,
`tests/oratlas/test_mapping.py`, and `integration/oratlas/acceptance.py` at the pin.

## Remaining capabilities

- Exercise the pinned real external worker against a frozen ORAtlas API server in an
  offline cross-language lane, rather than treating the producer mock as an API proof.
  The existing producer integration does this in its own repository; this ORAtlas
  slice only checks its emitted contract and ORAtlas's independent lifecycle seam.
- Add a published MyST inventory/page capture and full registration source resolver
  journey. The example exporter does not emit those build artifacts. Inconsistent
  selector lengths are covered; ambiguous inventory/citation targets and source-context
  ambiguity are not demonstrated by this capture. The source-root limitation above also
  means this fixture does not prove that registration can obtain the pinned `examples/basic`
  source documents from its repository descriptor.
- Execute unknown protocol and changed input digest rejection in the ORAtlas-owned
  cross-language lane. These are producer-owned checks today; schema/digest equality
  assertions alone do not execute the external worker's rejection path.
- Add evidence that producer computation is read-only against the actual frozen API
  input. The captured bytes and upstream boundary establish no database-side authority,
  but do not prove a fresh execution against ORAtlas's own frozen input.

## Rollback

Revert this acceptance-only change to remove the dedicated command, CI step and
fixtures. It adds no production routes, runtime dependencies, migrations or writes
to user data; existing lifecycle tests return to their prior inert test artifact.

## Recorded validation

On 2026-10-21, Node 24.16.0, the focused command passed **15 tests in 2 files**:
13 immutable capture/negative tests and 2 SQLite service/HTTP lifecycle tests. These
results apply to this slice; required full CI, PostgreSQL and security checks remain
merge gates and are not replaced by the focused command.

No producer source or captured producer bytes were changed for this documentation update.
