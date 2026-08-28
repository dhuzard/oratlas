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
- Registration and immutable capture of externally hosted publications:
  `POST /api/editorial/publications/register` accepts a manifest URL, retains exactly the
  bytes ORAtlas saw with recomputed digests, validates them fail-closed against publication
  protocol `0.2.0`, records the structural provenance level reached, and materializes
  publication, version and source-occurrence records. No external code, MyST plugin, HTML or
  JavaScript is executed and no repository is cloned. Canonical claim materialization is not
  implemented; see `docs/external-publications.md`.
- `@oratlas/safe-fetch`: the single hardened outbound HTTP boundary — https-only by default,
  refusal of loopback, private, link-local, cloud-metadata and internal-DNS destinations,
  connect-time classification of every resolved address, bounded redirects with each hop
  re-admitted, byte caps, connect/read/total timeouts and fail-closed content-type checking.
  `@oratlas/zenodo` now delegates its DOI redirect-target safety to it.
- `PublicationRegistration` and `PublicationRegistrationCapture`, append-only on both
  providers, with the capture's binding to its materialized version enforced write-once.
- Public read endpoints for a registered publication and one of its observed versions, and an
  editor-only audit view of one registration observation.
- Offline schema-drift detection against the pinned upstream JSON Schemas of
  `dhuzard/oratlas-myst` `0.2.0`.

## [0.1.0] - 2026-07-20

### Added

- Initial provenance release baseline for the public archive, editorial workflow, preservation
  exports, knowledge graph, TRUST records, synthesis pipeline, and operational tooling.
- Platform release versions on new audit events and machine-readable exports.

[Unreleased]: https://github.com/dhuzard/oratlas/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dhuzard/oratlas/releases/tag/v0.1.0
