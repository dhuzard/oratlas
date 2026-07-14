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
| `Review`                                 | Public review record               | `slug` unique; `currentSnapshotId`; lifecycle CAS revision                        |
| `ReviewVersion`                          | Immutable version                  | exact snapshot; DOI roles; materialized public lifecycle state                    |
| `ReviewLifecycleEvent`                   | Append-only scholarly lifecycle    | `(reviewId, revision)` unique; same-review correction/withdrawal/tombstone        |
| `Person` / `ReviewContributor`           | Authors & roles per version        | contributors ordered by `position`                                                |
| `Submission`                             | Editorial workflow record          | immutable `submittedPayloadJson`; `status`                                        |
| `InspectionCapture`                      | Exact inspect-to-submit payload    | token hash unique; user-bound, expiring, single-use; payload/hash append-only     |
| `EditorialOverride`                      | Scoped consistency exception       | `(submissionId, checkId)` unique; editor and rationale retained                   |
| `Identifier`                             | DOIs/ORCID/URL/Zenodo per version  | `relationType` distinguishes version vs concept DOI                               |
| `Claim`                                  | A review claim                     | `(reviewVersionId, localClaimId)` unique                                          |
| `Citation`                               | A cited source                     | `(reviewVersionId, localCitationId)` unique                                       |
| `ClaimEvidenceRelation`                  | Claim↔citation relation            | `(claimId, citationId, relationType)` unique                                      |
| `TrustAssessment`                        | Imported TRUST for one relation    | public import state is `unverified-import`; source assertions retained separately |
| `TrustVerification`                      | Atlas editorial review marker      | one-to-one with assessment; reviewer FK, role snapshot, rationale, subject hash   |
| `AgentRun`                               | Provenance of an agent action      | model/provider/prompt/input-hash/output                                           |
| `DiscussionThread` / `DiscussionMessage` | Atlas Discuss history              | grounding + model metadata                                                        |
| `ReviewComment`                          | Human peer commentary on a version | `reviewVersionId`, optional `claimId`, one-level `parentId`; soft `status`        |
| `KnowledgeLinkProposal`                  | Cross-review link proposal         | `(source, target, relation)` unique; `status`                                     |
| `AuditEvent`                             | Append-only audit trail            | operation key + `(subjectType, subjectId)` indexed                                |
| `IdempotencyKey`                         | Retry-safe operation claim         | primary-key uniqueness; same decision transaction                                 |

## Immutability and versioning

- A `RepositorySnapshot` is uniquely a `(repository, commitSha)` pair — the exact reviewed state.
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
