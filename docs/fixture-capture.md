# Frozen GitHub fixture capture

`pnpm capture:fixture` records exactly the bounded bytes the production GitHub inspector reads.
It is a maintainer-run, live-network tool; CI consumes the result and never contacts GitHub.

```bash
pnpm capture:fixture --repo owner/repository --release v1.0.0 --out packages/example/test/fixtures/v1
pnpm capture:fixture --repo owner/repository --tag v1.0.0 --out packages/example/test/fixtures/v1
pnpm capture:fixture --repo owner/repository --commit 0123456789abcdef0123456789abcdef01234567 --out packages/example/test/fixtures/commit
```

Set `GITHUB_TOKEN` for private rate-limit capacity. Private repositories remain refused. The tool
never clones or executes repository code and inherits the inspector's caps: 2 MiB per file, 6 MiB
total fetched content, 24 content files, and 5,000 tree entries. Routed artifacts are discovered
through the same staged manifest logic as production.

Each output directory contains:

- `fixture.json`: timestamp-free requested pin, repository identity, exact source commit/tree/tag identity,
  bounded tree metadata, fetched UTF-8 bytes, and inspector limits;
- `hashes.json`: the SHA-256 of every fetched file plus a canonical manifest SHA-256 binding the
  repository, exact source commit/tree, bounded tree metadata, file hashes, warnings, and limits;
- `transport.ts`: ready-to-import mock transport wiring for offline tests.

Re-running against the same immutable pin and unchanged GitHub object bytes produces identical
files. Tests must call `verifyCapturedFixture` (the generated transport does this automatically),
so byte or hash-manifest drift fails before inspection. The fixture is intentionally not a clone:
unfetched repository blobs are represented only by bounded tree path/size metadata.
