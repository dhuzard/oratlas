# Submission workflow

## UI flow

1. **Repository** — the submitter enters a public GitHub repository URL. `@oratlas/github`
   normalizes and validates it (SSRF-safe).
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
5. **Submit** — an immutable submission snapshot is created.

## Statuses

`draft` → `submitted` → (`automated-checks-failed` |
`pending-editorial-review`) → (`changes-requested` | `accepted` | `rejected`) — plus `withdrawn`
and `superseded`.

- Hard errors at finalize → `automated-checks-failed`; otherwise `pending-editorial-review`.
- Accepting a submission creates or updates a public `Review` and a new immutable `ReviewVersion`.
- Previous versions are never destroyed.

## Immutability

`Submission.submittedPayloadJson` stores exactly what the submitter finalized (effective metadata

- compatibility level + knowledge artifacts). Editorial acceptance materializes the review from
  this payload, so what is published is precisely what was reviewed.

## Ownership

The submitter does not need to own the repository. The submitter is recorded separately from the
repository's authors and maintainers. Editorial acceptance is a distinct operation performed by a
user with the `EDITOR` (or `ADMIN`) role, and every decision is written to the audit log.

## API surface

See [`docs/openapi.yaml`](openapi.yaml) for the external data contracts of `/api/inspect`,
`/api/validate-doi`, `/api/submissions`, `/api/editorial/decision`, `/api/search`,
`/api/reviews/{slug}`, `/api/claims`, `/api/discuss`, and `/api/health`.
