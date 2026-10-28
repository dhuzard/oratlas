# Offline private project-descriptor observations (#206)

`oratlas.research-project-descriptor-observations/0.1.0` is an additive, closed
observation contract. It describes source-declared project/artifact references;
it is not the eventual authenticated connector or a source entitlement proof.
No application route imports it. Public archive ingestion, graph, search,
publication identities and existing native assessment/credit protocols are unchanged.

## Executable producer boundary

`adaptCRTProjectDescriptor` consumes exact UTF-8 bytes of the optional CRT
`research-project-artifacts/0.1` descriptor from
`Neuronautix/ComputationalReviewTemplate_trust-knowledge` at
`3092657a59d27fa14ab2d777568b10e5e5c6a075` (PR #22). A caller supplies the expected
SHA-256 of the held descriptor, never an arbitrary source URL. The adapter checks
that digest, bounded input size, the supported native version, closed fields,
GitHub coordinates, safe paths, distinct artifact ids/paths, release consistency,
and current declared clearance. Schema changes require a new reviewed pin.

The original synthetic producer output, native schema and redistributable fixture
artifact bytes are frozen under
`packages/knowledge/src/fixtures/research-project-descriptors`. `pins.json` records
their exact hashes. Tests validate the held descriptor with the pinned native
schema, check the held synthetic artifact bytes separately, and compare the adapter
output with a reviewed golden. CI executes no producer runtime and contacts no API.
ORAtlas bounds may reject otherwise valid producer values (oversized metadata or
paths outside the destination path policy); such values fail rather than disappear.

## Diggypaper connector capture (0.2.0)

The synthetic Diggypaper fixture is retired. `adaptDiggypaperProjectDescriptor` consumes
the exact bytes of a Diggypaper `research-project-descriptor/0.1.0` captured from its live
connector (`dhuzard/diggypaper` #53) at `ea84932a248275feaaef051ca64c10cbed1d62dd`
(PR #74): a lead granted `list_project`, `list_artifacts` and `obtain_authorized_export`,
and the capture holds the descriptor, the listed `source-evidence-packet/0.1.0` and the 404s
returned after revocation. The project data is synthetic. Bytes, schema, license and the
reviewed golden are pinned in `fixtures/research-project-descriptors/diggypaper/pins.json`.

0.1.0 cannot represent this producer without inventing values: it requires a GitHub data
repository and commit, a research question and repository paths. Diggypaper has none of
those: artifacts are retrieved only by authorized export, and the title and description
are withheld unless the lead recorded a disclosure decision. The additive
`oratlas.research-project-descriptor-observations/0.2.0` (`connectorProjectDescriptorSchema`)
therefore records a `producer-connector` source with its declared producer commit, title and
description as `withheld` or `disclosed`, the holder's declared role, the validity window,
and zero or more `evidence-packet` references. 0.1.0 and the CRT adapter are unchanged.

The adapter checks the expected digest and size, parses the native descriptor strictly
(only a live `producer-export` with a 40-hex commit and a grant reference), keeps deep links
inside their project, and refuses:

- a descriptor issued to any recipient other than `recipient:oratlas`
  (`source-audience-mismatch`);
- use outside `[issued_at, expires_at)` at the caller's `asOf` (`source-expired`), as the
  producer contract requires consumers to re-validate before use;
- a held packet for an unlisted digest, or whose `manifest.json` or listed files do not match
  (`packet-digest-mismatch`).

Held bytes that match are recorded as `held-bytes-match-digest`. That is a byte identity
check only: ORAtlas does not run the producer's packet validator, and matching bytes are not
a rights, validity or scientific assessment. `connectorArtifactIdentity` scopes an artifact
by producer, project, producer commit, packet id and digest, so the same packet digest in two
projects stays two artifacts.

## What the result means

- Every output is `private-adapter-output` with `accessEffect: none` and
  `principalAuthorization: not-performed`, even when a source artifact declares
  itself public and released. There is no public serializer or fallback mode.
- A descriptor's digest binds the held bytes only. Its repository commit is a
  declaration; neither Git history nor source access is verified. Per-artifact
  hashes/lengths are retained as declarations with byte verification explicitly
  not performed by this adapter. The test's held synthetic bytes do not upgrade
  runtime assertions to verified source provenance.
- A source omitting cross-project processing permission narrows to
  `not-authorized`. License, visibility or a declared review/release state cannot
  authorize processing, release, or scientific validation.
- Artifact identity includes producer, source project, repository, declared
  commit, local artifact id, path and digest. Shared DOI, local id or text cannot
  silently merge distinct project artifacts.
- Contributorship artifacts are exact references in a separate channel. Native
  human decisions, CRediT, SEIP and TRUST stay in their original artifacts;
  generator records remain software provenance, without inferred human roles.
- Unknown fields, including tokens, ORCID membership or caller-supplied grants,
  are rejected. Errors expose stable codes only. Free-text secret detection is
  not claimed; no real private input belongs in fixtures or public output.

## Reproduce and remaining gates

```sh
pnpm exec vitest run packages/knowledge/src/research-project-descriptors.test.ts \
  scripts/architecture-boundaries.test.ts
pnpm --filter @oratlas/contracts typecheck
pnpm --filter @oratlas/knowledge typecheck
```

The architecture guard rejects direct and barrel imports of these private types
and adapters from public application modules. This is a bounded static safeguard,
not proof of complete runtime non-interference.

#206 remains open. Before any private listing or source load, the real connector
must authenticate a local session, verify the exact principal/source grant and
artifact scope, handle expiry/revocation/replay, and authorize protected output
at its final release boundary. #204 workspace authority, #203 session decisions,
G1–G6 and the applicable privacy gates remain prerequisites. A structurally valid
descriptor never substitutes for those checks.

Rollback is a revert of these additive contracts, adapter and fixtures. There are
no migrations, credentials, private storage writes or enabled provider transports.
