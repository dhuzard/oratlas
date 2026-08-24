# Externally hosted publications

Status: **phase 1 — generic publication boundary only.** The models, contracts and
database guards described here exist. Registration, fetching, canonical materialization,
graph snapshots and change feeds do not, and are named as deferred at the end.

## Why this exists

ORAtlas began as an archive of AI-enriched reviews built from GitHub repositories. A review
is one _kind_ of scientific publication, and the archive's storage was shaped around it:
`Review`, `ReviewVersion`, `Claim`, `Citation`, `ClaimEvidenceRelation`.

An independently hosted publication is different in one decisive way: **ORAtlas does not
host it and does not build it.** The publication is somewhere on the web, publishes its own
machine-readable declarations, and never contacts ORAtlas during its build or validation.
The first such producer is [`dhuzard/oratlas-myst`](https://github.com/dhuzard/oratlas-myst),
whose pinned schema version `0.2.0` publishes `oratlas.manifest.json`, `myst.xref.json` and
`oratlas/claims.jsonl`.

`Review` is therefore no longer the federation object. It is a supported **publication
type**, alongside research articles, methods articles, preprints and living reviews.

## The four boundary concepts

```
Publication                  which publication this is, across its versions
  └── PublicationVersion     one exact immutable version ORAtlas observed
        ├── PublicationCapture             exactly what ORAtlas observed, byte for byte
        └── PublicationClaimOccurrence     one claim declaration at one exact place
```

| Concept                      | Says                                                   | Never says                                        |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| `Publication`                | which source publication this is                       | which canonical graph node it is                  |
| `PublicationVersion`         | which exact version of it was observed                 | that a URL is identity                            |
| `PublicationCapture`         | what bytes ORAtlas actually saw, and their digests     | that those bytes are scientifically sound         |
| `PublicationClaimOccurrence` | that a declaration appears here, in this exact version | that two occurrences are the same canonical claim |

### `Publication`

Stable identity across versions, keyed from durable evidence and nothing else:

| Basis                 | Evidence                                                      |
| --------------------- | ------------------------------------------------------------- |
| `git-source`          | the declared git repository (plus a declared publication id)  |
| `concept-doi`         | the concept DOI, which is the identity across versions        |
| `declared-identifier` | an author-declared publication id plus a canonical URL origin |
| `registration`        | an opaque key ORAtlas mints when nothing else is durable      |
| `atlas-review`        | an existing ORAtlas `Review` this publication projects        |

A publication's `stableKey`, `recordSource`, `identityEvidenceJson` and `reviewId` are immutable
once written, on both providers: the keying decision and the evidence it rested on cannot be
rewritten later. Presentation-level fields such as `publicationType` remain editorially
correctable.

**A canonical URL alone is never a basis.** A publication can move, be mirrored, or be
served from several hosts, and two publications can occupy one URL at different times.
`derivePublicationIdentityEvidence` fails closed rather than keying a publication by URL.
A _version_ DOI and an _archive_ digest are not bases either: each identifies one exact
version, not the publication that persists across versions.

### `PublicationVersion`

Identity is `(publication, sourcesSha256)`. `sourcesSha256` is the publication's own digest
over its complete document set; it always exists, including for a plain website with no
repository, DOI or archive. That is what lets ORAtlas tell version 1 from version 2 without
guessing from a mutable URL. The canonical URL is retained as addressing metadata.

The uniqueness constraint is `(publicationId, sourcesSha256)`, deliberately **not** a global
unique on the digest: two distinct publications may legitimately publish identical bytes.

Adapter metadata lives in one closed, versioned, discriminated union
(`publicationAdapterBindingSchema`) stored as `adapterBindingJson`, with a generic
`adapterType` column beside it. There is no `mystXrefId` or `mystHtmlId` column anywhere in
the generic layer: a JATS or Quarto adapter is a new variant of that union, not a schema
change.

### `PublicationCapture`

An immutable record of exactly what ORAtlas observed for one artifact — its declared path,
observed location, media type, byte length, the digest ORAtlas recomputed, the digest the
publication declared, and (when small enough to retain inline) the bytes themselves.

Captures are append-only at the database layer on both providers: `UPDATE` and `DELETE` are
rejected by a trigger, so captured bytes can never silently mutate once a later phase starts
writing them. An observed `PublicationVersion` is likewise closed to both — it records what
ORAtlas saw, so correcting it means observing again, not editing the record.

### `PublicationClaimOccurrence`

One `oratlas:claim`-style declaration at one exact location in one exact version. It stores
the source-local claim id, a typed target descriptor, the byte-level source binding
(document path, document digest, line span, block digest), the source-frame selector, the
declaration digest, and the declaration itself when the publication source owns it.

Uniqueness is `(publicationVersionId, sourceLocalClaimId)`: a source-local id is unique only
inside one publication version. `declarationSha256` is indexed but **not** unique.

## Verification: structural provenance, not scientific validation

Two levels, and ORAtlas must be explicit about which one it reached:

| Level                 | Reached with                   | Establishes                                                                                                                                                                    |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `published-structure` | the published site alone       | declared digests matched observed bytes, declared paths re-validated, declared record counts matched, every target resolved in the publication's own cross-reference inventory |
| `source-byte`         | additionally, the source bytes | declared document and block digests matched, declaration digests recomputed, source selectors located                                                                          |

`source-byte` subsumes `published-structure`. **Neither is a scientific validation state.**
Neither may be described as verified, trustworthy, confirmed, or peer reviewed. Reaching a
level says what ORAtlas structurally checked, not whether a claim is correct, supported,
replicated or endorsed. TRUST stays separate and attaches to a claim–citation _relation_,
never to a publication or a claim; there is deliberately no per-claim score to import,
because the producer contract defines none.

A publication that declares no obtainable source is a first-class participant capped at
`published-structure`. The database refuses `source-byte` on a version with no source
descriptor, on both SQLite and PostgreSQL.

## Source occurrence is not canonical identity

```
publication + exact version + source-local claim id
                     ↓
             exact claim occurrence          ← what the producer publishes
                     ↓
          ORAtlas canonical binding          ← ORAtlas's own, separate decision
```

ORAtlas must not infer that two occurrences describe the same claim from any of:

- equal or normalized claim text;
- an equal `declarationSha256` — it is a content digest, not an identity;
- an equal `sourcesSha256` — that is not publication identity either;
- an equal source-local claim id in two different publication versions;
- position, heading, section, or ordering;
- textual or semantic similarity.

`PublicationClaimOccurrence.knowledgeNodeId` is the place an explicit, reviewed identity
decision is recorded. It is null until such a decision is made, is never written by
inference, and is write-once: a database trigger rejects rewriting it, and rejects every
other mutation of the occurrence.

Nothing in phase 1 writes it.

## Transitional architecture

```
legacy review storage            external publication
 (Review / ReviewVersion)         (registered manifest)
        │                                 │
        │ projection                      │ native record
        ▼                                 ▼
              Publication / PublicationVersion
                          │
                          │  explicit, reviewed identity decision
                          ▼
              canonical KnowledgeNode / KnowledgeNodeVersion
                          │
                          ▼
        claims / evidence / assessments / discussion / provenance
```

Legacy review storage keeps working exactly as before. `Review`, `ReviewVersion`, `Claim`,
`Citation` and `ClaimEvidenceRelation` are unchanged in meaning, in shape and in their
public APIs. No table was renamed and no row was rewritten.

`Publication.reviewId` is the projection binding: a review projection owns exactly one
review, and a natively registered external publication owns none — enforced by a check
constraint on both providers. `projectReviewAsPublication` derives the generic identity an
existing review projects into, without writing anything.

The projection is deliberately partial. A `PublicationVersion` needs an exact
`sourcesSha256` over a document set and an adapter binding; a legacy `ReviewVersion` has
neither. Projecting review _versions_ needs an `atlas-review` adapter variant with a defined
version digest, which is not part of phase 1.

## Canonical graph extension

`KnowledgeNodeVersion` gains one nullable, unique `sourcePublicationClaimOccurrenceId`
column. The exact-version source union stays **exclusive**: exactly one real source per node
version, now counted across five columns instead of four (`= 1` is unchanged). The
pre-existing `KnowledgeNode` origin union is untouched — an external claim occurrence would
materialize as an ordinary `claim-occurrence` node, so no new node kind is introduced and
canonical graph identity does not change shape.

This is the expand step only:

- no writer materializes an external-publication node version;
- the public canonical graph response contract is unchanged, so
  `canonicalGraphSourceSchema` still has four variants. `apps/web/src/lib/canonical-graph-query.ts`
  fails closed on a node version whose source it cannot name, which is the correct behaviour
  until a materializer and a contract variant ship together;
- the dormant canonical-graph contract's immutability trigger was extended to cover the new
  column, so an activated contract protects it exactly as it protects the other four.

See [Canonical graph identity and compatibility migration](canonical-graph-identity.md).

## Where the code lives

| Path                                                 | Contents                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `packages/contracts/src/publications.ts`             | the generic boundary contracts and vocabularies               |
| `packages/publications/src/identity.ts`              | stable keys and fail-closed identity evidence                 |
| `packages/publications/src/structural-provenance.ts` | which structural level a set of checks reached                |
| `packages/publications/src/review-projection.ts`     | legacy review → generic publication projection                |
| `packages/publications/src/adapters/myst.ts`         | the pinned 0.2.0 adapter: validate and normalize, never fetch |
| `packages/db/prisma/schema.prisma`                   | the four models (PostgreSQL variant is generated from it)     |
| `packages/db/src/database-guards.ts`                 | the SQLite and PostgreSQL guards for both providers           |

`@oratlas/publications` is framework-free like every other domain package: no Prisma, no
React, no network, no filesystem, and it never executes publication content.

## Deliberately deferred

These are **not** implemented, and none of them should be inferred from what is:

- **Registration and fetching.** There is no endpoint that accepts a manifest URL, no
  bounded fetch client, no redirect policy, no re-check or polling loop, and no ownership
  proof for whoever registers a URL. Everything in `@oratlas/publications` operates on
  artifacts a caller already holds.
- **Canonical materialization.** Nothing writes `PublicationClaimOccurrence.knowledgeNodeId`
  or `KnowledgeNodeVersion.sourcePublicationClaimOccurrenceId`.
- **Review version projection.** Needs an `atlas-review` adapter variant with a defined
  version digest.
- **The `oratlas:claim` directive in ORAtlas's own MyST reader.**
  `apps/web/src/lib/article-reader.ts` still renders an unknown directive as a fallback
  admonition. The prose is preserved and nothing breaks, but such a claim is not yet
  anchored in ORAtlas's reader.
- **Public product language.** No UI copy, route, or public API describes ORAtlas in terms
  of publications rather than reviews.
- **Graph snapshots and change feeds.**
