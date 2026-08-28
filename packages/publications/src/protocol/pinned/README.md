# Pinned upstream protocol schemas

These two files are a **byte-exact capture** of the JSON Schemas published by
[`dhuzard/oratlas-myst`](https://github.com/dhuzard/oratlas-myst) at the pin recorded in
`CROSS_REPO_DEPENDENCIES.md`. They are not ORAtlas contracts and must never be edited: they
are here so ORAtlas's own reader can be tested against the producer's published definition
without CI reaching the network.

`protocol-drift.test.ts` asserts their digests and cross-checks every document ORAtlas
accepts or rejects against them. Re-pinning is a deliberate, reviewed re-capture: replace both
files, update the digests in the test and the pin table in `CROSS_REPO_DEPENDENCIES.md`, and
expect the cross-check to fail loudly if the producer contract moved.

This directory is excluded from formatting so the captured bytes stay exact.
