# Architecture

Open Review Atlas is a TypeScript pnpm monorepo. The web application is server-rendered
Next.js (App Router); domain logic lives in framework-free packages so it can be tested in
isolation and reused by CLI scripts.

```
apps/
  web/                 Next.js App Router application (UI + API routes)
packages/
  contracts/           Zod schemas, shared types, review-manifest JSON Schema
  config/              Environment parsing and shared runtime config
  db/                  Prisma schema + client + seed (SQLite dev, PostgreSQL-compatible)
  github/              GitHub URL safety + bounded repository inspection client
  zenodo/              DOI normalization/resolution + Zenodo metadata matching
  extractor/           Deterministic metadata & artifact extraction, compatibility report
  trust/               TRUST assessment validation and documented aggregation
  atlas-check/         Local TRUST/FAIR evidence evaluator and GitHub annotation renderer
  protocols/           Offline registry adapters and neutral protocol-drift comparison
  execution-passports/ Offline Workflow Run crate + signed-attestation verification
  federation/          Bounded offline COAR Notify validation and immutable projections
  knowledge/           Search provider, evidence packets, discussion engine, link proposals
  publications/        Generic publication boundary: identity, structural provenance, adapters
  ui/                  Reusable accessible React primitives
scripts/               Ingestion / validation / evaluation / maintenance CLIs (tsx)
docs/                  Architecture, governance, schema and deployment documentation
```

## Layering

```
apps/web (routes, server actions, API)
   │  uses
   ▼
packages/knowledge ── packages/extractor ── packages/trust
   │                        │
   ▼                        ▼
packages/github      packages/zenodo
   │                        │
   └────────┬───────────────┘
            ▼
packages/contracts (types + runtime validation, no dependencies on other packages)
packages/db (persistence; consumed by web + scripts, not by domain packages)
packages/atlas-check (bounded local evidence CI; depends only on contracts + Zod)
packages/protocols (offline registry adapters and protocol-drift comparison)
packages/execution-passports (offline Workflow Run provenance verification)
packages/federation (bounded COAR Notify parsing; depends only on contracts + Zod)
packages/publications (generic publication boundary; depends only on contracts + Zod)
packages/knowledge/replication (evidence-gap triage and replication marketplace)
```

Domain packages never import Prisma. They accept and return plain typed values
(validated by `packages/contracts`), so persistence and transport are swappable and tests
need no database.

## Canonical graph identity

The accepted target architecture gives reviews and cited works first-class graph identity alongside
claims, figures, datasets, and code. Stable identity is separate from exact immutable version
identity: one node represents a `Review`, each `ReviewVersion` represents an exact graph version,
and claims bind both a stable node and their exact occurrence without inferred continuity across
versions. Cited works use conflict-aware global aliases with an occurrence-local fallback.

The migration remains additive and phased. `ClaimEvidenceRelation` is the stable compatibility subject
linked 1:1 to a canonical evidence edge so existing TRUST, challenge, and adjudication ids and
hashes do not change. Repository-imported edges remain source assertions, distinct from editorially
confirmed relations. Review-backed records never receive fake repository snapshots. See
[Canonical graph identity and compatibility migration](canonical-graph-identity.md) for the
accepted invariants, backup gate, and expand/dual-write/backfill/contract sequence. The runtime,
database models, materialization, and public traversal API have shipped; the
[architecture audit](architecture-audit.md) records the current implementation boundaries and
remaining incremental refactoring work.

## The generic publication boundary

ORAtlas archives reviews it ingests from GitHub repositories, and a review is one _type_ of
publication rather than the federation object. An independently hosted publication — a MyST site, a
journal article, a preprint — publishes its own machine-readable declarations and never contacts
ORAtlas during its build or validation.

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
```

Publication identity is separate from exact version identity, and a canonical URL is never
identity: a `PublicationVersion` is keyed by `(publication, sourcesSha256)`. A
`PublicationCapture` is exactly what ORAtlas observed and is append-only at the database layer. A
`PublicationClaimOccurrence` is one declaration at one exact place and is never a canonical claim
identity — equal text, an equal local id, an equal declaration digest and an equal source digest
are all explicit non-identities.

Verification uses one structural vocabulary, `published-structure` and `source-byte`. Both are
structural provenance states about what ORAtlas checked; neither is scientific validation, and
neither may be described as verified, trustworthy, confirmed, or peer reviewed. TRUST stays
separate and relation-specific.

Adapter and target metadata are closed, versioned discriminated unions, so a JATS or Quarto
producer is a new variant rather than a change to the boundary. Registration and hardened fetching
normalize to `PublicationClaimOccurrence`; the generic database materializer then atomically joins
that occurrence to the existing canonical graph without inspecting the adapter. Two independently
hosted MyST fixtures prove four distinct claims plus one editor-confirmed cross-site contradiction.
One fixture deliberately omits the protocol-optional publisher canonical URL: its immutable
manifest capture supplies a separately named observed base while the exact published target remains
the human and agent deep link. The versioned publication packet exposes the same bounded public
state to agents. See
[Externally hosted publications](external-publications.md).

The framework-free `PublicationAdapter` makes that split executable: adapters describe and verify
format structure over already captured bytes and return generic records; they do not fetch,
execute plugins, or infer authorship. The frozen MyST 0.2.0 path is the first implementation. A
test-only synthetic implementation proves that another normalized target reaches the unchanged
canonical materializer; it is not advertised format support.

Production provenance is a separate append-only edge off one exact `PublicationVersion`, not a
field on `Publication` and not part of adapter selection. Human and ARS-produced MyST documents use
the identical MyST adapter. Optional source declarations and ORAtlas execution attestations remain
distinguishable, production software remains separate from scholarly contributors, and the public
version packet hashes the bounded public assertion state. Reviewed `PublicationRelation` records
describe otherwise ambiguous host/format transfer without merging publications or claims. No
production mode or transfer relation confers scientific merit, TRUST, peer review, or
certification.

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

## Key flows

### Submission and ingestion

1. **Repository step** — a signed-in user pastes a GitHub URL and explicitly chooses the default
   branch, an exact tag, or an exact published release. `packages/github` normalizes it and
   rejects non-GitHub hosts, credentials, malformed URLs, and local-network targets
   (SSRF prevention). Only `https://github.com/{owner}/{repo}` survives.
2. **Inspect step** — `InspectionService` (server-side only) fetches repository metadata,
   license, topics, default branch, latest commit, tags, releases, Pages URL, and a
   bounded set of well-known files (README, `CITATION.cff`, `.zenodo.json`,
   `codemeta.json`, `myst.yml`, `review-manifest.json`, bibliography, knowledge JSONL
   artifacts…) via the GitHub REST API with explicit timeouts, max file counts/sizes,
   and total byte caps. Repositories are **never cloned** and no repository code is ever
   executed. Published-release classification uses `/releases/tags/{tag}`; annotated tags are
   dereferenced with a depth/cycle bound. Atlas resolves the selected commit object, traverses its
   `tree.sha`, and fetches content with `ref=<selected commit>`. Inspection runs synchronously behind an `IngestionRunner` interface so a
   queue can replace it later without touching callers.
3. **Extraction** — `packages/extractor` derives metadata deterministically in priority
   order (manifest → CITATION.cff → .zenodo.json → codemeta.json → MyST config → repo
   metadata → README heuristics) and records field-level provenance (file, path, commit,
   extractor version, timestamp, confidence). It also parses claims / citations /
   relations / TRUST JSONL artifacts and produces the transparent compatibility report.
   A separate opt-in AI packet builder may prepare bounded, commit- and tree-pinned source text for
   claim/citation proposals. Every proposed item must retain a validated exact UTF-8 byte span and
   remains human-review-required; deterministic extraction stays authoritative.
4. **Review & correct** — the wizard shows extracted values; edits are stored separately
   from extracted values with editor identity and timestamps.
5. **Validation** — DOI validation (`packages/zenodo`) returns a structured report with
   hard errors, warnings, per-check outcomes and a confidence level. Version DOIs and
   concept DOIs are distinct fields end-to-end.
6. **Capture** — exact canonical inspection/extraction/validation bytes are stored in a separate
   append-only capture. A random 30-minute, single-use capability is stored only as a hash and is
   bound to the authenticated inspector.
7. **Finalize** — the capability is consumed transactionally; GitHub is not called again. The
   immutable `RepositorySnapshot` is deduplicated by stable GitHub repository id + commit, while
   every reinspection remains independently auditable. Ref/release selection stays on the
   `Submission` and accepted `ReviewVersion`, not on the shared commit snapshot.
8. **Editorial decision** — a database-only, SQLite-retry-bounded transaction claims the status by
   compare-and-set, creates/updates the review and immutable version, materializes evidence, stores
   check-scoped overrides, and emits idempotent audits. Any failure rolls everything back.

### Search

`SearchProvider` interface with a deterministic in-process lexical index over accepted
records (no external services). PostgreSQL FTS or an external engine can be added behind
the same interface later.

### Guided exploration

`/explore` is the primary public discovery surface and the graph landscape is its main content.
Search supplies an entry point into connected traversal; Explore does not append ranked claim or
review rows beneath the graph. Readers answer what they want to understand with a topic and explicit
interest lenses; the application stores the query, repeated `interest` and `known` values, filters,
and optional `focus` node in the URL rather than an inferred account profile. Exhaustive lookup stays
available on the separate `/claims` and `/archive` indexes.

`apps/web/src/lib/knowledge-landscape-service.ts` builds the rendering model used only by Explore.
It searches at most the first 40 matching claim candidates. For at most six explicitly bridged
candidate claims, it reads one-hop public graph neighborhoods and uses those confirmed relations
when matching interests such as data and code, reproducibility, or disagreements. It never infers a
`Claim` → `KnowledgeNode` identity from text.

`GET /api/landscape` is the separate `explicit-interest-recommendation@2.0.0` ranking overlay. It
projects the same deterministic selection to canonical `nodeId`/`nodeVersionId` references, scores,
reasons, and confirmed anchors to an explicitly submitted reader-known set. Labels, details, hrefs,
timelines, and focus state stay in the rendering layer. The known set is request state and is never
written to graph records or inferred from behavior.

The human rendering projection contains at most six claims, ten citation-evidence records, three graph
seeds, and twelve graph identities. Recommendations expose stable node IDs, exact readable version
IDs when applicable, and plain-language selection reasons. The GUI can reduce its rendering model
to a selected node plus its immediate neighbors. The recommendation API rejects focus state and
unknown interests, while the server-rendered page ignores unknown URL interest values before
calling the service.

The overlay ranks paths for exploration, not scientific truth, evidence quality, consensus, or
TRUST. Atlas Discuss follows the visible map as a bounded grounded lens instead of serving as the
Explore front door. Neither surface mutates a preserved record. See the
[explicit-interest recommendation API](knowledge-landscape-api.md).

### Grounded Q&A (Atlas Discuss implementation)

The knowledge unit is an **evidence packet** built from review metadata, claims (with
anchors), citations, claim–evidence relations, TRUST assessments, version/commit/DOI, and
provenance — not raw text chunks.

Claim/citation ids are globally namespaced by immutable review version while their source-local
ids remain available. Citation equality across reviews uses canonical DOI/PMID/OpenAlex aliases;
conflicting alias assertions are surfaced and excluded from automatic merging. See
`docs/evidence-identity.md`.

- **Deterministic mode** (no LLM key): lexical claim retrieval grouped by topic and
  relation, returned as a structured evidence summary. No generated prose.
- **LLM mode**: a provider-neutral `LlmProvider` adapter receives only the evidence
  packet, must return JSON validated against the Zod answer schema, and every statement must cite
  exact claim→citation edges present in that packet. Unknown ids, nonexistent edges, and summary
  mismatches are rejected and retried once. The exact canonical packet bytes are hashed, sent and
  persisted with model/provider/prompt provenance in an `AgentRun`. Chain-of-thought is never
  exposed.

### Cross-review knowledge links

Conservative deterministic proposals (shared canonical DOI/PMID/OpenAlex aliases, normalized claim-text
similarity) stored as reviewable proposals (`proposed/accepted/rejected/superseded`),
always labelled as unreviewed until a human decision.

### Graph-native synthesis evidence

Long-form synthesis uses the separate `SubgraphEvidencePacket` 1.0 contract; it does not alter or
reuse the Atlas Discuss `EvidencePacket` 1.1 review/citation shape. `packages/contracts` owns the
strict, versioned runtime DTO because later writer and verification slices need the same boundary,
while `packages/knowledge` owns the pure deterministic builder and SHA-256 preparation path. The
builder has no Prisma, React, artifact, network, or execution dependency.

The builder accepts a bounded subgraph supplied by a trusted, unpaginated loader. A single
`GET /api/graph` adjacency page is not evidence of traversal completion; callers must follow its
cursor and explicitly expand returned node/version references. KG-11 verifies internal closure,
declared counts, selector fingerprint, exact
node-version ownership, and the full contradiction inventory it receives; loader integration is
responsible for selecting the complete bounded domain for its seed or canonical topic query.
Every node retains its repository snapshot, commit, and source provenance. Only editor-confirmed
exact-version edges enter the packet. TRUST remains exact-relation-scoped, fail-closed verification
status is preserved, and any aggregate is recomputed by the documented ordinal-mean method.

Writer citations resolve only through a canonical references table. Exact node-version references
are always available; DOI references carry their exact node/version owner and distinct semantic
role. The identifier whitelist is derived rather than accepted, excludes all example identifiers
(including the reserved `10.5555` prefix independently of caller flags), and cannot be used to
launder an identifier onto another node. Derived tables, canonical JSON, and the hash are available
only through the source-building path. The packet contains no volatile clock, editorial/private
records, or agent-run fields, and enforces node, edge, identifier, text, and final-byte caps.

The public graph contract itself is documented in [Canonical graph traversal API](canonical-graph-api.md).

`SynthesisWriter` consumes only a revalidated canonical prepared packet. Its static system prompt
never interpolates repository content; the exact packet JSON is the user-data field of an explicit,
provider-neutral completion request. Output is strict JSON matching one `SynthesisReviewDocument`
contract with six fixed ordered sections and bounded plain paragraphs. Citations carry a reference
id plus its exact node and immutable version owner. The pure acceptance validator scans title,
summary, and every paragraph for DOI, PMID, and OpenAlex tokens and requires a matching structured
identifier citation and owning node citation at that site. Unknown, mismatched, duplicate, example,
reserved `10.5555`, malformed, wrapped, HTML/URL-bearing, or oversized output fails closed.

When no provider is configured, a clock-free bounded template composes byte-identical grounded
output. Provider errors never trigger fallback. Every attempted generation first persists a running
`AgentRun`; success or sanitized failure is persisted before control returns. Packet, prompt, and
document hashes plus a deterministic packet/prompt/schema/pipeline/model generation key make downstream editorial
idempotency and verification possible without storing prompts, rejected raw responses, or reasoning.

## Trust boundaries

### Generic certification boundary

Certification is a separate attributed assertion layer over the common PublicationVersion packet;
see [Generic certification infrastructure](certification.md). Each run freezes exact canonical
packet 1.2 JSON—including the persisted normalized scientific content corpus—its full snapshot
SHA-256, packet schema version, and completeness before an external certifier evaluates it. No
certification-time network request is permitted. Immutable, versioned protocols and results are
certifier-owned. Results may
disagree and never become a boolean or aggregate field on `Publication`/`PublicationVersion`.
Scoped hashed credentials reach only certification read/submit routes. Certification cannot mutate
the canonical graph, TRUST, production provenance, publication transfer, or source records.

- All repository content is untrusted: rendered as plain text (React escaping), never as
  HTML; artifact paths validated against traversal; no code execution; no builds of
  submitted repositories.
- GitHub/Zenodo/DOI requests are server-side with timeouts; tokens never reach the
  browser.
- Sessions are HMAC-signed httpOnly cookies; editorial routes check roles server-side;
  mutating routes are rate limited and size limited; editorial actions are audited.
- Execution Passports retain the no-execution boundary: exact crate/digest/claim bindings and an
  Ed25519 identity are verified offline against an explicit operator trust policy. See
  [Execution Passports](execution-passports.md).

## Authentication

Minimal GitHub identity (id, login, avatar, profile URL). GitHub OAuth activates when
`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are configured; otherwise development offers an
explicit, clearly-labelled mock sign-in (`AUTH_MOCK=1`) which is refused in production.

## Replaceability decisions

| Concern   | POC implementation                      | Replacement path                                |
| --------- | --------------------------------------- | ----------------------------------------------- |
| Ingestion | synchronous `IngestionRunner`           | queue/worker behind same interface              |
| Search    | in-process lexical index                | `SearchProvider` for Postgres FTS/engine        |
| LLM       | Anthropic adapter (optional)            | any `LlmProvider` implementation                |
| DB        | SQLite                                  | PostgreSQL (schema avoids SQLite-only features) |
| Auth      | cookie sessions + optional GitHub OAuth | full OAuth/OIDC provider                        |
