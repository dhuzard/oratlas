# Editorial governance

## Roles

- **USER** — can browse and submit.
- **EDITOR** — can additionally inspect submissions, request changes, accept, reject, add notes,
  and see the audit log.
- **ADMIN** — editor privileges (reserved for future administrative actions).

Roles are checked **server-side** on every editorial route (`requireEditor`). The editorial UI is
also hidden from non-editors, but the server checks are authoritative.

## Formal challenge authority (interim)

Formal challenges are a separate register from TRUST assessments and open comments. Any signed-in
user may file a typed, plain-text objection against the server-published hash of an exact immutable
claim, relation, or assessment criterion. A contributor of record may append the
`author-responded` transition, and the challenger may withdraw. Pending the governance decision in
`ORATLAS_DECISIONS.md` §5, `hasChallengeResolutionAuthority` grants `resolved`/`dismissed` only to
current editors/admins; this check is deliberately isolated so the authority policy can be swapped
without rewriting lifecycle storage.

Resolution requires a rationale and means only that the objection received an attributable
editorial outcome. It MUST NOT be presented as a scientific-truth verdict and never changes the
target record, TRUST criteria, compatibility, or review lifecycle. Filing and transitions use
authenticated exact-same-origin JSON, bounded contracts, rate limits, optimistic revisions, an
append-only `ChallengeTransition`, and an `AuditEvent`.

## What acceptance means (and does not)

- Acceptance is an **editorial curation decision**, not peer review. The platform states this
  prominently on the home page, footer, archive, and editorial dashboard.
- Accepting a submission publishes an **immutable versioned review** materialized from the exact
  submitted snapshot.
- Rejecting or requesting changes records the decision and an optional note; the submission's
  immutable snapshot is preserved.

### AI-generated synthesis acceptance

AI synthesis decisions follow the normative
[AI synthesis governance and attribution policy](synthesis-governance.md) and the
[synthesis editorial lifecycle](synthesis-editorial.md). The synthesis software is a non-person
authoring agent; the approving editor is publicly accountable for the publication decision and
six-part checklist, not represented as the writer of generated prose. Acceptance MUST NOT imply
peer review, scientific correctness, consensus, truth adjudication, or blanket TRUST.

Accept, reject, and request-regeneration require a private rationale. Only accept materializes an
immutable public successor. Editors must verify exact grounding, contradiction/non-consensus
framing, AI/editor attribution, limitations, privacy/injection leakage, and rights/license. A
missing check, stale revision, corrupt lineage, unsupported policy version, or invalid/reserved DOI
fails closed. The agent cannot accept its own output and no automated job may advance the public
head.

## Editorial dashboard

Editors can:

- inspect pending submissions and their validation reports,
- view the **immutable submitted snapshot** and an extracted-vs-edited **metadata diff**,
- accept, reject, or request changes with an editorial note,
- review the audit log of editorially meaningful changes.

## Audit trail

Every decision writes an `AuditEvent` (`submission.finalized`, `submission.accepted`,
`review.published`, `submission.reject`, `submission.request-changes`, `auth.mock-login`,
`auth.mock-login-refused`, …) with the actor, subject, and details. The log is append-only and
surfaced in the editorial dashboard.

## Conflicts and independence

The platform records the submitter separately from the repository's authors and maintainers, so
editors can see when a submitter is also an author. TRUST's `conflictDependency` criterion is the
place to record conflict/dependency at the evidence level.

## Formal review lifecycle (issue #6)

Archive acceptance is not peer review. The formal lifecycle adds, on top of the
structural checks:

- **Editor assignment with conflicts of interest.** An editor can never be assigned to
  their own submission; a declared conflict records the assignment as an immediate
  recusal, and active editors can recuse themselves later with an attributable statement.
- **Numbered review rounds** (`ReviewRound`), opened only by actively assigned editors on
  pending submissions and closed exactly once by a decision letter.
- **Immutable review reports** (`FormalReviewReport`): one per reviewer per round,
  structured (contracts `formalReviewReportBodySchema`), canonical-JSON hashed, with a
  reviewer-ORCID snapshot whose verification state is explicit. Neither the submitter nor
  an assigned editor of the submission may review it.
- **Author responses and decision letters**, both append-only and hashed. A decision
  letter applies the archive decision idempotently: acceptance runs the atomic
  publication machinery; request-changes reopens the path to resubmission.
- **Resubmission lineage.** A changes-requested submission is superseded by its revision
  (`previousSubmissionId`); active editor assignments carry over and editors are
  notified. The public process history spans the whole lineage.
- **Open process history.** `GET /api/editorial/process?submissionId=…` and the
  per-version `export/docmap` (DocMaps-compatible) expose the full attributable history;
  version pages render it under "Editorial process history".
- **Notifications** are in-app rows scoped to the recipient; no email leaves the POC.

ORCID iDs attach via `POST /api/profile/orcid` and are always stored unverified; only a
future ORCID sign-in flow can verify them, and only verified iDs are exported as
identifiers.
