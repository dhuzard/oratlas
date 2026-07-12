# Submission workflow

## UI flow

1. **Repository and source** — the signed-in submitter enters a public GitHub repository URL and
   explicitly selects the default branch, an exact non-release tag, or an exact published release.
   `@oratlas/github` normalizes and validates the URL (SSRF-safe).
2. **Inspect** — the server fetches repository metadata and well-known files via the GitHub API
   with timeouts and size caps. The repository is never cloned or executed.
3. **Review extracted metadata** — editable fields (title, abstract, authors, ORCIDs, keywords,
   domains, review type, license, repository URL, published review URL, commit SHA, release tag,
   version DOI, concept DOI, Zenodo record, contact, template compatibility). Each value preserves
   its extracted value, extraction source, and — if edited — the manual value, editor identity,
   and timestamp.
4. **Validation** — a structured report: hard errors, warnings, DOI validation, release
   validation, metadata completeness, repository compatibility, evidence-data availability, and
   TRUST-data availability.
5. **Submit** — the browser returns a single-use, opaque inspection capability. The server loads
   the exact canonical capture; it does not inspect GitHub again.

## Statuses

`draft` → `submitted` → (`automated-checks-failed` |
`pending-editorial-review`) → (`changes-requested` | `accepted` | `rejected`) — plus `withdrawn`
and `superseded`.

- Hard errors or failed release/DOI/commit consistency checks at finalize →
  `automated-checks-failed`; otherwise `pending-editorial-review`.
- Accepting a submission creates or updates a public `Review` and a new immutable `ReviewVersion`.
- Previous versions are never destroyed.

## Immutability

Every inspection creates an append-only `InspectionCapture` with exact canonical payload bytes and
a SHA-256 hash. Its random capability expires after 30 minutes, is bound to the inspecting user,
and can create only one submission. Reinspection creates another capture; it does not mutate the
existing `(repository, commit)` snapshot.

`Submission.submittedPayloadJson` stores exactly what the submitter finalized (effective metadata,
validation, compatibility level, and knowledge artifacts) in canonical JSON with its own hash.
Editorial acceptance materializes the review only from this payload, so changed upstream branches
or moved tags cannot alter what is published.

## Atomic editorial decisions

Acceptance is a database-only, retry-bounded transaction. A compare-and-set status transition,
review/version materialization, check-scoped overrides, and idempotent audit events commit together
or all roll back. Repeated acceptance returns the already-created version; accept/reject races can
produce only one terminal decision. A failed consistency check can be accepted only when an editor
provides a separate 20–4000 character rationale for that exact check id. The original report remains
unchanged and the override is publicly attributed.

## Ownership

The submitter does not need to own the repository. The submitter is recorded separately from the
repository's authors and maintainers. Editorial acceptance is a distinct operation performed by a
user with the `EDITOR` (or `ADMIN`) role, and every decision is written to the audit log.

## API surface

See [`docs/openapi.yaml`](openapi.yaml) for the external data contracts of `/api/inspect`,
`/api/validate-doi`, `/api/submissions`, `/api/editorial/decision`, `/api/search`,
`/api/reviews/{slug}`, `/api/claims`, `/api/discuss`, and `/api/health`.
