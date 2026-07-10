# Editorial governance

## Roles

- **USER** — can browse and submit.
- **EDITOR** — can additionally inspect submissions, request changes, accept, reject, add notes,
  and see the audit log.
- **ADMIN** — editor privileges (reserved for future administrative actions).

Roles are checked **server-side** on every editorial route (`requireEditor`). The editorial UI is
also hidden from non-editors, but the server checks are authoritative.

## What acceptance means (and does not)

- Acceptance is an **editorial curation decision**, not peer review. The platform states this
  prominently on the home page, footer, archive, and editorial dashboard.
- Accepting a submission publishes an **immutable versioned review** materialized from the exact
  submitted snapshot.
- Rejecting or requesting changes records the decision and an optional note; the submission's
  immutable snapshot is preserved.

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
