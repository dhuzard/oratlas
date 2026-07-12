# Preservation and standards exports

Accepted versions are durable archive objects. Every artifact below is produced from the
database alone — no GitHub, DOI or other network request occurs on any preservation or export
path — so **a deleted upstream repository does not remove an accepted version**: it remains
readable on its immutable version page and machine-exportable through the endpoints here.

## What is preserved

At submission time the platform stores, per accepted version:

- the exact source selection (commit SHA, tree SHA, branch/tag/release provenance) on the
  submission and version rows;
- a **repository snapshot storage report** with per-file sizes, truncation flags and SHA-256
  content checksums (`RepositorySnapshot.inspectionReportJson`), plus a normalized
  `contentHash` over the whole snapshot;
- the **append-only inspection capture** (`InspectionCapture.payloadJson`), which contains the
  full textual content of the well-known files fetched at inspection, integrity-protected by
  `payloadHash` (also stamped on the version as `capturePayloadHash`).

The capture is the only source of raw file bytes. If a retention policy ever prunes capture
payloads, the checksums in the snapshot report keep the package verifiable
(`preservedContentAvailable: false` in the manifest).

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
| `GET /api/reviews/{slug}/versions/{id}/files/{path}`    | Preserved raw file content (plain-text attachment)                 |
| `GET /api/feeds/atom`                                   | Atom 1.0 feed of recently accepted versions                        |

All exporters live in the framework-free `@oratlas/exports` package and take plain typed
inputs; the web app maps database rows into those inputs in `apps/web/src/lib/preservation.ts`.

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
- **Exports are pure functions of stored rows.** The PROV chain (repository state →
  inspection capture → submission → accepted version) reflects the actual pipeline and embeds
  the stored integrity hashes.
