# Externally hosted publications

Status: **phase 2 — registration and immutable capture.** An externally hosted publication
can now be registered by manifest URL: ORAtlas retrieves it through a hardened outbound
boundary, retains exactly the bytes it saw, validates them fail-closed against the pinned
producer contract, records the structural provenance level it reached, and materializes
publication, version and source-occurrence records. Canonical claim materialization, graph
snapshots and change feeds do not exist and are named as deferred at the end.

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
PublicationRegistration            a manifest URL an operator asked ORAtlas to observe
  └── PublicationRegistrationCapture   one immutable observation of that URL

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

## Registration

### The operation

```
POST /api/editorial/publications/register
{ "manifestUrl": "https://lab.org/review/oratlas.manifest.json" }
```

Editor-only, same-origin, rate-limited and body-limited, like every other editorial
mutation. `publicationType` is optional: the producer contract declares no publication type,
so ORAtlas records `other` rather than inferring a scholarly kind, and an editor may correct
it later.

The response states what was observed and what was checked:

| Field                   | Says                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `disposition`           | `captured`, `replayed`, or `new-version-captured`                     |
| `capture`               | capture id, capture key, the URLs, the manifest digest, the artifacts |
| `publication`           | the publication identity ORAtlas keyed                                |
| `publicationVersion`    | the exact observed version identity                                   |
| `manifestSchemaVersion` | the protocol version the manifest declared                            |
| `adapterType`           | the authoring toolchain, `myst` in this version                       |
| `claimOccurrenceCount`  | how many source occurrences were materialized                         |
| `structuralProvenance`  | the level actually reached                                            |
| `sourceVerification`    | `reached`, or `unavailable` with the reason it was not                |
| `warnings`              | non-fatal observations about the publication as observed              |
| `links`                 | canonical ORAtlas locations for what the registration produced        |

A refusal returns a typed error whose `error.details[0]` is a stable machine reason
(`manifest-schema-unsupported`, `artifact-digest-mismatch`, `cross-reference-target-missing`,
…). No refusal ever carries a network address, a resolver answer, a stack trace, or anything
else about ORAtlas's own infrastructure.

Three read endpoints exist so the links resolve to something real:
`GET /api/publications/{id}`, `GET /api/publications/{id}/versions/{versionId}`, and the
editor-only `GET /api/editorial/publications/captures/{id}`. The last is the audit view:
digests, byte lengths, redirect chain and the reason source bytes were or were not obtained.
It deliberately does not re-serve the retained bytes.

### The pipeline

```
manifest URL
  → admitted by the outbound URL policy
  → bounded retrieval, redirects re-admitted at every hop
  → manifest bytes captured, digest recomputed
  → schema version and adapter type checked before anything is interpreted
  → every declared path re-validated against the safe-path rule
  → claim stream retrieved; declared digest and record count checked
  → every claim record validated; duplicate local ids refused
  → cross-reference inventory retrieved; every target must resolve
  → the page data the inventory points at must contain the claim node
  → source-byte verification, when a source is declared and resolvable
  → capture persisted, then publication / version / source occurrences
```

Everything above the last line runs before a row is written. A refused registration leaves
nothing behind: an operator cannot fill the archive with fragments by pointing it at broken
sites.

Nothing in the pipeline executes anything. No MyST plugin runs, no HTML is rendered, no
JavaScript is evaluated, no repository is cloned, no subprocess is spawned, and no field that
is an identifier rather than a location is ever dereferenced — `publication.canonicalUrl`
included, which the producer contract explicitly forbids fetching during validation.

### For agents and operators

1. Publish `oratlas.manifest.json` at your publication root, over https, with
   `Content-Type: application/json`. The claim stream may be served as `application/jsonl`,
   `application/x-ndjson`, `application/json` or `text/plain`; an `text/html` error page that
   answers `200` is refused as the wrong kind of thing.
2. Every path the manifest declares must satisfy the safe-path rule and must be reachable
   relative to the location the manifest is actually served from. ORAtlas fetches from there,
   not from `canonicalUrl`.
3. Declare `canonicalUrl` if you want published claim links to point at your canonical
   deployment. If it differs from where ORAtlas observed the bytes, that disagreement is
   recorded as a warning rather than resolved.
4. Register the URL again after republishing. A publication is republished, not pushed: an
   unchanged site replays its existing capture, and changed bytes produce another capture and,
   when `sourcesSha256` moved, another version.
5. To reach `source-byte`, declare `source: { type: "git", repository, commit }` with a full
   commit id on a public GitHub repository. Without a pinned commit the bytes behind the
   descriptor can move, so ORAtlas refuses to call it exact.

## Remote-fetch security

Every external URL and every external response is treated as adversarial. All outbound
retrieval goes through `@oratlas/safe-fetch`, which is the **one** place ORAtlas decides what
a public internet destination is — `@oratlas/zenodo` delegates its DOI redirect-target check
to the same classifier, because two URL-safety implementations drift and the weaker one
becomes the way in.

| Control            | Behaviour                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheme             | https only. `http` requires an explicit opt-in that `@oratlas/config` refuses in production.                                                                                                                                                 |
| Credentials, ports | A URL with credentials, or a non-default port, is refused.                                                                                                                                                                                   |
| Destination        | Loopback, RFC 1918 / unique-local, carrier-grade NAT, link-local, cloud metadata, unspecified, multicast and reserved addresses are refused, in both IPv4 and IPv6, including IPv4-mapped forms.                                             |
| Internal DNS       | `localhost`, `*.local`, `*.internal`, `*.corp`, `metadata.google.internal`, single-label hosts and similar are refused by name, before resolution.                                                                                           |
| DNS rebinding      | Every address the resolver returns is classified **at connect time**, through the socket's `lookup` hook. A resolver answer containing even one inadmissible address fails the whole connection, so happy-eyeballs failover cannot reach it. |
| Redirects          | Bounded, and every hop is re-admitted through the full URL policy from scratch.                                                                                                                                                              |
| Size               | Per-artifact byte caps, enforced against the declared `Content-Length` and again while the body streams.                                                                                                                                     |
| Time               | Connect timeout, socket read timeout, and one total budget shared by every retrieval in a registration.                                                                                                                                      |
| Counts             | Caps on artifacts retrieved, claim records read, and inventory entries parsed — enforced against what was actually read, not only what was declared.                                                                                         |
| Content type       | Checked fail-closed per artifact, including against a missing type.                                                                                                                                                                          |
| Execution          | None. No JavaScript, no HTML rendering, no MyST plugin, no repository command, no subprocess.                                                                                                                                                |

The residual risk this does not close is a host that answers a validating request from a
public address and then moves: connect-time classification pins each connection, but a
publication that is honest once and hostile later is a re-registration problem, not a fetch
problem. That is what captures are for.

## Capture first, graph later

The exact bytes ORAtlas saw are assembled and retained **before** any semantic record is
derived from them. A `PublicationRegistrationCapture` records the URL asked for, the URL it
resolved to, the site root artifacts were fetched from, the manifest digest, the manifest's
HTTP provenance, the protocol facts the manifest declared, the structural provenance level
reached, why source bytes were or were not obtained, and every warning. The artifact bytes and
their recomputed digests hang off the version as `PublicationCapture` rows, each carrying its
own HTTP provenance and a link back to the observation that first retrieved it.

A capture is append-only on both providers. The single permitted mutation is binding it,
write-once, to the version it materialized into — which is necessarily afterwards, because the
bytes are retained first.

**A capture is never overwritten.** Idempotency is deterministic: the capture key is a digest
over the requested URL, the resolved URL and every artifact's kind, declared path and digest.

| Situation                                 | Result                                                   |
| ----------------------------------------- | -------------------------------------------------------- |
| Same URL, byte-identical artifacts        | `replayed` — the existing capture, no second row         |
| Same URL, any byte changed                | a new capture; a new version when `sourcesSha256` moved  |
| A second URL serving the same publication | a new capture; the same publication and version identity |

## Ownership is unsolved, and is not pretended otherwise

**Registering a URL is not a claim to own the publication it names.** Nothing in this phase
proves that whoever registers `https://lab.org/review/` is entitled to, and there is no
boolean, flag or field that pretends to.

What exists instead is a governance control, not a cryptographic one: registration is
editor-only and attributed to the editor who performed it. That bounds who can register
anything at all; it does not establish that the publication's authors consented.

A real mechanism — a `.well-known` challenge at the publication origin, a DNS TXT record, a
signed file in the declared git source, or an ORCID-bound author assertion — is a separate
piece of work with its own threat model, and ORAtlas should decide it before registration is
opened beyond editors rather than after. Until then, treat a registration as _an editor
asserts this URL is worth archiving_, never as _these authors published here_.

## The producer contract, and how drift is detected

ORAtlas is a **consumer** of [`dhuzard/oratlas-myst`](https://github.com/dhuzard/oratlas-myst)
schema `0.2.0`. It deliberately takes no runtime dependency on the MyST adapter: that package
is a build-time tool for publication authors, and depending on it would couple every
independently hosted publication to ORAtlas's release cadence, drag a MyST toolchain into the
server, and put a producer's code on ORAtlas's critical path for reading bytes.

So the protocol is re-expressed as Zod schemas ORAtlas owns, in
`packages/publications/src/adapters/myst.ts` — and that re-expression is precisely what can
drift. The boundary is therefore explicit and checked:

- the upstream JSON Schemas are captured byte-for-byte under
  `packages/publications/src/protocol/pinned/`, with their digests asserted, so an accidental
  edit or a careless re-pin fails immediately;
- `protocol-drift.test.ts` validates a corpus of valid and hostile documents against **both**
  the pinned upstream schema and ORAtlas's own reader, and requires them to agree. A field the
  producer adds, removes or loosens surfaces as a disagreement rather than as a subtly wrong
  ingestion;
- where ORAtlas is deliberately _stricter_ than the generated JSON Schema — the safe-path
  rule, the https-only canonical URL, `endLine >= startLine`, all normative prose the schema
  shape cannot express — that asymmetry is asserted explicitly, so it cannot quietly
  disappear;
- an unimplemented `schemaVersion` or `adapter.type` is refused outright, before any
  structural parsing. A future manifest is never partially read.

The pin and its re-capture rules live in `CROSS_REPO_DEPENDENCIES.md`.

## Review-manifest delegation

`artifacts.claims.declarations` names exactly one authority for a publication's claim
declarations, and ORAtlas honours it rather than merging:

- `publication-source` — the MyST records carry the claim text and attributes.
- `review-manifest` — the ORAtlas `review-manifest.json` the publication ships owns claim
  text and attributes; the MyST records supply only the source occurrence binding, and the
  materialized occurrences carry `declaration: { authority: "review-manifest" }` with no text.

Two artifacts both asserting authority is a refusal, never a heuristic choice between them: a
review manifest that declares a claim stream while the publication asserts its own source is
authoritative is rejected, and so is delegation to a review manifest that declares no claim
stream, or none at all. When a review manifest is authoritative its bytes are captured and a
warning records that its claim stream was not reinterpreted here — reading a source assertion
does not make it a verified one, and importing that stream is a separate decision.

## Where the code lives

| Path                                                 | Contents                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/contracts/src/publications.ts`             | the generic boundary contracts and vocabularies                               |
| `packages/contracts/src/publication-registration.ts` | the registration request, result and read models                              |
| `packages/publications/src/identity.ts`              | stable keys and fail-closed identity evidence                                 |
| `packages/publications/src/structural-provenance.ts` | which structural level a set of checks reached                                |
| `packages/publications/src/review-projection.ts`     | legacy review → generic publication projection                                |
| `packages/publications/src/adapters/myst.ts`         | the pinned 0.2.0 adapter: validate and normalize, never fetch                 |
| `packages/publications/src/protocol/`                | JSON Lines, cross-reference and URL-resolution rules; pinned upstream schemas |
| `packages/publications/src/registration/`            | the pipeline: transport seam, capture, verification, orchestration            |
| `packages/safe-fetch/`                               | the one hardened outbound boundary and its URL/address policy                 |
| `apps/web/src/lib/publication-registration.ts`       | the editorial operation and its persistence                                   |
| `apps/web/src/lib/publication-source-resolver.ts`    | exact-byte source reads from a pinned GitHub commit                           |
| `packages/db/prisma/schema.prisma`                   | the six models (PostgreSQL variant is generated from it)                      |
| `packages/db/src/database-guards.ts`                 | the SQLite and PostgreSQL guards for both providers                           |

`@oratlas/publications` is framework-free like every other domain package: no Prisma, no
React, no filesystem, and it never executes publication content. It performs no networking
itself either — registration is expressed against a transport interface the caller supplies,
which in ORAtlas is `@oratlas/safe-fetch` and in tests is the same implementation pointed at a
local fixture.

## Deliberately deferred

These are **not** implemented, and none of them should be inferred from what is:

- **Re-checking.** A publication is republished, not pushed, and registration currently
  observes only when an operator asks. There is no polling loop, no author-triggered
  re-ingest, and no change feed. Re-registering the same URL is the whole mechanism.
- **Ownership proof.** See above: editor-only registration is a governance control, not a
  proof. No `.well-known` challenge, DNS record or signed source assertion exists.
- **Source-byte verification beyond a pinned GitHub commit.** A `doi` source resolves to
  metadata rather than document bytes; an `archive` source would need a bundle unpacked, which
  means running an extractor over attacker-supplied input. Neither is faked: both report
  `source-type-not-supported` with the reason recorded.
- **Cross-publication graph relations.** Nothing relates two publications, two versions, or
  two occurrences.
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
