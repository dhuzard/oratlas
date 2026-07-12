# Article reader, version diff and public lifecycle

Every public article representation is derived from an accepted database snapshot. The reader,
diff, assets and exports never read a GitHub branch, release page or mutable published website.
A version is public only when its snapshot contains a full, non-zero 40- or 64-hex commit object
id; a branch name, abbreviated SHA or all-zero placeholder never acts as a fallback.

## Safe article reader

The reader chooses a complete preserved Markdown file using a deterministic priority
(`review.md`, `article.md`, `manuscript.md`, `paper.md`, `README.md`, `index.md`, then the first
safe Markdown path). It rejects traversal paths and truncated files. The parser recognizes only
headings, paragraphs, fenced code and lists. Inline Markdown and raw repository HTML remain inert
text rendered through React escaping: no repository script, HTML, link or embedded object is
activated.

The table of contents uses platform-generated, collision-free section ids. Claims use the exact
version-scoped Atlas anchors from `claimDomAnchor`; source repository anchors remain provenance
only. Invalid UTF-16 scalar sequences are replaced before UTF-8 response encoding.

## Canonical version diff

`GET /api/reviews/{slug}/diff?from={id}&to={id}` compares two readable versions belonging to the
same review. Four independently checksummed sections are canonicalized:

- preserved asset paths, sizes, truncation state and content SHA-256;
- effective metadata;
- claims and their exact citation edges; and
- citations and scholarly identifiers.

Object keys and record ids are sorted before canonical JSON serialization. Every added, removed
or changed record is reported, each changed record has before/after checksums, and the complete
diff has its own SHA-256. Malformed archive JSON, tombstoned content or non-exact commits fail
closed.

## Append-only lifecycle ledger

`ReviewLifecycleEvent` records `correction`, `withdrawal` and `tombstone` with the target version,
public reason, actor, time, review-scoped revision and (for corrections) prior version superseded.
The service verifies both versions belong to the same review. A compare-and-set update of
`Review.lifecycleRevision`, materialized `ReviewVersion.publicState`, event and `AuditEvent` commit
in one transaction. Concurrent or stale writers receive a conflict and must reload.

- A **correction** must target the current published, readable version and link a readable,
  chronologically prior version of the same review. Historical/withdrawn targets and tombstoned
  prior versions are refused. Both pages display reciprocal notices.
- A **withdrawal** remains readable and discoverable with an explicit warning, but its claims are
  excluded from claim search and Atlas Discuss evidence packets.
- A **tombstone** withholds the targeted version. Its page and API expose only a generic tombstone
  plus the public lifecycle reason/actor/time; no scholarly payload is returned.

Editorial mutation requires an editor session, exact same-origin `application/json`, a public
reason of at least 20 characters and the expected lifecycle revision. The global machine-readable
ledger is `GET /api/feeds/lifecycle`.

## Tombstone boundary matrix

The same `publicState` and exact-commit guards cover every public projection:

| Boundary                       | Tombstoned behavior                                                     |
| ------------------------------ | ----------------------------------------------------------------------- |
| Article page and metadata head | generic, `noindex`, no JSON-LD or scholarly metadata                    |
| Review/version JSON APIs       | sanitized tombstone object; empty authors/claims/citations              |
| Comments                       | empty read result; new current-version comments rejected                |
| Archive, search and home       | review omitted when the current version is tombstoned                   |
| Claim explorer and claim API   | no claims                                                               |
| Atlas Discuss                  | no review, claim, citation or evidence-packet content                   |
| Preserved files and exports    | not found                                                               |
| Version diff                   | not comparable                                                          |
| Acceptance Atom feed           | tombstoned version omitted                                              |
| Lifecycle feed                 | event metadata retained; no article title, abstract, author or evidence |

Previously readable files, exports, diffs and acceptance-feed documents are served with
`Cache-Control: no-store, must-revalidate`, so a tombstone can revoke delivery rather than leaving
an immutable intermediary cache behind.

These guards are tested with secret sentinels across services and routes. A deliberate public
lifecycle reason is not treated as scholarly content and remains visible for accountability.
