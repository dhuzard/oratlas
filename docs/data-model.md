# Data model

The Prisma schema (`packages/db/prisma/schema.prisma`) uses SQLite for local development and is
written to be PostgreSQL-compatible: enum-like fields are `String` columns validated at the
application layer by `@oratlas/contracts`, JSON payloads are `String` columns with a `…Json`
suffix, and arrays are JSON-encoded strings. Switching to PostgreSQL is a datasource change plus
`prisma migrate deploy`.

## Entities

| Model                                    | Purpose                           | Key constraints                                                      |
| ---------------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `User`                                   | Minimal GitHub identity + role    | `githubLogin` unique; `role` ∈ USER/EDITOR/ADMIN                     |
| `Repository`                             | Evolving GitHub project           | `(host, owner, name)` and `canonicalUrl` unique                      |
| `RepositorySnapshot`                     | Exact repository state            | **`(repositoryId, commitSha)` unique**                               |
| `Review`                                 | Public review record              | `slug` unique; `currentSnapshotId`                                   |
| `ReviewVersion`                          | Immutable version                 | separate `versionDoi` / `conceptDoi` / `zenodoRecordId`; `isExample` |
| `Person` / `ReviewContributor`           | Authors & roles per version       | contributors ordered by `position`                                   |
| `Submission`                             | Editorial workflow record         | immutable `submittedPayloadJson`; `status`                           |
| `Identifier`                             | DOIs/ORCID/URL/Zenodo per version | `relationType` distinguishes version vs concept DOI                  |
| `Claim`                                  | A review claim                    | `(reviewVersionId, localClaimId)` unique                             |
| `Citation`                               | A cited source                    | `(reviewVersionId, localCitationId)` unique                          |
| `ClaimEvidenceRelation`                  | Claim↔citation relation           | `(claimId, citationId, relationType)` unique                         |
| `TrustAssessment`                        | TRUST for one relation            | attached to the **relation**, per-criterion JSON columns             |
| `AgentRun`                               | Provenance of an agent action     | model/provider/prompt/input-hash/output                              |
| `DiscussionThread` / `DiscussionMessage` | Atlas Discuss history             | grounding + model metadata                                           |
| `ReviewComment`                          | Human peer commentary on a review | typed (`kind`), optional `claimId` anchor, one-level `parentId` thread; soft `status` |
| `KnowledgeLinkProposal`                  | Cross-review link proposal        | `(source, target, relation)` unique; `status`                        |
| `AuditEvent`                             | Append-only audit trail           | indexed by `(subjectType, subjectId)`                                |

## Immutability and versioning

- A `RepositorySnapshot` is uniquely a `(repository, commitSha)` pair — the exact reviewed state.
- Accepting a submission creates a **new** `ReviewVersion` bound to that snapshot. Earlier
  versions are never destroyed; `Review.currentSnapshotId` points at the latest.
- `Submission.submittedPayloadJson` is the immutable snapshot of exactly what the submitter
  finalized; editorial acceptance materializes the review from it.

## The five information kinds

The UI (and this schema) keep these distinct (spec §12, §18):

1. **Repository facts** — from the GitHub API (repo, commit, release).
2. **Extracted metadata** — deterministic extraction, with `FieldProvenance` (source/file/pointer/
   commit/confidence).
3. **Human-curated metadata** — manual edits stored separately, with editor identity + timestamp.
4. **Agent proposals** — TRUST records and link proposals with `reviewStatus = agent-proposed`.
5. **Human-reviewed records** — `reviewStatus = human-reviewed`/`adjudicated`.

## TRUST columns

`TrustAssessment` stores each criterion as its own JSON column
(`{rating, status, rationale, evidencePointer}`), so criteria remain individually queryable while
staying provider-portable. The criterion-level record is authoritative; `aggregateScore` +
`aggregateMethod` are optional and advisory.
