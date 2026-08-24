# Externally hosted publications

Status: **phase 3 — canonical graph participation.** Secure registration and immutable capture
remain the publication boundary. A separate editor action now materializes normalized external
claim occurrences into the existing canonical graph; cross-publication relations use the ordinary
proposal/confirmation lifecycle. Certification, ownership proof, snapshots and change feeds remain
deferred.

## Registering an external publication

An editor registers the publication-side discovery document, not a repository and not a page:

```http
POST /api/editorial/publications/register
Content-Type: application/json

{
  "manifestUrl": "https://lab.org/review/oratlas.manifest.json",
  "publicationType": "review-article"
}
```

`publicationType` is optional and defaults to `other`, because portable protocol 0.2.0 does not
declare it. The operation requires the normal ORAtlas editor session, exact same-origin mutation
headers and rate limits. Operators should use the returned `links.capture`, `links.publication`
and `links.publicationVersion` resources as the canonical API locations. A `201` means at least
one immutable record was created; a byte-identical replay returns `200` with `replayed: true`.

The registration pipeline is deliberately non-executable:

```
manifest URL → safe bounded fetch → exact byte capture → closed 0.2.0 validation
             → declared artifact capture → published-structure checks
             → optional exact source-byte checks → atomic source-occurrence materialization
```

ORAtlas never runs JavaScript, HTML, a MyST plugin, a repository command or publication code.
Every redirect is validated again. DNS answers are checked for loopback, private, link-local,
metadata-service, reserved and internal destinations, and the accepted address is pinned for the
connection. Responses, redirects, records, artifacts, page-data traversal and the whole operation
are bounded. All paths are revalidated before resolution. Identifiers such as xref target ids and
canonical URLs are not unrestricted fetch instructions.

The captured manifest keeps both the requested and final URL, exact UTF-8 bytes, recomputed digest,
capture time, status, bounded selected headers and the complete validated redirect chain. The same
is retained for claims, xref, page-data, delegated review-manifest artifacts and safely obtainable
source documents. Artifact rows and observed publication versions are database-guarded against
update and deletion.

### Verification outcomes

Every successful response states either `published-structure` or `source-byte`. A normal deployed
site with no retrievable Markdown is complete at `published-structure`; this is not an error and is
not scientific verification. `source-byte` is currently attempted only for a canonical public
GitHub repository with a full immutable commit, using ORAtlas's fixed-origin GitHub transport. DOI,
archive, a git source without a commit, delegated records that omit declaration-digest inputs, and
other repository hosts are not claimed as supported. The reason is recorded in the version's
warnings and returned to the operator; a source failure never masquerades as `source-byte`.

When `artifacts.claims.declarations` is `review-manifest`, ORAtlas fetches and validates the declared
ORAtlas review manifest and its authoritative claims stream. The MyST claims stream contributes
only occurrence bindings. Both id sets must agree exactly; ORAtlas never merges two authorities or
picks fields heuristically.

### Ownership is separate

Successful registration proves only what bytes ORAtlas observed and structurally checked. It does
**not** prove that the registering editor owns or controls an arbitrary publication URL. URL-control
proof is a separate governance/security problem; phase 2 implements no `.well-known`, DNS or
repository challenge and exposes no ownership boolean. Deployments must therefore keep this
operation editorial until a real ownership mechanism and policy exist.

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
declaration digest, exact adapter-resolved published URL, and the declaration loaded from exactly
one declared authority.

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

`POST /api/editorial/publication-claim-occurrences/{id}/materialize` writes it together with the
matching `KnowledgeNodeVersion.sourcePublicationClaimOccurrenceId` in one transaction. An unseen
occurrence receives a new canonical claim identity. Exact replay is idempotent; a pre-existing
incompatible binding or version fails closed. Continuity across publication versions remains an
explicit reviewed choice.

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
version digest, which is not part of phase 2.

## Canonical graph extension

`KnowledgeNodeVersion` gains one nullable, unique `sourcePublicationClaimOccurrenceId`
column. The exact-version source union stays **exclusive**: exactly one real source per node
version, now counted across five columns instead of four (`= 1` is unchanged). The
pre-existing `KnowledgeNode` origin union is untouched — an external claim occurrence would
materialize as an ordinary `claim-occurrence` node, so no new node kind is introduced and
canonical graph identity does not change shape.

The fifth source is active. `canonicalGraphSourceSchema` exposes bounded publication, version,
adapter, structural-level, capture-identity, original-URL and exact-target provenance without raw
capture bytes. The exactly-one-source database constraint remains `= 1` across all five source
columns on SQLite and PostgreSQL.

The generic materializer lives in `packages/db` and consumes only
`PublicationClaimOccurrence`. MyST resolves its target URL before persistence and disappears at the
materialization boundary. A future normalized adapter occurrence can use the same function.

The canonical occurrence page links to the exact external target as “Open original publication”.
Agents traverse the same identity and provenance via `/api/graph`. The deterministic
`GET /api/publication-versions/{id}/packet` returns bounded captures, occurrences, bindings, public
confirmed relations, completeness flags, hypermedia and a SHA-256 over canonical packet content.
It excludes raw capture blobs and private proposals.

ORAtlas's safe reader natively recognizes `:::{oratlas:claim} source-local-id` without loading
`@oratlas/myst` or any external plugin. It renders the body through the existing sanitized MyST
pipeline, assigns an ORAtlas-owned DOM anchor, and treats a publication-provided `htmlId` only as
source metadata. Unknown directives retain the existing safe fallback admonition.

The architecture proof uses two independent site origins:

```
Site A ─┐
        ├─→ Publication boundary
Site B ─┘
              ↓
       PublicationClaimOccurrence
              ↓
        canonical ORAtlas KG
              ↓
      B1 contradicts A1
```

See [Canonical graph identity and compatibility migration](canonical-graph-identity.md).

## Where the code lives

### Portable protocol boundary and drift

ORAtlas does not depend at runtime on `@oratlas/myst` or its parser/plugin stack. The two portable
0.2.0 objects are represented as closed Zod schemas in
`packages/publications/src/adapters/myst.ts`; ORAtlas's own generic records remain in
`@oratlas/contracts`. The implementation was reconciled against `dhuzard/oratlas-myst` current head
`51336a5446b449d4d661a4f46d8f8913a0bac2cb` (2026-08-24), including `SPEC.md`, both JSON schemas,
`src/contracts` and `docs/integration-oratlas.md`. At that revision the upstream schema file
fingerprints were:

- `oratlas-manifest.schema.json`: `433ba00c1e1721694e4823a94284f16fc4aa9c969dd761fa21cd92d7c228a319`
- `oratlas-claim.schema.json`: `ea327a04598d50df774b527ddd169cf2f4b0c7772b978b0b95d14c1b8630d4d2`

Schema drift is fail-closed at runtime: only the literal `0.2.0` version and known adapter/target
variants parse, and every represented object is closed against unknown keys. Contract tests cover
the upstream examples, ordering, delegation and selector/path invariants. When upstream publishes a
new schema version, maintainers must compare the current specification and fingerprints, add a new
explicit adapter variant and fixtures, and only then admit it; changing a `0.2.0` interpretation in
place is forbidden.

| Path                                                            | Contents                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/contracts/src/publications.ts`                        | the generic boundary contracts and vocabularies                |
| `packages/publications/src/identity.ts`                         | stable keys and fail-closed identity evidence                  |
| `packages/publications/src/structural-provenance.ts`            | which structural level a set of checks reached                 |
| `packages/publications/src/review-projection.ts`                | legacy review → generic publication projection                 |
| `packages/publications/src/adapters/myst.ts`                    | the pinned 0.2.0 adapter: validate and normalize, never fetch  |
| `packages/publications/src/remote-fetch.ts`                     | the reusable DNS-pinned SSRF and response-limit boundary       |
| `packages/publications/src/registration.ts`                     | capture and structural verification over externally seen bytes |
| `apps/web/src/lib/external-publication-registration.ts`         | atomic, idempotent persistence and typed result                |
| `packages/db/src/publication-claim-materialization.ts`          | adapter-neutral canonical materialization                      |
| `apps/web/src/lib/publication-version-packet.ts`                | deterministic bounded public packet                            |
| `apps/web/src/app/api/editorial/publications/register/route.ts` | editor-authenticated registration operation                    |
| `packages/db/prisma/schema.prisma`                              | the four models (PostgreSQL variant is generated from it)      |
| `packages/db/src/database-guards.ts`                            | the SQLite and PostgreSQL guards for both providers            |

`@oratlas/publications` is framework-free like every other domain package: no Prisma, no
React and no filesystem. Its one network module is the explicit hardened boundary; callers
inject both remote fetching and source retrieval in tests. It never executes publication content.

## Deliberately deferred

These are **not** implemented, and none of them should be inferred from what is:

- **Automatic re-check and ownership proof.** Registration is an editor-triggered operation;
  there is no polling loop, `.well-known`/DNS/repository challenge or ownership assertion.
- **Review version projection.** Needs an `atlas-review` adapter variant with a defined
  version digest.
- **Public product language.** No UI copy, route, or public API describes ORAtlas in terms
  of publications rather than reviews.
- **Certification and production/AI authoring provenance.** The generic packet is future input,
  not a certification result or an authorship assertion.
- **Graph snapshots and change feeds.**
