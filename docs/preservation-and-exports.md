# Preservation and standards exports

Accepted versions are durable archive objects. Every artifact below is produced from the
database alone — no GitHub, DOI or other network request occurs on any preservation or export
path — so **a deleted upstream repository does not remove an accepted version**: it remains
readable on its immutable version page and machine-exportable through the endpoints here.

The article reader and canonical version diff are documented in
[`article-lifecycle.md`](article-lifecycle.md). Tombstoned versions are withheld from every reader,
asset and export path even though their append-only lifecycle record remains public.

## What is preserved

At submission time the platform stores, per accepted version:

- the exact source selection (commit SHA, tree SHA, branch/tag/release provenance) on the
  submission and version rows;
- a **repository snapshot storage report** with per-file sizes, truncation flags and SHA-256
  content checksums (`RepositorySnapshot.inspectionReportJson`), plus a normalized
  `contentHash` over the whole snapshot;
- a **durable copy of the preserved textual file contents**
  (`RepositorySnapshot.preservedFilesJson`, contracts `preservedFilesSchema`), copied out of the
  inspection capture when the submission is finalized. The capture row itself is an expiring
  inspect-to-submit capability and may be pruned without any effect on preservation. Public
  reader, file and export routes never consult it. Legacy rows with missing or malformed durable
  preserved content fail closed as unavailable until explicitly migrated.
- exact root `TRUST.md` and `FAIR.md` source-methodology documents, when captured within the same
  bounds, with preservation-only checksums and commit provenance; see
  [`source-assessment-documents.md`](source-assessment-documents.md).

## Endpoints

| Endpoint                                                | Format                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/reviews/{slug}/versions/{id}/export/csl`      | CSL-JSON citation item                                             |
| `GET /api/reviews/{slug}/versions/{id}/export/bibtex`   | BibTeX entry                                                       |
| `GET /api/reviews/{slug}/versions/{id}/export/ris`      | RIS record                                                         |
| `GET /api/reviews/{slug}/versions/{id}/export/jats`     | JATS 1.3 front-matter XML                                          |
| `GET /api/reviews/{slug}/versions/{id}/export/ro-crate` | RO-Crate 1.1 metadata (JSON-LD)                                    |
| `GET /api/reviews/{slug}/versions/{id}/export/prov`     | W3C PROV provenance (JSON-LD)                                      |
| `GET /api/reviews/{slug}/versions/{id}/export/package`  | Preservation manifest (files, checksums, SWHIDs, integrity hashes) |
| `GET /api/reviews/{slug}/versions/{id}/export/docmap`   | DocMaps-compatible editorial process history (JSON-LD)             |
| `GET /api/reviews/{slug}/versions/{id}/export/json`     | Deterministic scholarly JSON (TRUST, challenges, source documents) |
| `GET /api/reviews/{slug}/versions/{id}/files/{path}`    | Preserved raw file content (plain-text attachment)                 |
| `GET /api/feeds/atom`                                   | Atom 1.0 feed of recently accepted versions                        |
| `GET /api/reviews/{slug}/diff?from={id}&to={id}`        | Canonical checksummed asset/metadata/claim/citation diff           |
| `GET /api/feeds/lifecycle`                              | JSON correction/withdrawal/tombstone ledger                        |

All exporters live in the framework-free `@oratlas/exports` package and take plain typed
inputs; the web app maps database rows into those inputs in `apps/web/src/lib/preservation.ts`.
Every `/export/` representation identifies the ORAtlas platform release that generated it. This
field is additive and describes the exporter code, not the independently versioned review content.

## Archival identifiers (SWHID)

Software Heritage identifiers are derived deterministically from the preserved Git object ids:
`swh:1:rev:<commit>` and `swh:1:dir:<tree>` for 40-hex (SHA-1) ids. Repositories using Git's
SHA-256 object format receive no SWHID. Resolver URLs to
`archive.softwareheritage.org` are only emitted for real versions — never for seeded/example
versions, whose synthetic object ids do not exist in any archive.

## Invariants

- **Example identifiers are never machine-actionable.** Synthetic DOIs (`10.5555/…`) are
  withheld from CSL `DOI`, BibTeX `doi`, RIS `DO`, JATS `article-id`, and RO-Crate
  `identifier` fields; a human-readable note records the omission. Example ORCIDs are likewise
  never exported as `orcid.org` identifiers.
- **Repository content is untrusted.** Preserved file content is served as a plain-text
  attachment with `X-Content-Type-Options: nosniff` and is never rendered as HTML; XML
  exports escape every repository-derived value.
- **Exact commits are mandatory.** Public readers and exporters reject abbreviated, mutable,
  malformed and all-zero commit identities; a branch name is never a fallback.
- **Tombstones fail closed.** A tombstoned version serves no article, metadata, people, evidence,
  comments, assets or export. Only its attributable lifecycle event remains public.
- **Delivery is revocable.** Files, exports, canonical diffs and the acceptance Atom feed use
  `no-store, must-revalidate`; an intermediary cannot keep serving content after a tombstone.
- **Exports are pure functions of stored rows.** The PROV chain (repository state →
  inspection capture → submission → accepted version) reflects the actual pipeline and embeds
  the stored integrity hashes.
- **Discussion remains a separate register.** Open comments and Atlas Discuss output stay outside
  every scholarly export. Challenges remain outside BibTeX, CSL, RIS, JATS, PROV, package, and
  DocMap. The versioned scholarly JSON includes every integrity-checked public challenge state;
  RO-Crate links that JSON and describes its public challenge and assessment entities without
  inferring scientific resolution from lifecycle state.

## Scholarly JSON profile

The `1.0.0` scholarly JSON profile is regenerated deterministically from accepted database rows and
never contacts an upstream repository. It exports every claim–citation TRUST assessment separately,
including protocol, assessor, criterion records, limitations, evidence, source assertion, and the
fail-closed Atlas verification state. Each assessment also carries its immutable tri-state COI
snapshot; an invalid persisted status rejects export. Acceptance attribution comes from immutable
direct or formal decision provenance rather than the editor's mutable current login. The profile
deliberately defines no aggregate, disagreement summary,
or protocol crosswalk: consumers compare the uncollapsed records only within protocols they
understand.

Challenges use the integrity-checked public projection of the challenge register. Visible challenge
and response text, public GitHub attribution, hashes, status, and lifecycle events are included.
Retained removed bytes, transition rationale, internal user ids, and role snapshots never enter the
export. `TRUST.md` and `FAIR.md` appear only as preservation metadata and download links; their
Markdown is not parsed into assessment fields.

COAR Notify Announce Review activities identify scholarly JSON as the review's `ietf:item` and link
the RO-Crate representation through the absolute `https://oratlas.org/ns/exports` extension.
