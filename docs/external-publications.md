# Externally hosted publications

Status: **generic federation with exact-version contributors, production provenance, and reviewed transfer.** Secure
registration and immutable capture remain the publication boundary. A separate editor action
materializes normalized external claim occurrences into the existing canonical graph;
cross-publication claim relations still use the ordinary proposal/confirmation lifecycle.
Ownership proof, graph snapshots and change feeds remain deferred; certification consumes the
immutable public packet without changing this boundary.

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

`publicationType` is optional and defaults to `other`, because MyST manifest protocols 0.2.0 and
0.3.0 do not declare it. The operation requires the normal ORAtlas editor session, exact same-origin mutation
headers and rate limits. Operators should use the returned `links.capture`, `links.publication`
and `links.publicationVersion` resources as the canonical API locations. A `201` means at least
one immutable record was created; a byte-identical replay returns `200` with `replayed: true`.

The registration pipeline is deliberately non-executable:

```
manifest URL → safe bounded fetch → exact byte capture → closed 0.2.0/0.3.0 validation
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

### MyST compatibility matrix

The one `myst` format adapter accepts exactly two manifest contracts and rejects every other
`schemaVersion`:

| MyST manifest | Claim records | Additional declarations                               |
| ------------- | ------------- | ----------------------------------------------------- |
| `0.2.0`       | `0.2.0`       | none                                                  |
| `0.3.0`       | `0.2.0`       | optional `contributors`; optional single `production` |

Manifest schema version, claim-record schema version, and npm package version are independent
values. In particular, `@neuronautix/myst` package 0.3.0 emits manifest 0.3.0 while its
`oratlas/claims.jsonl` records remain on frozen schema 0.2.0. Unknown future manifest versions are
not partially read.

The 0.2.0 path is unchanged: contributors remain `not-declared` and source production assertions
remain absent. The 0.3.0 additions do not change identity, target resolution, structural/source-byte
verification, claim normalization, or scientific-content extraction.

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
whose pinned manifest schemas `0.2.0` and `0.3.0` publish `oratlas.manifest.json`, `myst.xref.json` and
`oratlas/claims.jsonl`.

`Review` is therefore no longer the federation object. It is a supported **publication
type**, alongside research articles, methods articles, preprints and living reviews.

## Scholarly credit, production, and format are orthogonal

The generic boundary keeps three independent declarations:

```text
scholarly credit → PublicationVersionContributor snapshots
production       → PublicationProductionAssertion provenance
format           → PublicationAdapter
```

Alice and Bob can be source-declared authors, while an ARS workflow and Alice-as-editor appear in
production provenance, and `myst` remains only the format adapter. A person appears in both channels
only when the source explicitly declares both. No production actor becomes an author, and no author
creates a production assertion by implication.

Who or what helped produce a publication does not select its structural adapter. Human authors,
ARS, AIreview, another research agent, or a hybrid workflow can all publish MyST. Conversely, a
human-led workflow can publish a future JATS or Quarto transport. ORAtlas therefore has no “ARS
adapter” or “AIreview adapter”. MyST 0.2.0 and 0.3.0 use the same production `myst` adapter;
the second format used by tests is synthetic and is not a support claim.

```
PRODUCTION
Human / ARS / AIreview / research agents / hybrid
                       │
                       ▼
FORMAT
MyST / JATS / Quarto / ...
                       │
                       ▼
FORMAT ADAPTER
                       │
                       ▼
Publication / PublicationVersion
                       │
                       ▼
PublicationClaimOccurrence
                       │
                       ▼
Canonical ORAtlas KG
```

The framework-free `PublicationAdapter` receives only parsed input and bytes already captured by
the hardened registration layer. It recognizes and validates a manifest, declares required
artifacts, validates captures, verifies published structure, normalizes generic publication,
occurrence, optional contributor and optional production records, may normalize a bounded
plain-text content corpus, and resolves exact targets.
It never fetches the network, executes publication code or plugins, or infers production history.
MyST manifest protocols 0.2.0 and 0.3.0 are two closed versions implemented by that one adapter.

Production history is optional, exact-version, and append-only:

```
PublicationVersion
       │
       ├── normalized scientific content corpus
       ├── scholarly contributor snapshots
       └── Production provenance assertions
             human / AI-assisted / agentic / hybrid / unspecified
```

An assertion records declared production actors and bounded activities. Production actors may be
people, organizations, software, workflows, or AI systems; they are not scholarly contributors,
and software or an AI system never becomes an author by implication. `source-declared` means only
that a publication or workflow made the declaration. `oratlas-attested` requires an exact
succeeded `AgentRun` or verified `ExecutionPassport`. Neither strength, nor any production mode,
says anything about scientific merit, correctness, TRUST, peer review, or certification.

Multiple assertions may coexist. A correction creates a new assertion with
`supersedesAssertionId`; database guards reject update and deletion of either row. A later
`PublicationVersion` starts with no assertions unless its source or an attributable editor records
them separately. MyST 0.2.0 declares none, and remains fully valid.

MyST 0.3.0 carries at most one source production declaration. Actor `id` values are checked only
for uniqueness inside that source declaration, then stripped; they are not stored as public actor
`identifier` metadata. ORAtlas derives the generic assertion-level activities as a de-duplicated
first-seen union in actor order and activity order, then strips each actor's local activity list.

Public reads are `GET /api/publication-versions/{id}/production-provenance`. Editor/admin writes use
the corresponding `/api/editorial/...` route. Adapter-originated source declarations enter through
the generic normalized registration result, never through a MyST-specific hook.

## Exact-version scholarly contributors

`PublicationAdapter.normalize` may return an ordered `contributors` snapshot for the exact version.
Each record has a source-local key, person or organization kind, display/person-name fields, bounded
declared identifiers (including ORCID or ROR), affiliations, ordered roles, one-based position,
optional public URL, and provenance bound to the exact captured artifact that declared it. Missing
`contributors` means `not-declared`; it is valid and is distinct from an explicitly declared empty
list. MyST protocol 0.2.0 supplies no contributor field, so its existing registrations remain valid
without reinterpretation. MyST 0.3.0 preserves the exact declared order and binds every contributor
to the captured `publication-manifest` slot identity and exact manifest-byte SHA-256.

Contributor rows are immutable and version-scoped. Version 2 never updates or inherits version 1's
snapshot. Declared ORCID/ROR values remain metadata: ORAtlas does not resolve them, create a
canonical `Person`, or merge people from names, affiliation, email, GitHub, ORCID, or ROR. Public
reads are `GET /api/publication-versions/{id}/contributors`; the DTO reports declaration status and
completeness and never exposes private email by default.

## MyST 0.3.0 release gate

`.github/workflows/myst-030-compatibility.yml` is the release gate for
`@neuronautix/myst` 0.3.0. It checks out `dhuzard/oratlas-myst` at exact commit
`91b20fb5e405878b3f100ddbda297bd5448d598a`, builds and packs that source without using npm 0.3.0,
creates a fresh external MyST publication, and sends its real emitted artifacts through hardened
verification, registration, replay, content normalization, canonical claim materialization, and
PublicationVersion packet 1.3.0 assembly. A green gate is the compatibility assertion that ORAtlas
accepts both frozen MyST 0.2.0 and release-candidate MyST 0.3.0; it does not publish or tag either
repository.

## Publication transfer and continuity

`PublicationRelation` records an explicit, attributable review between two distinct
`Publication` identities: continuation, mirror, move, derivation, republication, or version
relationship. It records transfer provenance; it does not merge records or substitute for durable
identity evidence already used by `Publication`. ORAtlas never creates one from matching titles,
contributors, text, digests, URLs, or local identifiers. Public reads are
`GET /api/publications/{id}/relations`; only editors/admins may add reviewed relations.

A durable identity can retain one `Publication` while successive immutable versions change host or
adapter. Old captures, addresses, occurrences, and graph versions remain untouched. Publication
continuity still does not establish claim continuity: a V1 and V2 occurrence with the same local id,
text, or declaration digest remain separate and receive separate canonical claims unless the
existing reviewed canonical identity mechanism explicitly binds them.

## The five boundary concepts

```
Publication                  which publication this is, across its versions
  └── PublicationVersion     one exact immutable version ORAtlas observed
        ├── PublicationCapture             exactly what ORAtlas observed, byte for byte
        ├── normalized content corpus       deterministic inert evaluation text
        ├── PublicationVersionContributor  exact source-declared scholarly credit
        └── PublicationClaimOccurrence     one claim declaration at one exact place
```

| Concept                         | Says                                                   | Never says                                        |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| `Publication`                   | which source publication this is                       | which canonical graph node it is                  |
| `PublicationVersion`            | which exact version of it was observed                 | that a URL is identity                            |
| `PublicationCapture`            | what bytes ORAtlas actually saw, and their digests     | that those bytes are scientifically sound         |
| `PublicationVersionContributor` | source-declared credit on this exact version           | canonical person identity or production history   |
| `PublicationClaimOccurrence`    | that a declaration appears here, in this exact version | that two occurrences are the same canonical claim |

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
guessing from a mutable URL.

The protocol's publisher-declared `publication.canonicalUrl` is optional. When present it is
retained unchanged as `canonicalUrl`; ORAtlas never invents it. Separately, every new registration
derives `observedPublicationBaseUrl` from the immutable manifest capture's final URL (falling back
to its requested URL). Pre-Phase-3 rows derive the same value from that retained capture at read
time. Public graph and packet DTOs name these distinctly as `publisherCanonicalUrl` and
`observedPublicationBaseUrl`. The occurrence's `publishedTargetUrl` remains the authoritative
external deep link, including its exact source anchor.

The uniqueness constraint is `(publicationId, sourcesSha256)`, deliberately **not** a global
unique on the digest: two distinct publications may legitimately publish identical bytes.

The version also stores canonical JSON for its normalized content corpus, the corpus SHA-256, and
honest coverage metadata. These fields are written with the version and protected by the same
SQLite/PostgreSQL immutability guards. Extraction code is never rerun to rewrite an old version.
Changed source bytes produce a new version and a separately bound corpus.

The version also records whether its adapter supplied a contributor snapshot. Contributor rows are
ordered, capture-bound, and protected against update/deletion on SQLite and PostgreSQL. They do not
relate to the canonical `Person` table and never inherit across versions.

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

## Normalized scientific content

Secure registration uses the publication's bounded cross-reference inventory to capture declared
structured page data. Claim-bearing pages are mandatory; additional inventory pages are captured
only within maximum document, per-document byte, total corpus byte, AST-node, artifact, operation,
and normalized-text limits. MyST normalization walks a conservative allowlist of inert AST nodes
for headings, prose, lists, equations, tables, captions, and bounded code text. HTML, scripts,
iframes, executable/plugin output, unknown directives, event handlers, and hidden UI state are not
preserved or executed.

Each document records its optional semantic role, source path, published address, representation,
plain text and text SHA-256, plus the immutable source capture identity and byte digest. Published
structured text is labelled `published-structured-text`; it is never called source-byte verified.
Roles remain null when a heading does not establish one safely.

Completeness reports `returnedDocuments`, `totalDocumentsKnown`, `truncated`, and `coverage`.
MyST 0.2.0 exposes a cross-reference inventory but no authoritative whole-document manifest, so
its coverage is reported as `partial` (or `unknown` when no text can be extracted), even when every
known inventory page was captured. An adapter with no content support records `unsupported` and an
empty corpus; it never fabricates content. The normalized corpus is an evaluation representation,
not a claim that ORAtlas scientifically validated the publication.

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
explicit reviewed choice. Concurrent exact requests use the same rolled-back uniqueness-race retry
discipline as registration: one creates, one returns an idempotent replay, and only the creating
transaction writes the audit event.

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
shared adapter vocabulary, structural-level, capture identity, optional publisher-canonical
addressing, observed addressing and exact-target provenance without raw capture bytes. The
exactly-one-source database constraint remains `= 1` across all five source columns on SQLite and
PostgreSQL.

The generic materializer lives in `packages/db` and consumes only
`PublicationClaimOccurrence`. MyST resolves its target URL before persistence and disappears at the
materialization boundary. A future normalized adapter occurrence can use the same function.

The canonical occurrence page links to the exact external target as “Open original publication”.
Agents traverse the same identity and provenance via `/api/graph`. The deterministic
`GET /api/publication-versions/{id}/packet` schema 1.3.0 returns bounded captures, the persisted
content corpus, exact-version contributors, occurrences, bindings, public confirmed relations,
completeness flags, hypermedia and a SHA-256 over canonical packet content. Contributor state is
therefore part of the digest. Historical CertificationRun packet 1.2.0 JSON stays readable and is
never upgraded in place. The content-only projection is
`GET /api/publication-versions/{id}/content`; neither route performs an external fetch. Both exclude
raw capture blobs and private proposals.

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
| `packages/publications/src/adapter.ts`                          | format-neutral, framework-free adapter contract                |
| `packages/publications/src/adapters/myst.ts`                    | the pinned 0.2.0 adapter implementation                        |
| `packages/contracts/src/publication-provenance.ts`              | production and transfer public contracts                       |
| `packages/publications/src/remote-fetch.ts`                     | the reusable DNS-pinned SSRF and response-limit boundary       |
| `packages/publications/src/registration.ts`                     | capture and structural verification over externally seen bytes |
| `apps/web/src/lib/external-publication-registration.ts`         | atomic, idempotent persistence and typed result                |
| `packages/db/src/publication-claim-materialization.ts`          | adapter-neutral canonical materialization                      |
| `apps/web/src/lib/publication-version-packet.ts`                | deterministic bounded public packet                            |
| `apps/web/src/app/api/editorial/publications/register/route.ts` | editor-authenticated registration operation                    |
| `apps/web/src/lib/publication-provenance.ts`                    | bounded public reads and governed append-only writes           |
| `packages/db/prisma/schema.prisma`                              | publication, provenance, and transfer persistence              |
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
- **Certification.** Production provenance is descriptive historical evidence, not a
  certification result, authorship inference, quality judgment, or “ORA Certified” state.
- **Graph snapshots and change feeds.**
