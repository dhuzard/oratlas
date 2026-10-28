# Changelog

All notable changes to Open Review Atlas are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). ORAtlas uses
version tags only to identify the exact platform code that emitted provenance records and
exports; this is intentionally not a broader compatibility promise.

## [Unreleased]

### Added

- Private project descriptor observations 0.2.0 (#206): `adaptDiggypaperProjectDescriptor`
  consumes a digest-pinned capture of Diggypaper's live connector (descriptor and restricted
  evidence packet, synthetic project data) and replaces the synthetic Diggypaper fixture. It
  refuses expired descriptors, other recipients and held packet bytes that do not match the
  listed digest. Offline only; 0.1.0 and the CRT adapter are unchanged. See
  `docs/private-project-descriptor-observations.md`.
- Cross-repository evidence-lineage regression (MVP v0.1 Gate G4, issue #198): a digest-pinned,
  offline fixture built from exact Diggypaper and ComputationalReviewTemplate revisions; a
  read-time `sourceEvidenceLinks` projection of the review's preserved source-native sidecar on the
  claim passport API and page; `auditSourceEvidencePacket` for CI; and
  `pnpm evidence-lineage:verify`. No schema change and no change to ingestion. See
  `docs/cross-repo-evidence-lineage.md`.
- Generic publication boundary for independently hosted scientific publications:
  `Publication`, `PublicationVersion`, `PublicationCapture` and `PublicationClaimOccurrence`,
  with contracts in `@oratlas/contracts` and framework-free domain logic in
  `@oratlas/publications`. `Review` becomes one supported publication type. Registration and
  fetching are not implemented; see `docs/external-publications.md`.
- Structural provenance vocabulary (`published-structure`, `source-byte`), which records what
  ORAtlas structurally checked and is never a scientific validation state.
- Expand-only external-publication source for the canonical graph's exact-version union.

### Fixed

- `review-manifest.schema.json` now accepts the `ai-synthesis` and `data-release` review types
  the runtime manifest schema already accepted; `schema:check` fails if the two enums drift.

## [0.1.0] - 2026-07-20

### Added

- Initial provenance release baseline for the public archive, editorial workflow, preservation
  exports, knowledge graph, TRUST records, synthesis pipeline, and operational tooling.
- Platform release versions on new audit events and machine-readable exports.

[Unreleased]: https://github.com/dhuzard/oratlas/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dhuzard/oratlas/releases/tag/v0.1.0
