# Data model

The Prisma schema (`packages/db/prisma/schema.prisma`) uses SQLite for local development and is
written to be PostgreSQL-compatible: enum-like fields are `String` columns validated at the
application layer by `@oratlas/contracts`, JSON payloads are `String` columns with a `…Json`
suffix, and arrays are JSON-encoded strings. Switching to PostgreSQL is a datasource change plus
`prisma migrate deploy`.

## Entities

| Model                                    | Purpose                            | Key constraints                                                                   |
| ---------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `User`                                   | Minimal GitHub identity + role     | `githubUserId` OAuth key; normalized login indexed and application-checked        |
| `Repository`                             | Evolving GitHub project            | immutable `githubRepositoryId`; URL/name remain renameable                        |
| `RepositorySnapshot`                     | Exact repository state             | **`(repositoryId, commitSha)` unique**                                            |
| `KnowledgeNode`                          | Stable graph identity              | global `stableKey` expands existing **`(repositoryId, localNodeId)`** identity    |
| `KnowledgeNodeVersion`                   | Immutable node content snapshot    | exact source-object bindings expand existing repository snapshot identity         |
| `NodeEdge`                               | Typed graph relation               | source occurrence discriminator preserves 1:1 compatibility bindings              |
| `NodeEdgeProposal`                       | Attributable edge assertion        | `originKey` unique; revisioned editorial CAS; optional confirmed edge             |
| `NodeRelationTrustAssessment`            | Imported TRUST for one node edge   | mandatory proposal FK; exact source record and criterion columns                  |
| `NodeRelationTrustVerification`          | Atlas review of node-edge TRUST    | one-to-one marker; reviewer, role snapshot, rationale, canonical subject hash     |
| `NodeAlias`                              | Canonical node work-identity key   | per-node scheme/role/value unique; shared values intentionally allowed globally   |
| `Review`                                 | Public review record               | `slug` unique; nullable 1:1 stable graph binding during migration                 |
| `ReviewVersion`                          | Immutable version                  | exact snapshot; DOI roles; materialized public lifecycle state                    |
| `ReviewLifecycleEvent`                   | Append-only scholarly lifecycle    | `(reviewId, revision)` unique; same-review correction/withdrawal/tombstone        |
| `Person` / `ReviewContributor`           | Authors & roles per version        | contributors ordered by `position`                                                |
| `Submission`                             | Editorial workflow record          | immutable `submittedPayloadJson`; `status`                                        |
| `InspectionCapture`                      | Exact inspect-to-submit payload    | token hash unique; user-bound, expiring, single-use; payload/hash append-only     |
| `EditorialOverride`                      | Scoped consistency exception       | `(submissionId, checkId)` unique; editor and rationale retained                   |
| `Identifier`                             | DOIs/ORCID/URL/Zenodo per version  | `relationType` distinguishes version vs concept DOI                               |
| `Claim`                                  | A review claim                     | `(reviewVersionId, localClaimId)` unique; optional stable-node backlink           |
| `Citation`                               | A cited-source occurrence          | local identity plus canonical/fallback work and exact graph-version bindings      |
| `ClaimEvidenceRelation`                  | Claim↔citation compatibility view  | unique tuple plus nullable 1:1 canonical-edge binding during migration            |
| `WorkIdentityConflict`                   | Ambiguous work-alias resolution    | one fail-closed audit record per citation occurrence                              |
| `TrustAssessment`                        | Imported TRUST for one relation    | public import state is `unverified-import`; source assertions retained separately |
| `TrustVerification`                      | Atlas editorial review marker      | one-to-one with assessment; reviewer FK, role snapshot, rationale, subject hash   |
| `AgentRun`                               | Provenance of an agent action      | model/provider/prompt + prompt/packet/input hashes; validated output              |
| `ExecutionPassport`                      | Signed execution provenance        | attestation hash unique; exact commit/tree/workflow; verification revision        |
| `ExecutionPassportClaim`                 | Passport↔immutable claim binding   | `(passportId, claimId)` unique                                                    |
| `ExecutionPassportArtifact`              | Exact run input/output descriptor  | `(passportId, entityId)` unique; SHA-256 + byte size                              |
| `DiscussionThread` / `DiscussionMessage` | Atlas Discuss history              | grounding + model metadata                                                        |
| `ReviewComment`                          | Human peer commentary on a version | `reviewVersionId`, optional `claimId`, one-level `parentId`; soft `status`        |
| `Challenge`                              | Formal objection to exact subject  | server-derived subject JSON + SHA-256; version, challenger, grounds, lifecycle    |
| `ChallengeTransition`                    | Append-only challenge lifecycle    | `(challengeId, revision)` unique; actor and role snapshot                         |
| `KnowledgeLinkProposal`                  | Cross-review link proposal         | `(source, target, relation)` unique; `status`                                     |
| `Publication`                            | Stable source-publication identity | `stableKey` unique; record-source union; nullable 1:1 legacy review projection    |
| `PublicationVersion`                     | One exact observed version         | **`(publicationId, sourcesSha256)` unique**; immutable; URL is never identity     |
| `PublicationVersionContributor`          | Exact-version scholarly credit     | **`(publicationVersionId, sourceContributorKey)` and position unique**; immutable |
| `PublicationProductionAssertion`         | Production history for one version | append-only; source declaration or exact ORAtlas execution attestation            |
| `PublicationRelation`                    | Reviewed publication transfer      | append-only; explicit reviewer; never an inferred merge                           |
| `PublicationCapture`                     | Exactly what ORAtlas observed      | append-only bytes and digests; no update, no delete                               |
| `PublicationClaimOccurrence`             | One claim occurrence in a version  | `(publicationVersionId, sourceLocalClaimId)` unique; write-once canonical binding |
| `AuditEvent`                             | Append-only audit trail            | operation key + `(subjectType, subjectId)` indexed                                |
| `IdempotencyKey`                         | Retry-safe operation claim         | primary-key uniqueness; same decision transaction                                 |

## Immutability and versioning

- A `RepositorySnapshot` is uniquely a `(repository, commitSha)` pair — the exact reviewed state.
- A `KnowledgeNode` is a stable concept identity within its owning repository. Its kind is a
  contract-validated string and content is stored only on `KnowledgeNodeVersion` rows.
- Every `KnowledgeNodeVersion` binds to a `RepositorySnapshot`; its exact commit SHA is therefore
  `version.snapshot.commitSha` and is not duplicated in a drift-prone second column. Contributors,
  provenance, and kind-specific payloads are retained as portable JSON-encoded string columns.
- Editorially materialized node versions also retain nullable `sourceSubmissionId`,
  `inspectionCaptureId`, and `capturePayloadHash` provenance. The relations are many-to-one because
  one accepted capture can contain several nodes; together they let KG-04 audit and replay the exact
  accepted bytes without making the deduplicated repository snapshot carry submission state.
- Prisma foreign keys cannot express the required cross-table equality: the node, snapshot, and
  submission must belong to one repository; the submission must select that snapshot and capture;
  and the capture's immutable GitHub repository id, commit SHA, and payload hash must match the
  repository, snapshot, and node-version provenance. KG-04 materialization must call
  `assertKnowledgeNodeMaterializationBinding` inside the acceptance transaction and fail closed
  before creating a node version when any value differs.
- A `NodeEdge` starts at one immutable source version and targets a stable node identity. Relation,
  status, and provenance remain separate contract-validated string columns so proposed and
  editor-confirmed meanings cannot be conflated.
- Repository and agent assertions live in `NodeEdgeProposal`, not in the authoritative edge row.
  Author proposals retain their accepted submission, capture, source pointer and payload hash;
  cross-lab author targets use an immutable GitHub repository id plus commit SHA and fail closed
  unless that address resolves exactly once. Immutable source identity is required when selected
  endpoints would actually materialize an author proposal; dangling declarations do not block a
  legacy review-only acceptance. Agent proposals require a succeeded
  `node-edge-proposal` run whose canonical output candidate and SHA-256 match the request. The
  observed target version is frozen on every proposal. Stable endpoint keys, rather than mutable
  database ids, drive origin idempotency so legacy repository reconciliation can rewire foreign
  keys without changing provenance. Confirmation uses a serializable revision CAS and only then
  creates or reuses a `NodeEdge`; rejection creates no edge. Independent origins can therefore
  support the same logical tuple without overwriting one another.
- Repository lifecycle fields are untrusted. Legacy declarations that claimed `confirmed` or
  `confirmed-by-editor` are normalized to author proposals, and only a current editor/admin can
  write the confirmation audit. Public projection additionally requires the confirmer's current
  role to remain `EDITOR` or `ADMIN`, plus a timestamp, frozen target version, and exact ownership
  of that version by the target identity; non-editor-attributed, incomplete, or misbound legacy
  rows stay private. Contradiction endpoints are canonically ordered, leaving one stored row that
  public projection reads from both endpoints.
- A `NodeAlias` retains its DOI/PMID/OpenAlex scheme and semantic role. Version, concept, artifact,
  and external-work DOI roles therefore remain distinguishable. The same canonical value may
  belong to several stable nodes: that match is indexed evidence for a reviewable proposal, never
  a database uniqueness collision or an automatic merge. Example aliases remain stored and
  flagged for provenance but are excluded from identity matching.
- Source selection is not snapshot identity. `Submission` and `ReviewVersion` retain the exact
  capture, source kind, branch/tag/release, tag object and selection key. The same commit can
  therefore have distinct default-branch, tag, and release versions without mutating the snapshot.
- `Repository.githubRepositoryId` is the authoritative identity across owner/name changes.
- Reinspection creates a new `InspectionCapture`, while `RepositorySnapshot` stays deduplicated by
  repository and commit. Captures store exact canonical bytes and SHA-256 independently.
- Accepting a submission creates a **new** `ReviewVersion` bound to that snapshot. Earlier
  versions are never destroyed; `Review.currentSnapshotId` points at the latest.
- Historical UI/API routes resolve the chosen version's own snapshot and evidence. Comments are
  version-scoped and read-only on historical routes; nullable version ids only support legacy rows.
- Formal challenges bind to exactly one claim, claim–evidence relation, or assessment criterion
  instance through explicit foreign keys plus canonical subject JSON and SHA-256. Relation
  subjects include both exact same-version endpoints and their full semantic bytes; criterion
  subjects embed the canonical TRUST subject, exact relation, assessment provenance, and one
  persisted contract-valid criterion value. Filing and every transition resolve the target within
  the named immutable review version. Public reads repeat that resolution and omit a record when
  either canonical bytes or hash differ. Challenge
  lifecycle writes never update the claim, relation, assessment, TRUST value, or compatibility.
- `ChallengeTransition` is the authoritative append-only lifecycle ledger. Revision zero records
  attributed filing (`null → open`); optimistic compare-and-set advances only legal edges
  (`open → author-responded → resolved|dismissed|withdrawn`). Every read/write validates contiguous
  revisions, legal edges, enum-valid actor snapshots, and agreement with the mutable projection.
  The challenge and every ledger event also carry a canonical filed-content hash over the immutable
  subject binding, challenger, grounds, and body. At most ten active (`open` or
  `author-responded`) challenges may target one canonical subject. A nullable unique digest of
  challenger plus subject hash prevents concurrent duplicate active filings on both SQLite and
  PostgreSQL; terminal transitions clear it atomically so a later filing is possible. Terminal
  states cannot transition. Pre-J03 active rows acquire the key lazily on list, filing, or
  transition. If legacy data already contains duplicates, the oldest `(createdAt, id)` row owns
  the key; all duplicates remain visible and transitionable, and ownership advances after terminal
  closure.
- `ChallengeResponse` is an immutable, one-per-challenge record created only by a contributor of
  record. It snapshots the responding user role and the matched `Person` identity, GitHub login,
  display name, and contributor roles, and binds those fields plus its bounded plain-text body to a
  canonical SHA-256. Response creation and `open → author-responded` are one serializable,
  compare-and-set transaction; the transition carries the exact response-content hash and its
  actor/revision must agree with the response snapshot. Missing, deleted, or mismatched response
  evidence fails closed. The bare transition is rejected.
- Challenge and response moderation retain original bytes and content digests while advancing a
  separate content revision to a public `removed` tombstone. Public DTOs return an empty body and
  never expose remover identity, remover role, removed bytes, terminal rationale, or internal actor
  roles. Moderation and its audit event commit atomically. Terminal `ChallengeTransition` rows
  remain the authoritative resolution record; rationale is editorial-only pending governance §9.
- `Submission.submittedPayloadJson` is the immutable snapshot of exactly what the submitter
  finalized, including the versioned node-extraction report. Editorial acceptance rechecks those
  candidates against the consumed capture. `acceptedNodeSelectionJson` stores the editor's sorted
  local-id subset and `acceptedNodeSelectionHash` makes an identical retry idempotent while a
  different retry conflicts.
- Acceptance binds `ReviewVersion.sourceSubmissionId` uniquely and stores its public consistency
  report, inspection-capture reference, and capture hash. Transactional compare-and-set and unique
  constraints make retries safe. `(review, snapshot, sourceSelectionKey)` prevents duplicate
  publication of one selection while permitting different refs to the same commit.
- Selected node candidates materialize as immutable `KnowledgeNodeVersion` rows in that same
  serializable compare-and-set transaction. Node-only submissions leave both resulting-review
  fields null; rejected and changes-requested submissions create no public node version.

Source-local claim/citation ids are unique only inside a version. Atlas derives global ids from
`(reviewVersionId, localId)` and uses canonical DOI/PMID/OpenAlex aliases for work comparison. See
`docs/evidence-identity.md`.

The canonical-graph migration adds nullable, unique bindings from reviews, exact review versions,
claims, citation occurrences, and legacy claim-evidence relations to graph records. Repository
ownership is optional only under a database-guarded source union: repository objects require a real
repository, while review, claim-occurrence, and canonical-work nodes require a stable key and no
repository. Every graph version binds exactly one real source—repository snapshot, review version,
claim occurrence, or citation occurrence. SQLite triggers and PostgreSQL checks reject zero-source,
multiple-source, mismatched-kind, and fabricated-repository states. See
`docs/canonical-graph-identity.md`.

Accepted repository and synthesis review writes now invoke the canonical materializer inside their
existing serializable transaction. DOI, PMID, and OpenAlex aliases reuse a work only when the whole
observed alias set is compatible. Ambiguous aliases create a citation-local fallback work plus a
`WorkIdentityConflict`; no candidate is selected. Repeated citations to one work retain distinct
source-assertion edges through the legacy relation id, while editor-confirmed graph edges keep the
`canonical` discriminator.

KG-02 keeps ownership repository-scoped: the repository's `owner` identifies the publishing lab in
the current GitHub-based POC. A separate organization/lab authority model is not inferred from a
mutable display name and remains outside this schema slice.

Legacy repository reconciliation is conservative for graph records. Colliding node identities are
merged only when their kinds match; colliding versions, aliases, and edges are deduplicated only
when every immutable semantic/provenance field is exactly equal. Any mismatch aborts the
transaction for manual resolution rather than silently choosing one scholarly record.

## The generic publication boundary

`Review` is one _type_ of publication, not the federation object. `Publication`,
`PublicationVersion`, `PublicationCapture`, and `PublicationClaimOccurrence` are the boundary an
independently hosted publication is observed through, and the boundary legacy review storage
projects into. They are deliberately separate from `KnowledgeNode`: a source occurrence is never
canonical graph identity.

- A `Publication` is keyed from durable identity evidence — a git source, a concept DOI, an
  author-declared identifier plus a URL origin, an ORAtlas registration key, or an existing
  `Review`. A canonical URL alone is never a basis, and neither is a version DOI or an archive
  digest: each of those identifies one version, not the publication that persists across versions.
  `identityEvidenceJson` retains the chosen basis so the keying decision stays auditable.
- A `PublicationVersion` is identified by `(publication, sourcesSha256)`. The digest is the
  publication's own digest over its complete document set, so a plain website with no repository,
  DOI or archive still has an exact, recomputable version identity. Uniqueness is scoped to the
  publication rather than global, because two distinct publications may legitimately publish
  identical bytes. Adapter metadata lives in one closed, versioned, discriminated union stored as
  `adapterBindingJson`; the generic layer has no toolchain-specific columns. Publisher-declared
  `canonicalUrl` remains nullable and unmodified. The separate nullable
  `observedPublicationBaseUrl` is populated for new captures from the manifest's observed/requested
  URL; older rows derive it from their immutable manifest capture.
- `structuralProvenance` is `published-structure` or `source-byte`. These are structural states
  only: they record what ORAtlas checked about the published protocol structure and, where the
  source bytes were obtainable, about those bytes. Neither is scientific validation, and neither
  may be described as verified, trustworthy, confirmed, or peer reviewed. TRUST remains separate
  and relation-specific. A version with no source descriptor is refused `source-byte` at the
  database layer.
- A `PublicationCapture` is append-only on both providers: `UPDATE` and `DELETE` are rejected by a
  trigger, so bytes and digests can never silently mutate once later phases begin writing them. An
  observed `PublicationVersion` is likewise immutable.
- A `PublicationVersion` persists canonical normalized content JSON, its SHA-256, and explicit
  content completeness. Documents are inert plain text bound to exact capture identities and byte
  digests. The corpus is an evaluation representation, not scientific validation. It is written
  once with the exact version; old versions are never backfilled from a mutable website.
- A `PublicationVersionContributor` is an ordered immutable source declaration for one exact
  version. Names, ORCID/ROR values, affiliations and roles are retained metadata, not a canonical
  `Person` identity. Snapshots neither inherit to later versions nor arise from production actors.
  `contributorsDeclared` distinguishes a missing adapter declaration from a declared empty list.
  MyST 0.3 rows bind `sourceDeclarationProvenanceJson` to the exact captured publication-manifest
  slot identity and its byte SHA-256; no MyST-specific column or identity-resolution relation exists.
- A `PublicationClaimOccurrence` is an exact occurrence, never a canonical identity. Equal text, an
  equal source-local id in different versions, an equal `declarationSha256`, an equal
  `sourcesSha256`, position and similarity are all explicitly non-identities.
  `declarationSha256` is indexed but not unique. Its nullable `knowledgeNodeId` records an
  explicit, reviewed identity decision: it is never inferred and is write-once. The generic
  materializer writes it atomically with the exact graph-version source binding.
- A `PublicationProductionAssertion` is optional and belongs to one exact version. Its mode,
  production actors, and activities are descriptive provenance only. Production actors are not
  scholarly contributors. `source-declared` carries no verification claim;
  `oratlas-attested` references a succeeded `AgentRun` and/or verified `ExecutionPassport`.
  Corrections append a successor and leave the prior row intact; assertions never inherit to a
  later version automatically. MyST 0.3 source actor ids are uniqueness keys only and are stripped;
  the stored `identifier` field is reserved for separately declared stable/public actor metadata.
  Assertion activities are the source actor activities' first-seen ordered union.
- A `PublicationRelation` is an attributable editorial record between two distinct publication
  identities for continuation, mirroring, movement, derivation, republication, or versioning. It
  neither duplicates durable identity evidence nor infers continuity from title, author, text,
  digest, URL, or local id. It does not imply that any pair of claim occurrences is identical.
- `KnowledgeNodeVersion` gains a nullable, unique `sourcePublicationClaimOccurrenceId`. The exact
  version source union stays exclusive — exactly one real source, now counted across five columns
  instead of four — and the `KnowledgeNode` origin union is unchanged. External occurrences
  materialize as ordinary `claim-occurrence` / `claim` nodes, never a second graph.
- A `Certifier` is an admin-controlled accountable organization. Its scoped credentials retain
  only a digest, optional expiry, revocation state, and audited issuer/revoker; they are not editor
  or graph-governance identities.
- A `CertificationProtocol` is one immutable certifier-owned `(seriesKey, protocolVersion)` with
  canonical `protocolJson` and SHA-256. Criteria, permitted modes/outcomes, and completeness policy
  belong to that exact version; no ORA-specific evaluator is encoded here.
- A `CertificationRun` binds one exact `PublicationVersion` to one exact protocol and stores the
  common packet's exact canonical JSON—including scientific content and, from 1.3.0, contributor
  snapshots—full snapshot digest,
  schema version, capture time, and completeness. Database guards allow lifecycle status to
  advance but reject snapshot rewrites.
- A `CertificationResult` is the one immutable result accepted for a run. Database-native binding
  guards repeat the exact subject, certifier, protocol, assessment mode, and input hash invariants.
  Typed criterion evidence is validated against the frozen packet before insertion.
  `CertificationLifecycleEvent` appends issued/superseded/withdrawn/revoked history. Results from
  multiple certifiers coexist; nothing adds a certified boolean or universal score.

Existing `Review`, `ReviewVersion`, `Claim`, `Citation`, and `ClaimEvidenceRelation` storage is
unchanged in shape, meaning and public API. `Publication.reviewId` is the nullable projection
binding: a review projection owns exactly one review and an external publication owns none.
`ReviewContributor` remains the legacy review-ingestion authorship path; it is not migrated,
resolved, or joined to the generic `PublicationVersionContributor` federation snapshot path.
See `docs/external-publications.md`.

## The five information kinds

The UI (and this schema) keep these distinct (spec §12, §18):

1. **Repository facts** — from the GitHub API (repo, commit, release).
2. **Extracted metadata** — deterministic extraction, with `FieldProvenance` (source/file/pointer/
   commit/confidence).
3. **Human-curated metadata** — manual edits stored separately, with editor identity + timestamp.
4. **Repository/agent assertions** — imported TRUST status, assessor and review flags are retained
   as source provenance but are publicly `unverified-import`.
5. **Atlas-reviewed records** — a separate, current `TrustVerification` marker with status
   `human-reviewed`/`adjudicated`. This means the captured structure was reviewed, not that the
   scientific claim is correct.

## TRUST columns

`TrustAssessment` stores each criterion as its own JSON column
(`{rating, status, rationale, evidencePointer}`), so criteria remain individually queryable while
staying provider-portable. The criterion-level record is authoritative; `aggregateScore` +
`aggregateMethod` are recomputed by Atlas and advisory. Repository-supplied aggregate values,
including explicit `null`, live in the `source…` provenance fields and `sourceRecordJson`.

`TrustVerification` is valid only while its `assessmentHash` matches the SHA-256 of the canonical
reviewed subject: assessment criteria/evidence/source assertions, relation, claim and citation.
Every verification write uses `TrustAssessment.revision` as an optimistic-concurrency guard.
Missing legacy provenance and hash mismatches fail closed and remain visible in the editorial
queue.

`NodeRelationTrustAssessment` is deliberately separate from legacy claim–citation storage and
must reference exactly one `NodeEdgeProposal`; it is never attached to a bare node. Acceptance
creates it only when the exact accepted claim/evidence versions match one author proposal from the
same immutable capture. Partial node selection and prose-only acceptance skip unmatched records.
Proposal confirmation, rejection, and supersession preserve the assessment and marker for audit,
but only a currently confirmed proposal and its exact editor-confirmed edge are authoritative.

`NodeRelationTrustVerification` uses its assessment's independent `revision` CAS. Its canonical
hash includes the parsed imported record, all normalized assessment fields, proposal and confirmed
edge lifecycle state, stable endpoint keys, both complete immutable node versions, repository and
snapshot identities, capture/submission identities, and current confirmer role. Any mismatch,
mutation, rejected/superseded proposal, missing edge, or non-editor confirmer fails closed.

Execution Passport source JSON is retained for offline re-verification. Public reads require a
verified state and compare the re-verified package with all materialized repository, workflow,
identity, claim and artifact fields. Their status is the narrow `execution-attested`, never
“reproduced” or “true”.
