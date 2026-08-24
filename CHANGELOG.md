# Changelog

All notable changes to Open Review Atlas are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). ORAtlas uses
version tags only to identify the exact platform code that emitted provenance records and
exports; this is intentionally not a broader compatibility promise.

## [Unreleased]

### Added

- Generic publication boundary for independently hosted scientific publications:
  `Publication`, `PublicationVersion`, `PublicationCapture` and `PublicationClaimOccurrence`,
  with contracts in `@oratlas/contracts` and framework-free domain logic in
  `@oratlas/publications`. `Review` becomes one supported publication type. Registration and
  fetching are not implemented; see `docs/external-publications.md`.
- Structural provenance vocabulary (`published-structure`, `source-byte`), which records what
  ORAtlas structurally checked and is never a scientific validation state.
- Expand-only external-publication source for the canonical graph's exact-version union.

## [0.1.0] - 2026-07-20

### Added

- Initial provenance release baseline for the public archive, editorial workflow, preservation
  exports, knowledge graph, TRUST records, synthesis pipeline, and operational tooling.
- Platform release versions on new audit events and machine-readable exports.

[Unreleased]: https://github.com/dhuzard/oratlas/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dhuzard/oratlas/releases/tag/v0.1.0
