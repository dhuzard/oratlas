# ADR-0001 — Authorization and non-interference for private research workspaces

- **Status:** **Accepted by the owner on 2026-10-19** (decisions D1–D11 in §12, recorded from the
  owner's answers). **D11 (retention and controller/processor roles) is provisional** and must be
  confirmed by counsel and a data-protection impact assessment (DPIA) before any real workspace data
  is stored (gate G2). R0 security gate, [ORAtlas #202](https://github.com/dhuzard/oratlas/issues/202).
- **Version:** `oratlas.private-workspace-adr/0.1.0` (accepted text, §1–§13).
  **Proposed follow-up:** `oratlas.private-workspace-adr/0.2.0-proposed` adds §14 only. §14 is
  **PROPOSED, pending owner ratification**; the G0 acceptance of D1–D11 on 2026-10-19 does **not**
  ratify it. Sections whose original wording §14 corrects carry a "Proposed correction" note; the
  original wording is kept as the historical record. Evidence ledger:
  [`private-workspace-r0-review.md`](./private-workspace-r0-review.md).
- **Baseline:** `main` at `f6c834b` (route and schema inventory below was taken from that commit).
- **Scope:** architecture, policy, protocols and tests only. **No** database model, route,
  authentication provider, UI, job or index is added by this document.
- **Related:** [#201](https://github.com/dhuzard/oratlas/issues/201) program,
  [#203](https://github.com/dhuzard/oratlas/issues/203) verified ORCID linking,
  [#204](https://github.com/dhuzard/oratlas/issues/204) private storage,
  [#205](https://github.com/dhuzard/oratlas/issues/205) personal discovery,
  [#206](https://github.com/dhuzard/oratlas/issues/206) producer connectors,
  [#207](https://github.com/dhuzard/oratlas/issues/207) attribution,
  [`private-research-credit.md`](./private-research-credit.md) (#208),
  [`source-credit-interop.md`](./source-credit-interop.md) (#210).

## 1. Problem and design stance

ORAtlas is a **public archive**. Its search, graph, feeds, sitemap, claim passports, snapshots and
exports are built on the assumption that every readable row is publishable. Retrofitting a
`private` flag onto those rows would make _every existing query_ a potential leak, and any future
query written by someone who forgot the flag would leak silently.

The stance of this ADR is therefore:

1. **Private data is structurally unreachable from public code paths**, not merely filtered. It
   lives in a separate storage namespace with separate credentials, and public modules cannot
   import its client (§5.1).
2. **Authorization is a single decision point** enforced three times — route, service, data — and
   fails closed with a response that is indistinguishable from "not found" (§5.2).
3. **Read, cross-project processing, external-model processing, export and release are separate
   capabilities.** Holding one never implies another (§6).
4. **Identity is never authority.** GitHub login, ORCID, authorship, DOI and roster membership
   identify people; only a project controller's grant authorizes access (§4).
5. **Existence is sensitive.** The existence, count, rank, timing, ID or topology of a private
   object is treated as private unless the caller is authorized for it (§9).

### Non-goals

- A new authentication provider, SSO, SCIM or organization sync. GitHub OAuth stays the login.
- Any private-workspace UI, API, background job, index or database table.
- Protection against a malicious operator who can deploy arbitrary code (see §7 for the honest limit).
- Legal advice. §10 lists obligations that need counsel and a data-protection impact assessment.
- Changing any existing public contract, route, response shape or cache behaviour.

## 2. Findings from the current system

These facts are what the design must work with. Each was read from the code at `f6c834b`.

| #   | Fact                                                                                                                                                                                                                                     | Evidence                                                                        | Consequence                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Visibility is **public by default**. Readability is expressed per query through `readable*Where` Prisma fragments keyed on `publicState` / review `status`.                                                                              | `apps/web/src/lib/public-snapshot-visibility.ts`                                | There is no per-row owner or project. A private row added to an existing table would be returned by every query that forgot the fragment. **Private data must not live in existing tables.** |
| F2  | 87 Prisma models in one schema; 46 modules under `apps/web/src/lib` import the database client or Prisma types.                                                                                                                          | `packages/db/prisma/schema.prisma`; `docs/architecture-audit.md`                | Any lib module can reach any table. Isolation by convention would not hold; it must be enforced by credentials and import boundaries.                                                        |
| F3  | Platform roles are `USER`, `EDITOR`, `ADMIN` on `User.role`. There is **no project, membership, invitation or object-level policy** concept.                                                                                             | `schema.prisma` `model User`; `apps/web/src/lib/auth.ts`                        | Membership and object policy are new concepts. Platform `EDITOR`/`ADMIN` must stay unrelated to them.                                                                                        |
| F4  | Sessions are stateless HMAC cookies `userId.issuedAtMs.signature`, 7-day lifetime. The role is re-read from the database on each request, but **there is no server-side session revocation**.                                            | `apps/web/src/lib/session-token.ts`, `auth.ts`                                  | Role changes take effect immediately; "log this session out everywhere" and "revoke after membership removal" do not exist. A revocation mechanism is required (§8).                         |
| F5  | `User.orcid` is a free profile field; `orcidVerifiedAt` exists and the schema comment says it is unverified until an ORCID sign-in confirms it (not re-verified here). The only auth route found is GitHub OAuth (`/api/auth/github/*`). | `schema.prisma` `model User`                                                    | ORCID cannot be an authorization input. #203 supplies verification; this ADR forbids using it for access regardless.                                                                         |
| F6  | `AuditEvent` is one global table with free-text `detailsJson`, readable by editors.                                                                                                                                                      | `schema.prisma` `model AuditEvent`; `apps/web/src/lib/audit.ts`                 | A private subject/project name in `detailsJson` would leak to every editor. Private audit needs its own store (§9.6).                                                                        |
| F7  | The public ledger is **append-only and immutable by design**; takedown is a tombstone that keeps the DOI resolvable.                                                                                                                     | `docs/operations/privacy-and-takedown.md`, `docs/article-lifecycle.md`          | Private data needs the opposite: **erasable**. Private data must never enter the immutable public ledger or its backups unencrypted (§10).                                                   |
| F8  | PostgreSQL has **no row-level security** today; SQLite is the dev/test backend.                                                                                                                                                          | `grep` of `schema.postgres.sql`, `docs/deployment.md`                           | Defense in depth with RLS is available but unused; SQLite cannot host the private feature (§5.1).                                                                                            |
| F9  | There are **no embeddings or persistent search indexes**. Search and the knowledge index are rebuilt from published rows at request time.                                                                                                | `apps/web/src/lib/index-builder.ts`, `archive-search.ts`; `grep embedding`      | Good: no shared derived index to poison. The design must keep it that way for private data (§9.4).                                                                                           |
| F10 | Many JSON routes already send `Cache-Control: no-store`, and most pages are `force-dynamic`, but caching is per-route, not a global rule.                                                                                                | `grep Cache-Control` / `force-dynamic` under `apps/web/src`                     | Private routes need a **global** `private, no-store` default, enforced by a test (§9.5).                                                                                                     |
| F11 | An outbound LLM call exists (`/api/discuss`, graph-curation AI, ORA certification) with request-scoped BYOK keys and evidence-packet grounding.                                                                                          | `apps/web/src/lib/discuss.ts`, `graph-curation-ai.ts`, `ora-certification.ts`   | Private content must not reach these paths by default (§6.4).                                                                                                                                |
| F12 | An architecture-boundary test already parses imports and fails on forbidden dependencies.                                                                                                                                                | `scripts/architecture-boundaries.test.ts`                                       | The import-isolation rule in §5.1 can be enforced with the existing mechanism.                                                                                                               |
| F13 | Domain packages (`knowledge`, `trust`, `exports`, …) are framework-free with no Prisma. `private-research-credit` (#208) and the source-credit adapters (#210) are **pure**; they perform no authorization.                              | `CLAUDE.md`; `docs/private-research-credit.md`; `docs/source-credit-interop.md` | Pure projectors stay pure. Authorization lives in the new private service layer and is passed in as a function, as #208 already assumes.                                                     |

## 3. Ingress and egress catalog

Inventory of every path through which data enters or leaves the system, taken from the code
(`130` API route handlers, `37` pages) and from the packages. The **Rule** column is the
_requirement_ this ADR imposes, not a statement of how a route behaves today; where behaviour was
verified it is cited in §2.

Definitions. **Public-only:** the route must never read private storage, and a test must prove it
(§11, T-PUB). **Private-scoped:** the route may read private storage only after the §5 decision
point allows it. **Not-for-private:** the route's function is incompatible with private data, so
private objects are excluded by construction.

### 3.1 HTTP ingress and egress

| Group (route prefix; count of handlers)                                                                                                                                                         | Data touched today                                           | Rule                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/graph`, `/api/landscape`, `/api/nodes/**` (8), `/api/claims/**` (2), `/api/search`, `/api/synthesis/**`, `/api/syntheses/**`, `/api/synthesis/contradictions`                             | Public canonical graph, published reviews, syntheses         | **Public-only.** Remain backwards compatible. No private node, edge, count, rank or facet may appear, including through totals and pagination cursors.                                                                   |
| `/api/reviews/**` (11), `/api/publications/**`, `/api/publication-versions/**` (7), `/api/publication-captures/**`, `/api/publication-claim-occurrences/**`, `/api/execution-passports/**`      | Published review/publication versions, contributors, packets | **Public-only.** Contributor and production lists never join private attribution (§9.7).                                                                                                                                 |
| Preserved files, RO-Crate, RIS, JSON-LD, challenge exports (`/api/reviews/*/versions/*/export/*`, `.../files/*`, `/api/nodes/*/exports/*`, `/api/publication-versions/*/content`, `.../packet`) | Snapshots and generated bytes                                | **Public-only.** Generated bytes must be derived from public rows only; no private field may be present in a snapshot, even encrypted.                                                                                   |
| Snapshots and version diffs (`/api/reviews/*/diff`, `/api/nodes/*/versions/*`, `/api/protocols/snapshots`)                                                                                      | Immutable public history                                     | **Public-only.** Private revisions never enter an immutable public ledger (F7).                                                                                                                                          |
| `/api/feeds/atom`, `/api/feeds/lifecycle`, `sitemap.xml`, `robots.txt`, `llms.txt`, `openapi.*`                                                                                                 | Public discovery                                             | **Public-only and structurally so**: built from the public query layer; private data cannot be added by a flag.                                                                                                          |
| Author, contributor and profile listings, `/api/profile/orcid`                                                                                                                                  | `User`, contributors, ORCID                                  | **Public-only.** A profile or contributor page never reveals private participation (§9.7). ORCID write is identity data, not authorization (§4).                                                                         |
| `/api/auth/github/*`                                                                                                                                                                            | Login                                                        | Authentication only. Gains a session-epoch check (§8). Never grants membership.                                                                                                                                          |
| `/api/submissions`, `/api/inspect`, `/api/validate-doi`, `/api/discuss`                                                                                                                         | Public ingestion and public Q&A                              | **Public-only.** Not-for-private: private repositories are not inspected through these (the SSRF rules in `SECURITY.md` allow canonical public GitHub URLs only). `/api/discuss` never receives private evidence (§6.4). |
| `/api/comments/**`, `/api/challenges/**`, `/api/challenge-responses/**`, `/api/reviews/*/comments`                                                                                              | Public scholarly exchange                                    | **Public-only.**                                                                                                                                                                                                         |
| `/api/editorial/**` (40), `/api/monitoring/**`, `/api/protocols/**`, `/api/replications/**`, `/api/certifier*`, `/api/certification-*`, `/api/verifier*`, `/api/verification-*`                 | Editorial and verification workflow over public records      | **Public-only; platform roles do not apply to private workspaces.** An `EDITOR`/`ADMIN` session reaches no private object through these (§7).                                                                            |
| `/api/federation/inbox`, `/api/federation/notifications/*`, `/api/editorial/federation/**`, review announce                                                                                     | Inbound COAR Notify; outbound announce                       | **Not-for-private.** A private object is never announced, and inbound payloads never resolve to private objects. Notification creation for attribution is forbidden (§9.7).                                              |
| `/api/notifications`                                                                                                                                                                            | Per-user notifications                                       | Private-scoped notifications are **delivered only in-session, to the recipient, with no project name, count or third-party email** (§9.7).                                                                               |
| `/api/health`, `/api/health/ready`                                                                                                                                                              | Liveness / readiness                                         | Unchanged. Readiness may check the private store only as a boolean and must never include its name or size.                                                                                                              |
| **New** `/api/private/**` (does not exist)                                                                                                                                                      | —                                                            | The **only** place private-scoped handlers may live (§5.1). Default-deny; not listed in `openapi.yaml` until a separate review.                                                                                          |

### 3.2 Non-HTTP ingress and egress

| Path                                                                                                                            | Today                                          | Rule                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages (`37`), server components, `generateMetadata`, JSON-LD, OpenGraph                                                         | Public data via lib modules                    | Public pages import only the public query layer. Metadata and structured data never include private fields.                                                                   |
| Search / knowledge index                                                                                                        | Rebuilt from published rows (F9)               | **No shared index over private data.** Private queries are computed per principal over authorized workspaces only (§9.4).                                                     |
| Embeddings / vector stores                                                                                                      | None (F9)                                      | **Forbidden** for private data until an ADR amendment defines per-workspace, encrypted, non-shared namespaces.                                                                |
| Caches (Next data/route cache, CDN, ETag, `Vary`)                                                                               | Per-route `no-store` on many JSON routes (F10) | Private responses: `Cache-Control: private, no-store`, no shared cache, no content-derived ETag (§9.5).                                                                       |
| Background jobs and CLIs (`apps/web/src/cli/refresh-syntheses.ts`, `scripts/*`, backfills, monitoring scans, staleness scans)   | Operate on public records                      | Jobs are public-only. A private job runs under a **job ticket** carrying workspace and epoch; it is rejected if the epoch moved (§8).                                         |
| Backups (`scripts/backup.ts`, Cloud SQL backup gate) and restore drills                                                         | Whole database                                 | Private store is in a separate schema with encrypted content; backups hold ciphertext and keys live elsewhere, so key deletion makes backed-up private data unreadable (§10). |
| Agents and LLM providers (Anthropic/OpenAI providers, BYOK, graph-curation AI, ORA certification)                               | Public evidence packets, request-scoped keys   | **Default deny for private content.** Per-workspace policy and separate capability required (§6.4).                                                                           |
| External integrations: GitHub OAuth, GitHub inspection, Zenodo, DOI resolution, Crossref-type lookups (`packages/publications`) | Public identifiers                             | Lookups carry public identifiers only. **No private title, DOI or quote is ever sent to a third-party lookup**, since the lookup itself discloses participation (§9.7).       |
| Source-tool connectors (Diggypaper, CRT, ORCID Playground; #206)                                                                | Offline adapters only (#210)                   | A connector is a **source-tool entitlement**, not a user. It may write signed packets into a workspace it was granted and can read nothing (§4.3).                            |
| Logs, metrics, traces (`log.ts`, request id), `AuditEvent`, error bodies                                                        | Structured JSON logs; global audit table (F6)  | Opaque IDs only; no private names, titles, quotes, counts or workspace labels. Private audit lives in the private store (§9.6).                                               |
| Notifications and email/push                                                                                                    | In-app notifications                           | None sent about private objects to anyone other than the authorized recipient; never cross-group (§9.7).                                                                      |

> **Proposed correction (§14.3, pending ratification).** The Backups row overstates erasure:
> deleting a live wrapped data key does not make backed-up ciphertext unreadable while any copy of
> that wrapped key (in backups, replicas or recovery material) and a key-encryption key version
> able to unwrap it still exist.

## 4. Identity, principals and authorization subjects

### 4.1 Vocabulary

| Term                            | Meaning                                                                                                                      | May it grant access? |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Authenticated principal**     | The `User` resolved from a valid signed session cookie, re-read from the database on each request.                           | No, by itself        |
| **Verified identity**           | An external identifier the principal has proved control of (GitHub login today; ORCID after #203).                           | No                   |
| **Local authorization subject** | A random, opaque ORAtlas ID (`subject_id`, UUIDv4) bound 1:1 to a principal. It is the only identifier policy ever sees.     | Only via a grant     |
| **Workspace**                   | An isolated private research context owned by one or more controllers, with its own storage namespace and key (§5.1, §7).    | —                    |
| **Membership**                  | `(subject_id, workspace_id, role, state, epoch)` created by a controller grant or an accepted invitation.                    | **Yes — only this**  |
| **Source-tool entitlement**     | `(connector_id, workspace_id, scope, epoch)` created by a controller, authorizing a connector to _write_ signed packets.     | Write-only, no reads |
| **Capability**                  | One of `read`, `cross-project-process`, `external-model-process`, `export`, `release`, evaluated per object and per purpose. | Each independently   |

### 4.2 Hard rules

1. **ORCID, GitHub collaborator/org status, article coauthorship, CRediT role, DOI, roster entry,
   email domain and "same institution" never create or imply membership.** The ORCID Playground
   roster produces _candidate contacts only_ (`accessEffect: "none"` in #210) and stays that way.
2. **Platform `EDITOR`/`ADMIN` is orthogonal to workspace roles.** No platform role confers any
   workspace capability (§7).
3. **A principal without a membership is, for private data, an anonymous caller** — same
   responses, same timing class (§9).
4. **No authorization input is caller-supplied.** Subject, workspace, role, epoch and capability
   are resolved server-side. A body, header, query string, cookie claim, JWT claim or source
   document that names a principal or role is data, never authority.

### 4.3 Workspace roles

| Role         | Read content | Write content | Manage members | Grant capabilities | Release                        |
| ------------ | ------------ | ------------- | -------------- | ------------------ | ------------------------------ |
| `controller` | yes          | yes           | yes            | yes                | proposes; needs §6.5 approvals |
| `member`     | yes          | yes           | no             | no                 | no                             |
| `reader`     | yes          | no            | no             | no                 | no                             |

`cross-project-process`, `external-model-process`, `export` and `release` are **not** implied by
any role. A controller sets them per workspace and, where narrower, per object class. Every
workspace has at least one active controller; removing the last controller is refused.

### 4.4 Invitation and acceptance

1. A controller creates an invitation bound to a **specific verified identity** (for example a
   GitHub user id), a role, an expiry (default 7 days) and a single-use random token stored as a
   hash.
2. The invitee signs in, and acceptance succeeds only if the authenticated principal's verified
   identity matches. Acceptance creates a membership with a fresh epoch.
3. The invitation page, email and error responses never reveal the workspace name before
   acceptance succeeds; an expired, used or mismatched token yields one generic message.
4. Invitations are not discoverable by search or by ORCID, and cannot be created for a person
   found only on a roster or in a paper's author list.

## 5. Where authorization is enforced

### 5.1 Structural isolation (first line)

- **Separate storage namespace.** Private data lives in a dedicated PostgreSQL schema `private_ws`
  (preferably a separate database when operations allow), reached with a **separate DB role** and
  connection pool. The public application role has **no grants** on `private_ws`. A forgotten
  filter therefore cannot leak a row; the query fails.
- **Separate client and package.** The private store is a new package (working name
  `packages/private-workspace`) with its own client. It is not exported from `@oratlas/db`.
- **Import boundary, enforced.** `scripts/architecture-boundaries.test.ts` is extended so that
  only `apps/web/src/app/api/private/**` and `apps/web/src/lib/private/**` may import the private
  package. Any other importer fails CI. Public modules, feeds, sitemap, search, graph, exports and
  the publication pipeline are therefore unable to reach it.
- **Postgres-only.** The private feature is disabled unless the database is PostgreSQL with the
  `private_ws` role split. SQLite supports _only_ unit tests that use an isolated in-memory
  instance of the private client; the dev server never serves private data from SQLite.
- **No shared tables.** No existing table gains a nullable `workspaceId` or `visibility='private'`
  value (F1). Cross-references from public rows to private rows are forbidden; the reverse
  (private rows pointing at public IDs) is allowed.

### 5.2 One decision point, three enforcement layers

```
authorize(subject, action, object, purpose, context) -> Allow | Deny
```

- **Pure and total.** No I/O inside the function beyond reading a `PolicySnapshot` built from the
  current membership, grant and epoch rows. Unknown action, unknown object class, missing grant
  and any error all return `Deny`.
- **The reason is internal.** The HTTP response, logs and metrics see only `Deny` or `Allow`.
- _Proposed (§14.4, pending ratification): a precedence order for membership, workspace
  capabilities, narrowing restrictions, `owner-only` and `withheld`._

Enforced three times, each independently sufficient to stop a leak:

1. **Route layer.** `/api/private/**` handlers resolve the principal from the session, apply the
   existing mutation-request boundary (exact `Origin`, `application/json`, Fetch Metadata), rate
   limits and body bounds, and call the service. They contain no policy.
2. **Service layer.** Every service function takes an `AuthorizedScope` produced by `authorize()`
   (a branded type that cannot be constructed elsewhere). It calls `authorize` **before** loading
   any protected bytes; denial happens before a single private row is read, which is also what
   #208's projector requires.
3. **Data layer.** Every query is parameterized by the set of workspace ids in the
   `AuthorizedScope`; there is no query that takes a bare object id. PostgreSQL **row-level
   security** is enabled on every `private_ws` table as a backstop, using `SET LOCAL
app.subject_id` and `app.workspace_ids` per transaction. RLS is defense in depth, not the
   primary control, and tests assert that it denies a query that omits the application filter.

A client-side or UI filter is never an authorization control.

### 5.3 Denial semantics

- Unauthorized, nonexistent, revoked and malformed requests all return the **same status, body and
  headers**: `404` with a fixed generic body. There is no `403` for private objects.
- The deny path performs the **same lookups** as the allow path up to the decision (constant-work
  design) so response time does not separate "exists but forbidden" from "does not exist" (§9.3).
- Errors thrown inside the private service surface a stable code to logs and nothing to callers.

## 6. Capabilities and cross-project processing

### 6.1 Visibility states

| State             | Meaning                                                                                 | Who can resolve it                                                                        |
| ----------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `public`          | In the public archive/graph under existing rules.                                       | Anyone. **Not a private-store state**; promoted only by §6.5.                             |
| `project-members` | Inside one workspace.                                                                   | Active members of that workspace holding `read`.                                          |
| `private-owner`   | Owned by one subject inside or outside a workspace (for example a personal suggestion). | The owning subject while every source-workspace grant it depends on remains valid (§6.3). |
| `embargoed`       | Public in intent but withheld until a controller-set release time and approvals.        | Treated as `project-members` until released.                                              |
| `withheld`        | Source-declared withheld identity or content (for example a withheld contributor).      | No one gets the name or content; the fact of withholding may be visible to members only.  |

### 6.2 Visibility grid

`R` = may read content. `E` = may learn the object exists (count, ID, rank, timing). `—` = no
read and no existence signal. Rows are principals; columns are objects. "Platform" means the
global `EDITOR`/`ADMIN` role; "infra" means anyone with database, cloud-console or deploy access.

| Principal                                             | Public object | Object in workspace A   | Object in workspace B   | Personal A+B suggestion (owned by P)  | A-side or B-side source of that suggestion |
| ----------------------------------------------------- | ------------- | ----------------------- | ----------------------- | ------------------------------------- | ------------------------------------------ |
| Anonymous                                             | R             | —                       | —                       | —                                     | —                                          |
| Authenticated, no membership                          | R             | —                       | —                       | —                                     | —                                          |
| A-only member                                         | R             | R (per `read`)          | —                       | — (cannot even learn it exists)       | R only of A's own object                   |
| B-only member                                         | R             | —                       | R (per `read`)          | —                                     | R only of B's own object                   |
| A+B member `P` with both capabilities                 | R             | R                       | R                       | R (owner)                             | R of both sources                          |
| A+B member `Q`, not the owner                         | R             | R                       | R                       | — (owner-only; not shared by default) | R of both sources                          |
| A+B member lacking `cross-project-process` for either | R             | R (A only if member)    | R (B only if member)    | — (not generated or sealed)           | R of sources they belong to                |
| Former member of A (revoked)                          | R             | — immediately           | per own B status        | — if it depended on A                 | —                                          |
| Platform `EDITOR`/`ADMIN`                             | R             | —                       | —                       | —                                     | —                                          |
| Source-tool-only (connector)                          | R (public)    | write-only packets      | write-only packets      | —                                     | no read                                    |
| Infra admin (DB/console)                              | R             | ciphertext + opaque IDs | ciphertext + opaque IDs | ciphertext only                       | ciphertext only                            |

A cell reading "—" means the response is the generic `404` and carries no counts, totals,
cursors, ranks, timing signal or "something exists" hint, including in pagination metadata and
`Link` headers.

> **Proposed correction (§14.5, pending ratification).** The "Infra admin" row applies only to a
> database or backup administrator without KMS decrypt rights and without deploy rights; such a
> person still learns ciphertext sizes, volumes, write timing, access patterns and links between
> opaque IDs. Anyone who can deploy code or change KMS/IAM bindings is outside this row (§7 honest
> limit).

### 6.3 Cross-project processing (personal suggestions)

A personal suggestion is a hypothesis connecting an object in workspace A and an object in
workspace B, generated for one subject `P`.

1. **Generation requires, at generation time and again at every read:**
   - `P` is an active member of A and of B;
   - `P` holds `read` on both exact source objects;
   - **each workspace's controller has granted `cross-project-process`** covering those object
     classes (separately for A and for B);
   - for any model step, `external-model-process` is granted by both (§6.4).
2. **Storage.** The suggestion is stored in a **subject-owned namespace** in `private_ws`, not in
   A's or B's namespace. Its classification is the **intersection** of its sources' policies: if
   either source forbids export or model processing, so does the suggestion. It stores exact source
   references (`project/tool id`, kind, artifact id, version, SHA-256) as #208 already specifies,
   and nothing that lets a reader of only A or only B discover it.
3. **Non-disclosure to source sides.** No notification, activity entry, counter, badge, search
   facet or audit line in A or B refers to the suggestion. A-only and B-only members see no change
   in any response, including response time (§9.3).
4. **Revocation is immediate and total.** If `P` loses membership in A or B, or either controller
   withdraws `cross-project-process`, the suggestion becomes **sealed**: reads return the generic
   `404`, queued jobs and short-lived URLs for it fail on epoch mismatch (§8), and its content key
   is destroyed after a short, documented grace period (§10). It is never auto-regenerated.
   _Proposed correction (§14.2, §14.3, pending ratification): "immediate" means every finalization
   ordered after the revocation commit fails; bytes already released cannot be recalled. Sealing
   is an application decision, not KMS denial, and key destruction erases the suggestion only if
   it has its own independently erasable key and every copy of it is covered._
5. **No transitivity.** `P` reading A and B does not let `P` forward, export or release the
   result; those are separate capabilities (§6.5).
6. **Schema reuse.** The record format is #208's `oratlas.private-cross-finding/0.1.0`; the
   pure projector remains pure and receives the `authorize` function from the service layer.

### 6.4 Processing by models and agents

- **Default deny.** Private content is never sent to an external model, embedding service,
  third-party lookup or telemetry sink. This holds even when a user supplies a BYOK key: a user
  key proves who pays, not that the controllers agreed to disclosure.
- **Separate capability** `external-model-process`, set per workspace, naming the provider class
  (for example `none`, `byok-user`, `approved-provider`). Approved providers must be contractually
  zero-retention or the workspace policy must state the retention explicitly.
- **Prompt-injection posture.** Private content is _untrusted data_ even when it is the user's own.
  Agents that read it run with **no network egress, no tools that write outside the requesting
  subject's namespace, and no cross-workspace tool**. Agent output is validated against the
  evidence packet exactly as `LLM discussion output` already is (it is rejected if it cites an
  identifier absent from the packet), and never executes content or follows instructions found in
  it. A private prompt, completion or intermediate step is never logged.
- **One workspace per context window.** A model call may contain data from at most one
  authorization scope, except an owner-requested A+B call that satisfies §6.3 in full.

### 6.5 Release and declassification

Publishing anything derived from private data is a **new act**, not a flag flip.

1. Every source workspace's controller approves the **exact content, audience, provenance and
   contributor attribution** to be released (dual or n-ary approval; no single party can release a
   joint result).
2. Every named contributor consents to appear and to the stated role (CRediT roles describe human
   contributions only; software stays `actorKind: software`, per #208/#210).
3. Release creates a **new public record** with minimal fields and no private identifiers. It does
   not move or expose the private rows, and it cites only public identifiers.
4. Revocation after release can withdraw the public record using the existing lifecycle/tombstone
   mechanism; it cannot recall bytes already served, and the approval screen must say so.
5. Until all approvals exist the object stays private. Missing, expired or revoked approval fails
   closed.

## 7. Operators, administrators and break-glass

Platform `ADMIN`/`EDITOR` and infrastructure access are **operator duties**, not membership.

- **Application layer.** No platform role appears in `authorize()`. Editorial routes and the
  editor dashboard never query `private_ws`.
- **Data at rest.** Private content and any metadata that names a project or person is encrypted
  with an **envelope key per workspace** (data key wrapped by a cloud KMS key). The private
  service identity alone may unwrap; ordinary database administrators and backup operators see
  ciphertext and opaque IDs. Deleting a workspace key crypto-shreds its data, including in
  backups. _Proposed correction (§14.3, §14.5, pending ratification): this holds only when every
  key-encryption key version and every wrapped-key copy (live, backup, replica, recovery) is
  destroyed and no plaintext cache survives; ciphertext and opaque IDs still leak metadata._
- **Honest limit.** An operator who can deploy arbitrary code or alter the private service
  identity can ultimately obtain plaintext. This ADR does not claim to prevent that. It reduces
  routine exposure, makes access deliberate and observable, and bounds duration. _Proposed
  clarification (§14.5): the same limit applies to anyone who can change KMS key policy or IAM
  bindings for the decrypt permission._
- **Break-glass (only if institutionally required).** Requires: a recorded legal/institutional
  basis; two-person approval, neither being the requesting engineer; a time-boxed grant (hours,
  not days) scoped to named workspaces; a read-only role; an **independent append-only log**
  written outside the operator's control; and automatic notification of the affected controllers
  unless law forbids it. Unused grants expire; every use is reviewed afterwards. Without an agreed
  procedure, **no break-glass access exists.**
- **Infra-admin non-disclosure is a tested property** (T-ADM), not a policy promise.

## 8. Sessions, revocation and cache/token invalidation

F4 shows cookies cannot be revoked server-side. The private feature adds, without changing the
public cookie format for public use:

- **Authorization epochs.** `membership.epoch`, `entitlement.epoch` and `user.authz_epoch`
  (integers, bumped on any change: role change, leave, removal, account deletion, controller
  revoke of a capability, password/identity unlink).
- **No caching of decisions across requests.** `authorize()` reads current rows every request. A
  per-request memo is allowed; a cross-request or cross-process cache is not (as in #208).
- **Derived credentials carry the epoch.** Short-lived download URLs, job tickets, streaming
  tokens, export links and signed ingest receipts embed `(subject, workspace, epoch)` and are
  validated against the current epoch on use. A bump invalidates all of them at once.
- **In-flight work.** Long operations re-check the epoch at each stage and before returning or
  persisting a result; a transaction reads membership and epoch under a consistent snapshot so a
  mid-request revocation is seen no later than the final commit. The pure projector cannot
  guarantee atomicity across providers (as #208 notes), so the service layer owns this check.

  > **Proposed correction (§14.2, pending ratification).** The sentence "a transaction reads
  > membership and epoch under a consistent snapshot so a mid-request revocation is seen no later
  > than the final commit" is not true as written: a snapshot taken before a concurrent epoch bump
  > does not see that bump, so the request can still commit or respond after the revocation has
  > committed. §14.2 replaces it with a fenced, service-owned finalization requirement.

- **Private-scope session age.** Private routes additionally require the session `iat` to be within
  a configurable window (proposed 24 h) and ask for re-authentication beyond it, without shortening
  the public 7-day session.
- **Account removal / leave-group.** Bump epochs, seal dependent personal suggestions (§6.3),
  schedule key erasure for subject-owned data, and write a private audit record. Public records
  authored by the person follow the existing public lifecycle, not this path.

## 9. Side-channel and inference threat model

Assets: existence and identity of private projects; membership; contribution and credit;
unpublished findings; the links between workspaces.

### 9.1 Adversaries

Anonymous crawler; authenticated user with no membership; A-only member; B-only member; former
member; platform editor/admin; malicious or compromised connector; source-document author
(prompt injection through content); co-tenant of the database host; infrastructure operator.

### 9.2 Channels and controls

| Channel                                             | Leak example                                                              | Control                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Counts, totals, facets, pagination cursors          | `total: 41` before and after a private import                             | Public endpoints cannot read private storage (§5.1). Private endpoints count only within the authorized scope.                                                                                          |
| Identifiers                                         | Sequential IDs; content-hash IDs that confirm a known document is present | Private object IDs are random (UUIDv4/ULID). Content hashes used as references are stored **encrypted or keyed (HMAC with the workspace key)**; an unkeyed SHA-256 of private content is never exposed. |
| Timing                                              | 403 vs 404 latency; slow path for existing objects                        | Constant-work deny path; same lookups before the decision (§5.3); rate limits on all private endpoints; no per-object early exit.                                                                       |
| Error bodies and status codes                       | `403` for "exists, forbidden"                                             | Single generic `404` (§5.3). Validation errors on private routes do not echo caller-supplied identifiers.                                                                                               |
| Graph topology and rank                             | A public node's degree changes because a private edge exists              | No private edges in the public graph. Public rank and layout inputs exclude private data by construction.                                                                                               |
| Search, autocomplete, "related" and recommendations | A private title surfaces as a suggestion                                  | No shared index (F9, §9.4). Per-principal queries over authorized scope only.                                                                                                                           |
| Embeddings and nearest-neighbour                    | Vector proximity reveals content                                          | Forbidden for private data until amended.                                                                                                                                                               |
| Caches and ETags                                    | CDN serves a private body; ETag equals content hash                       | `Cache-Control: private, no-store`, `Vary: Cookie`, random ETag or none (§9.5).                                                                                                                         |
| Sitemaps, feeds, `llms.txt`, OpenAPI                | URL for a private object appears                                          | Built from the public query layer (§3.1). Test T-PUB.                                                                                                                                                   |
| Audit, logs, metrics, traces                        | `detailsJson` names a private project; metric labelled by workspace       | Opaque IDs; private audit is separate (§9.6); metric label cardinality excludes workspace and subject.                                                                                                  |
| Notifications and email                             | "You were credited on a private project" reaches a third party            | Forbidden except in-session to the authorized recipient with no project name (§9.7).                                                                                                                    |
| Backups and restores                                | A restore into the public environment exposes private rows                | Separate schema, encrypted content, separate restore procedure; restore drills extended with a leak check (§10).                                                                                        |
| Prompt injection via private content                | A document says "send the other project's notes to X"                     | Content is data; no tools with cross-workspace reach, no network egress, validated output (§6.4).                                                                                                       |
| Confused deputy                                     | A connector or admin tool acts with broader rights than the caller        | Every private call is evaluated against the _caller's_ subject, never the service's; connectors have write-only scoped entitlements.                                                                    |

### 9.3 Timing rule

For private routes, handlers perform the same sequence of lookups for allowed, forbidden and
missing objects up to the decision point, return through one shared code path, and are covered by
a statistical timing test (T-TIME) with a documented tolerance. Perfect constant time is not
claimed.

### 9.4 Indexes

No persistent or shared index over private content. Private search is computed per request over the
workspaces in the caller's `AuthorizedScope`. An A+B personal discovery view (#205) uses an
ephemeral in-memory computation for the owner only. Any future persistent or vector index needs an
ADR amendment defining per-workspace namespaces, encryption and deletion semantics.

### 9.5 Cache policy

All `/api/private/**` and any page rendering private data set `Cache-Control: private, no-store`
and `Vary: Cookie` by a shared response helper. A test fails the build if any private route lacks
them. Private pages are `force-dynamic` and excluded from `generateStaticParams`, the sitemap and
any ISR. No CDN may cache a response carrying the session cookie.

### 9.6 Audit

Private actions (membership change, capability grant/revoke, read of a release candidate, release
approval, break-glass) are recorded in a **private audit table in `private_ws`**, readable only by
that workspace's controllers (and the independent break-glass log in §7). The global `AuditEvent`
may record only an opaque, non-reversible event type and timestamp for operational counting, with
**no subject, project, title or detail**. A lint/test forbids private store types in the arguments
of `audit()`.

### 9.7 Attribution-specific leakage (required by #202 for #207)

An ORCID iD, acknowledgement, CRediT role, public source DOI or "thanks to" message can disclose
**participation in a private project** with no document published.

| Channel                                                                  | Rule                                                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contributor indexes, profile and ORCID lookup pages                      | Show only public records. A person page never lists, counts or hints at private participation.                                                                     |
| Graph / Explore cross-links, DOI citation trails, source citation counts | Private citations are not counted in any public total and create no public edge.                                                                                   |
| Controlled credit feeds, email, push                                     | No automatic "give back credit" message across separate confidential groups. No notification to a credited person, an author or a roster member about private use. |
| Third-party lookups (DOI, ORCID public API)                              | Do not query with private identifiers; a lookup is itself a disclosure.                                                                                            |
| Fingerprints (hashes of text, DOI sets, author lists)                    | Not exposed unkeyed (§9.2).                                                                                                                                        |
| Audit logs and telemetry                                                 | Opaque only (§9.6).                                                                                                                                                |
| Release                                                                  | Needs, per private source: controller approval + individual consent + role assertion (§6.5). **Personal authorized attribution is not publication approval.**      |
| Revocation                                                               | Removes private metadata and derived evidence/credit access immediately (§8); a released public record follows the public withdrawal path.                         |

Source-native `confirmed` / `verified` / `public` values from producers (#210) are retained as
**source assertions** and never satisfy any gate above.

## 10. Retention, deletion, encryption and data-protection responsibilities

> This section lists obligations for the owner and counsel. It is not legal advice, and a
> data-protection impact assessment (DPIA) is a prerequisite to enabling any workspace.

- **Roles (proposed, to be confirmed legally).** The project's institution is the _controller_ of
  its workspace data; ORAtlas acts as _processor_ under a data-processing agreement. For personal
  suggestions the owning user's institution should be treated as controller of the derived record,
  bounded by the intersection rule (§6.3).
- **Lawful basis and minimization.** Store only references, hashes (keyed), roles and the
  minimum text needed for the stated purpose. No full text of copyrighted articles by default.
- **Subject rights.** Access/export, rectification and erasure for contributor data inside a
  workspace are handled by the workspace controller through a documented procedure; erasure uses
  crypto-shredding (below) rather than row deletion alone.
- **Encryption.** TLS in transit; envelope encryption per workspace at rest (§7); secrets stay
  server-side exactly as `SECURITY.md` requires for tokens and keys; BYOK keys are never stored.
- **Retention defaults (proposed).** Private audit: 2 years. Sealed suggestions: key destroyed 30
  days after sealing. Closed workspaces: controller-chosen, default 90 days then key destruction.
  Backups: ciphertext only; key destruction makes them unreadable within the backup horizon.
  _Proposed correction (§14.3, pending ratification): only if the destroyed key material covers
  every key version and wrapped-key copy the backups depend on; otherwise erasure completes only
  when those backups and copies expire._
- **Public vs private erasure.** Unlike the immutable public ledger (F7), private data is
  **erasable**. Private content must never be copied into the public ledger, snapshots, exports
  or audit tables, because those cannot be erased.
- **Restore drills.** `scripts/backup-restore-drill.ts` gains a check that a restore into the
  public environment contains no readable private data.
- **Cross-border and vendor review.** Any approved model provider or KMS region needs a recorded
  assessment before use.

## 11. Test matrix and acceptance mapping

Tests are specified here; none is implemented by this ADR. All run in CI against PostgreSQL with
the role split. IDs are stable so later PRs can reference them.

| ID       | Scenario                                                                                                                                                                               | Expected result                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| T-IMP    | A module outside `app/api/private` or `lib/private` imports the private package                                                                                                        | `architecture-boundaries` fails CI.                                                                                                            |
| T-ROLE   | The public DB role runs `SELECT` on any `private_ws` table                                                                                                                             | Permission denied.                                                                                                                             |
| T-RLS    | A service query omits the workspace filter                                                                                                                                             | RLS returns zero rows.                                                                                                                         |
| T-PUB    | Seed private data in A and B; call every public route in §3.1, sitemap, feeds, `llms.txt`, OpenAPI, exports and snapshots as anonymous, as A-only, B-only, A+B and as `EDITOR`/`ADMIN` | Responses are **byte-identical** to the same run with no private data (counts, totals, cursors, ordering, headers other than date/request id). |
| T-GRID   | Evaluate every cell of §6.2 for every private route                                                                                                                                    | Allowed cells return content; every other cell returns the same generic `404`.                                                                 |
| T-NOINF  | As A-only, request an A+B suggestion id, a B object id, and a random id                                                                                                                | Indistinguishable status, body and headers.                                                                                                    |
| T-TIME   | Time deny vs missing vs allowed-but-empty over N samples                                                                                                                               | Distributions not separable at the documented tolerance.                                                                                       |
| T-REV    | Remove membership, withdraw `cross-project-process`, delete account, leave group                                                                                                       | Next request returns `404`; queued jobs, download URLs and tokens fail on epoch; dependent suggestions sealed.                                 |
| T-MID    | Revoke while a long job and a paginated read are in flight                                                                                                                             | No data returned after the epoch bump; no partial private result persisted.                                                                    |
| T-CACHE  | Private routes and pages                                                                                                                                                               | Carry `private, no-store` and `Vary: Cookie`; no ETag from content; a second principal never receives the first's body.                        |
| T-ADM    | `EDITOR`/`ADMIN` session and a DB-admin connection attempt to read private content                                                                                                     | App returns `404`; DB shows ciphertext and opaque IDs only.                                                                                    |
| T-BG     | Break-glass use                                                                                                                                                                        | Requires two approvals, expires, writes the independent log, notifies controllers.                                                             |
| T-CAP    | Principal with `read` but not `cross-project-process` / `external-model-process` / `export` / `release`                                                                                | Each denied independently.                                                                                                                     |
| T-LLM    | Request a model call over private data with default policy; then with a BYOK key                                                                                                       | Denied both times unless the workspace grants `external-model-process`.                                                                        |
| T-INJ    | Private document containing instructions to exfiltrate or call tools                                                                                                                   | No tool call, no network call, output rejected if it cites an identifier outside the packet.                                                   |
| T-ATTR   | Credit a person on a private source; inspect profile, contributor index, ORCID lookup, feeds, notifications, email, citation counts, audit                                             | No trace outside the authorized recipient's session; no third-party lookup performed.                                                          |
| T-REL    | Release with one of two controller approvals, or one missing contributor consent                                                                                                       | Stays private; with all approvals creates a new public record that contains no private identifier.                                             |
| T-INV    | Invitation with wrong identity, expired token, reused token                                                                                                                            | One generic message; no workspace name revealed.                                                                                               |
| T-ROSTER | Import an ORCID roster (#210)                                                                                                                                                          | Candidate contacts only; no membership, no verified account, no access.                                                                        |
| T-LOG    | Run all of the above with debug logging                                                                                                                                                | No private title, quote, name or workspace label in logs, metrics or global `AuditEvent`.                                                      |
| T-PUBBC  | Existing public contract and regression suites, #208 tests, #210 tests                                                                                                                 | Pass unchanged.                                                                                                                                |

> **Proposed corrections to this matrix (§14.6, pending ratification).** T-MID's expected result
> ("no data returned after the epoch bump") is not achievable for bytes already released; §14.2
> restates it. T-ADM can only evaluate the database/backup administrator case (§14.5). T-IMP has a
> bounded static precursor in `scripts/architecture-boundaries.test.ts`; that precursor is not
> T-IMP and not proof that a public endpoint cannot reach private data.

### Acceptance criteria from #202

| #202 acceptance item                                                                                          | Where satisfied                        |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Documented non-interference policy and public/private endpoint matrix reviewed before storage/API work        | §3, §6.2, §9; gate G0 below            |
| A-only, B-only, A+B, anonymous yield disjoint projections; no B metadata/count/side channel to A-only         | §6.2, §6.3, §9; T-GRID, T-NOINF, T-PUB |
| Revoke / remove-account / leave-group and post-revocation cache/token invalidation tests                      | §8; T-REV, T-MID, T-CACHE              |
| Public APIs remain public-only and backwards compatible; no cross-project global index                        | §3.1, §5.1, §9.4; T-PUB, T-PUBBC       |
| Human/AI processing and release permission separate from read; no private notes to external models by default | §6.4, §6.5; T-CAP, T-LLM, T-REL        |
| Ratify chosen model and enumerate migration/data-retention consequences                                       | §12 (ratification), §10, §13           |
| Infrastructure-admin non-disclosure (administrator refinement)                                                | §7; T-ADM, T-BG                        |
| Attribution privacy scenarios (#207)                                                                          | §9.7; T-ATTR, T-REL                    |

## 12. Decisions requiring owner ratification

The table shows the options considered and the recommendation. The outcome column records the owner's decision.

| #   | Decision                                                                                                            | Recommendation                                             | Alternatives and cost                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Separate schema + DB role + separate client package, Postgres-only (§5.1)                                           | Adopt                                                      | Same tables with row filters (rejected: F1/F2). Separate database/instance (stronger, more operations; adopt later if needed). |
| D2  | Single `authorize()` with route/service/RLS enforcement (§5.2)                                                      | Adopt                                                      | Policy in each route (rejected: drift).                                                                                        |
| D3  | Workspace roles `controller`/`member`/`reader` and five independent capabilities (§4.3, §6)                         | Adopt                                                      | Finer object-level ACLs (defer until needed).                                                                                  |
| D4  | Membership only by controller grant or accepted invitation; never by ORCID, GitHub org, roster or authorship (§4.2) | Adopt                                                      | Sync from GitHub teams/ORCID (rejected: identity is not authority).                                                            |
| D5  | Epoch-based revocation and no cross-request authorization cache (§8)                                                | Adopt                                                      | Server-side session table (also needed for "log out everywhere"; can be added without changing this design).                   |
| D6  | Envelope encryption per workspace with cloud KMS; crypto-shredding for erasure (§7, §10)                            | Adopt, KMS vendor per `docs/gcp-deployment.md` environment | App-level only (weaker against DB admins).                                                                                     |
| D7  | Break-glass: none unless an institutional procedure is approved (§7)                                                | No break-glass until a procedure exists                    | Standing admin read access (rejected by #202).                                                                                 |
| D8  | External model processing denied by default, per-workspace opt-in, even with BYOK (§6.4)                            | Adopt                                                      | Allow with BYOK (rejected: BYOK is not controller consent).                                                                    |
| D9  | No embeddings or shared index over private data (§9.4)                                                              | Adopt                                                      | Per-workspace encrypted vector namespaces (future amendment).                                                                  |
| D10 | Private audit separate from global `AuditEvent` (§9.6)                                                              | Adopt                                                      | Redacted rows in global table (rejected: F6 and editor readability).                                                           |
| D11 | Retention defaults in §10 and the controller/processor split                                                        | Adopt as starting point, subject to counsel and a DPIA     | —                                                                                                                              |

### Recorded outcomes (owner, 2026-10-19)

| #   | Outcome                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Adopted:** separate schema `private_ws` + separate DB role/pool + separate client package, Postgres-only.                                                                                             |
| D2  | **Adopted:** single `authorize()` enforced at route, service and RLS layers.                                                                                                                            |
| D3  | **Adopted:** roles `controller`/`member`/`reader` and five independent capabilities.                                                                                                                    |
| D4  | **Adopted:** membership only by controller grant or accepted invitation; never ORCID, GitHub org, roster or authorship.                                                                                 |
| D5  | **Adopted:** authorization epochs, no cross-request authorization cache. A server-side session table was not chosen (it may be added later).                                                            |
| D6  | **Adopted:** per-workspace envelope key via cloud KMS; erasure by crypto-shredding.                                                                                                                     |
| D7  | **Adopted:** no break-glass access exists until an institution defines and approves a procedure.                                                                                                        |
| D8  | **Adopted:** external model processing denied by default; per-workspace opt-in; a user BYOK key is not consent.                                                                                         |
| D9  | **Adopted:** no embeddings and no shared or persistent index over private data until an ADR amendment.                                                                                                  |
| D10 | **Adopted:** private audit kept in the private store; global `AuditEvent` holds no subject, project or detail.                                                                                          |
| D11 | **Provisionally adopted:** §10 retention numbers and the institution = controller, ORAtlas = processor assumption stand, **to be confirmed by counsel and a DPIA before any real data is stored (G2).** |

The outcomes above are the historical record and are not changed by the follow-up review. The
refinements in §14 are **separate proposals awaiting ratification**; they are not D1–D11 outcomes,
and the 2026-10-19 acceptance does not cover them.

## 13. Rollout gates and migration consequences

Nothing below is built by this ADR. Each gate must be met, with its tests green in CI, before the
next starts.

| Gate | Condition                                                                                                                                                                                                                        | Unlocks                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| G0   | Owner decisions D1–D11 recorded (done, 2026-10-19).                                                                                                                                                                              | Any R1 work                                             |
| G1   | T-IMP, T-ROLE, T-PUB harness and the `private, no-store` helper exist and run in CI against an empty private schema; public contract tests snapshot current responses.                                                           | Creating `private_ws` tables                            |
| G2   | Principal resolution, epochs, `authorize()`, RLS and invitation flow implemented; T-GRID, T-NOINF, T-REV, T-MID, T-CACHE, T-INV pass. **Plus** counsel and a DPIA have confirmed D11 (retention and controller/processor roles). | Storing any private content (#204)                      |
| G3   | Encryption/KMS, private audit, T-ADM, T-LOG, backup-restore leak check pass.                                                                                                                                                     | Real connectors (#206, PR B of #209)                    |
| G4   | Independent security review of §5–§9; penetration test of `/api/private/**`; T-TIME tolerance agreed.                                                                                                                            | Personal discovery (#205)                               |
| G5   | Capabilities, model policy and release flow implemented with T-CAP, T-LLM, T-INJ, T-ATTR, T-REL passing.                                                                                                                         | Cross-project suggestions, release (#207, PR C of #209) |
| G6   | Per-workspace allowlist, feature flag **default off**, kill switch that seals all private routes, incident runbook.                                                                                                              | Production enablement                                   |

> **Proposed correction (§14.1, pending ratification).** As written, G2 unlocks storing private
> content before G3 delivers encryption, private audit, T-ADM, T-LOG and the backup-restore leak
> check. §14.1 proposes that G2 alone unlocks synthetic, fixture-only data, and that **both G2 and
> G3** are required before any real private content is stored. G4–G6 and the default-off flag and
> kill switch are unchanged.

**Migration consequences.** Additive only: a new schema, role, package and `/api/private/**`
prefix. No existing table, column, route or response changes. Existing data stays public and
unchanged. Rolling back is dropping the feature flag and sealing the routes; because private data
sits in its own encrypted namespace it can be destroyed without touching the public ledger.
`SQLite` deployments are unaffected and cannot enable the feature.

**Dependencies on adjacent work.** #203 (verified ORCID) improves identity assurance for
invitations but is not an access input. #204 implements §5.1 and §5.2. #206 and PR B of #209 bind
validated source observations to a workspace through the §4.3 entitlement; PR C of #209 and #207
implement §6.3–§6.5. #208's projector and #210's adapters are consumed unchanged.

## 14. Proposed refinements from the R0 follow-up review (PROPOSED — pending owner ratification)

> **Status: PROPOSED.** This section comes from the R0 follow-up review
> ([`private-workspace-r0-review.md`](./private-workspace-r0-review.md)). It is **not accepted**.
> The owner's 2026-10-19 acceptance of D1–D11 (gate G0) does not ratify anything here, and D11
> remains provisional. Each subsection names the earlier text it would correct; that text stays
> in place as the historical record. Until the owner rules, the review recommends that R1 work
> follow whichever of the earlier text and this section is stricter. That recommendation is itself
> part of the proposal.

Nothing in this section is implemented. It states requirements for future work and corrects
claims that were stronger than the design can deliver. It gives no universal security, privacy
or timing guarantee.

### 14.1 Gate ordering: no real private content before encryption (corrects §13 G2/G3)

Problem: G2 unlocks "storing any private content (#204)" while encryption/KMS, private audit,
T-ADM, T-LOG and the backup-restore leak check arrive only with G3. Real private content could
therefore be written in plaintext, logged or backed up before the controls that protect it exist.

Proposed rule:

1. G2 alone unlocks **synthetic, fixture-only** private rows: generated test data with no real
   person, project, title, membership or source content, in CI or local development only.
2. Storing **any real private content or metadata** (including names, titles, membership and
   source-tool packets) requires **both G2 and G3** to be complete, plus the counsel/DPIA
   confirmation of D11 that G2 already requires.
3. G4, G5 and G6 are unchanged and still gate their features. Production enablement still requires
   G6: per-workspace allowlist, feature flag **default off**, a kill switch that seals all private
   routes, and an incident runbook. Nothing here relaxes them.

### 14.2 Revocation, finalization and in-flight work (corrects §8 "In-flight work", §6.3 item 4, T-MID)

Problem: §8 says a transaction under a consistent snapshot sees a mid-request revocation "no later
than the final commit". A snapshot does not see an epoch bump committed after it began, so on its
own it cannot order a revocation against a concurrent read, write, job or response.

Proposed requirement (service layer; not implemented):

1. **Revocation point.** A revocation takes effect at the commit of the epoch bump (membership,
   entitlement, capability or `user.authz_epoch`).
2. **Fenced finalization.** Every externally visible effect is a _finalization_: persisting a
   derived result, releasing a response body or page, starting or continuing a job stage, and
   issuing a derived credential (URL, ticket, token). A finalization succeeds only after a check
   that is **serialized against revocation**. For example, the finalizing transaction locks or
   compare-and-sets the same epoch rows the revocation updates (`SELECT … FOR SHARE` against an
   `UPDATE`, or an epoch predicate on the write), or runs at `SERIALIZABLE` and retries on
   conflict. The mechanism is an implementation choice; the ordering property is the requirement.
3. **Guarantee offered.** Each finalization is ordered either before the revocation commit (it was
   authorized when it happened) or after it (it fails with the generic not-found result, or the
   job aborts with nothing persisted).
4. **Limits stated plainly.** Bytes released before the revocation commit **cannot be recalled**.
   A response that was finalized just before the revocation may still reach the client. The pure
   projector (#208) does not provide this ordering, and nothing in R0 implements it.
5. **Streaming.** Streaming, long-poll and incremental responses need a separate specification of
   their authorization boundary (for example, each chunk or page as its own finalization) before
   any such private route exists.
6. **T-MID as proposed:** revoke during an in-flight job and a paginated read, using deterministic
   interleavings (barriers or hooks, not wall-clock timing). Expected: every finalization ordered
   after the revocation commit fails; no partial derived result is persisted after that point;
   pages released before it are recorded as released, not claimed to be recalled.

### 14.3 Key lifecycle and crypto-erasure (corrects §3.2 Backups, §6.3 item 4, §7, §10)

Problem: with envelope encryption, a data key (DEK) is stored wrapped by a KMS key-encryption key
(KEK). Deleting the **live** wrapped DEK does not destroy wrapped copies held in backups, replicas,
point-in-time-recovery logs, exports or restore-drill environments. Those copies stay unwrappable
for as long as a KEK version that wrapped them is usable. Sealing (an epoch bump) is an application
decision; it does not revoke the service identity's KMS decrypt permission.

Proposed rule:

1. "Crypto-erased" may be claimed for an erasure unit only when **both** hold:
   - _either_ every KEK version able to unwrap its DEK is destroyed (after the provider's
     scheduled-destruction window), _or_ every wrapped-DEK copy is destroyed (live, backup,
     replica, PITR, export, drill, and recovery or escrow material); **and**
   - no plaintext survives in caches, temporary files, logs, search state or a model provider's
     retention.

   Until then the record is **sealed**, not erased, and documents must say so.

2. Erasure that relies on backups expiring completes only at the end of the backup horizon. The
   retention table must state that date, not the key-deletion date.
3. **Derived-record keys.** Each subject-owned personal suggestion (§6.3) should have an
   **independently erasable key**, so it can be erased without destroying the A or B workspace
   key, and so erasing A or B is defined to cover derived records that depend on it.
4. **Wrapping and recovery dependencies must be ratified before suggestions are built (G5).**
   Options include a per-suggestion KEK, a subject KEK, a DEK wrapped under both workspace keys, or
   a service key. Each has different erasure and recovery behaviour. Neither workspace key alone
   cryptographically enforces the A∩B intersection rule (§6.3 item 2); intersection is an
   authorization property unless a specific dual-wrapping scheme is adopted and analysed.
5. KMS decrypt permission, key-policy changes and key-version destruction are privileged operations
   with their own audit, outside the application's control (§14.5).

### 14.4 Authorization precedence (refines §4.3, §5.2, §6.1–§6.3)

Proposed required behaviour of the future `authorize()` and private service. This is **not** a
description of the current #208 projector, which authorizes per **project** through a callback that
receives project IDs only (see [`private-research-credit.md`](./private-research-credit.md)).

1. **Prerequisite.** Active membership in the workspace and the workspace-level capability for the
   action (`read`, `cross-project-process`, …) are required. Without both, the result is `Deny`.
2. **Narrowing only.** Any class-level or exact-object restriction a controller sets (§4.3 "where
   narrower, per object class"; §6.3 "read on both exact source objects") can only narrow access.
   It never broadens a workspace capability and never grants access without membership.
3. **Fail closed.** An explicit deny wins over an allow. A missing rule, an unknown action, class or
   object, and any error while loading or evaluating policy all yield `Deny`.
4. **`owner-only` restricts; it does not grant.** Owning a personal suggestion never substitutes for
   membership or capabilities on its sources.
5. **Withheld stays withheld.** `withheld` identities and content (§6.1) cannot be reconstructed by
   any role, including the owner, a controller and platform or infrastructure administrators. This
   covers credit, provenance, activity, audit and admin views. Derived records must not copy them.
6. **Both sources, independently.** For an A+B derived record, each exact source is authorized on
   its own (read on that object and `cross-project-process` from its controller). An allowed source
   never vouches for the other.

Historical **D3** adopted roles and five capabilities and **deferred finer object-level ACLs until
needed**. This proposal keeps that deferral. It does not adopt a general per-object ACL model; it
only fixes precedence for whatever narrowing restrictions exist.

### 14.5 Evidence wording and operator classes (refines §2 F12, §6.2, §7, §9, §11)

1. **Static import evidence is bounded.** The private-import guard in
   `scripts/architecture-boundaries.test.ts` checks literal module specifiers and barrel-selected
   names in `apps/web/src`. It does not see computed imports, values laundered through a new barrel
   or alias module, runtime data flow or database credentials. It is a precursor to T-IMP, not
   proof that a public endpoint cannot reach private data.
2. **Future gates remain future.** No endpoint, RLS, KMS, cache, timing or administrator test
   (T-PUB, T-ROLE, T-RLS, T-CACHE, T-TIME, T-ADM) exists yet. No document should describe these
   properties as verified.
3. **Two operator classes.** (a) Database or backup administrators without KMS decrypt and without
   deploy rights see ciphertext and opaque IDs. Ciphertext still leaks sizes, row volumes, write
   timing, access patterns and links between opaque IDs. (b) Anyone who can deploy arbitrary code,
   alter the private service identity, or change KMS key policy or IAM bindings can obtain
   plaintext (§7 honest limit). T-ADM can evaluate only class (a).
4. **No universal guarantees.** T-TIME bounds measured distinguishability at an agreed tolerance;
   it is not a constant-time guarantee. Metadata minimization reduces, but does not remove,
   inference from volume and timing.

### 14.6 Proposed test-matrix changes (§11)

| ID      | Proposed change                                                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| T-MID   | Replace the expected result with §14.2 item 6.                                                                                                |
| T-ADM   | Scope to operator class (a) in §14.5; class (b) is a documented residual risk, not a test.                                                    |
| T-IMP   | Keep as specified. Record the static guard as a bounded precursor (§14.5 item 1).                                                             |
| T-ERASE | New: after erasure, no surviving KEK version or wrapped-DEK copy decrypts a sampled backup, replica or drill copy of the erased unit (§14.3). |
| T-POL   | New: precedence cases of §14.4, including unknown class, explicit deny over allow, `owner-only` without membership and `withheld` fields.     |
| T-GATE  | New: no real private content is accepted while G3 is incomplete (§14.1).                                                                      |
