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
| `KnowledgeNode`                          | Stable publication-node identity   | **`(repositoryId, localNodeId)` unique**; contract-validated kind                 |
| `KnowledgeNodeVersion`                   | Immutable node content snapshot    | **`(knowledgeNodeId, snapshotId)` unique**; capture/submission provenance         |
| `NodeEdge`                               | Typed graph relation               | **`(sourceNodeVersionId, targetNodeId, relationType)` unique**                    |
| `NodeAlias`                              | Canonical node work-identity key   | per-node scheme/role/value unique; shared values intentionally allowed globally   |
| `Review`                                 | Public review record               | `slug` unique; `currentSnapshotId`; lifecycle CAS revision                        |
| `ReviewVersion`                          | Immutable version                  | exact snapshot; DOI roles; materialized public lifecycle state                    |
| `ReviewLifecycleEvent`                   | Append-only scholarly lifecycle    | `(reviewId, revision)` unique; same-review correction/withdrawal/tombstone        |
| `Person` / `ReviewContributor`           | Authors & roles per version        | contributors ordered by `position`                                                |
| `Submission`                             | Editorial workflow record          | immutable `submittedPayloadJson`; `status`                                        |
| `InspectionCapture`                      | Exact inspect-to-submit payload    | token hash unique; user-bound, expiring, single-use; payload/hash append-only     |
| `EditorialOverride`                      | Scoped consistency exception       | `(submissionId, checkId)` unique; editor and rationale retained                   |
| `Identifier`                             | DOIs/ORCID/URL/Zenodo per version  | `relationType` distinguishes version vs concept DOI                               |
| `Claim`                                  | A review claim                     | `(reviewVersionId, localClaimId)` unique; optional stable-node backlink           |
| `Citation`                               | A cited source                     | `(reviewVersionId, localCitationId)` unique                                       |
| `ClaimEvidenceRelation`                  | Claim↔citation relation            | `(claimId, citationId, relationType)` unique                                      |
| `TrustAssessment`                        | Imported TRUST for one relation    | public import state is `unverified-import`; source assertions retained separately |
| `TrustVerification`                      | Atlas editorial review marker      | one-to-one with assessment; reviewer FK, role snapshot, rationale, subject hash   |
| `AgentRun`                               | Provenance of an agent action      | model/provider/prompt/input-hash/output                                           |
| `ExecutionPassport`                      | Signed execution provenance        | attestation hash unique; exact commit/tree/workflow; verification revision        |
| `ExecutionPassportClaim`                 | Passport↔immutable claim binding   | `(passportId, claimId)` unique                                                    |
| `ExecutionPassportArtifact`              | Exact run input/output descriptor  | `(passportId, entityId)` unique; SHA-256 + byte size                              |
| `DiscussionThread` / `DiscussionMessage` | Atlas Discuss history              | grounding + model metadata                                                        |
| `ReviewComment`                          | Human peer commentary on a version | `reviewVersionId`, optional `claimId`, one-level `parentId`; soft `status`        |
| `KnowledgeLinkProposal`                  | Cross-review link proposal         | `(source, target, relation)` unique; `status`                                     |
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
- `Submission.submittedPayloadJson` is the immutable snapshot of exactly what the submitter
  finalized; editorial acceptance materializes the review from it.
- Acceptance binds `ReviewVersion.sourceSubmissionId` uniquely and stores its public consistency
  report, inspection-capture reference, and capture hash. Transactional compare-and-set and unique
  constraints make retries safe. `(review, snapshot, sourceSelectionKey)` prevents duplicate
  publication of one selection while permitting different refs to the same commit.

Source-local claim/citation ids are unique only inside a version. Atlas derives global ids from
`(reviewVersionId, localId)` and uses canonical DOI/PMID/OpenAlex aliases for work comparison. See
`docs/evidence-identity.md`.

Legacy `Claim` rows may optionally point to a stable `KnowledgeNode`. The nullable foreign key is
additive: existing review claims remain valid without a backlink, and several historical review
versions may refer to the same stable concept identity.

KG-02 keeps ownership repository-scoped: the repository's `owner` identifies the publishing lab in
the current GitHub-based POC. A separate organization/lab authority model is not inferred from a
mutable display name and remains outside this schema slice.

Legacy repository reconciliation is conservative for graph records. Colliding node identities are
merged only when their kinds match; colliding versions, aliases, and edges are deduplicated only
when every immutable semantic/provenance field is exactly equal. Any mismatch aborts the
transaction for manual resolution rather than silently choosing one scholarly record.

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

Execution Passport source JSON is retained for offline re-verification. Public reads require a
verified state and compare the re-verified package with all materialized repository, workflow,
identity, claim and artifact fields. Their status is the narrow `execution-attested`, never
“reproduced” or “true”.
