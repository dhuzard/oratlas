# DOI and versioning

## Distinct identifiers

Open Review Atlas preserves the distinction between four kinds of identifier:

| Identifier        | Identifies                     | Field                           |
| ----------------- | ------------------------------ | ------------------------------- |
| GitHub repository | the evolving project           | `Repository.canonicalUrl`       |
| Commit SHA        | an exact repository state      | `RepositorySnapshot.commitSha`  |
| Release / tag     | a named version                | `RepositorySnapshot.releaseTag` |
| Version DOI       | one deposited release          | `ReviewVersion.versionDoi`      |
| Concept DOI       | the collection of all versions | `ReviewVersion.conceptDoi`      |
| Zenodo record     | a Zenodo deposit               | `ReviewVersion.zenodoRecordId`  |

**Version DOI and concept DOI are never collapsed into one field.**

## Normalization

`@oratlas/zenodo` `normalizeDoi` accepts `doi:10…`, `DOI: 10…`, `https://doi.org/10…`,
`http://dx.doi.org/10…`, and raw `10…`, trims trailing punctuation, and lower-cases (DOIs are
case-insensitive). Output is the bare `10.xxxx/suffix` form.

## Validation

`validateDoi` returns a **structured report** (never a bare boolean):

- per-check outcomes: `syntax`, `resolution`, `zenodo-metadata`, `repository-match`,
  `title-match`, `release-match`;
- **hard errors** (invalid syntax, does not resolve) vs **warnings** (slight metadata
  differences) vs a **confidence** level (`high`/`medium`/`low`/`none`);
- for Zenodo DOIs: compares the record's related identifiers, title, creators, publication date,
  and version tag against the submission, and **discovers the concept DOI** from a version
  record.

A review is **not rejected merely because metadata differ slightly** — mismatches are recorded as
warnings.

## No DOI

When no DOI is found, the review is accepted as **repository-only** (if other requirements pass),
with a non-blocking recommendation to connect the repository to Zenodo and publish a GitHub
release (the [official Zenodo–GitHub workflow](https://docs.github.com/repositories/archiving-a-github-repository/referencing-and-citing-content)).
The platform:

- never mints, reserves, or pretends to create a DOI,
- never requires a Zenodo access token,
- never automates release creation in someone else's repository.

## Example identifiers

Seed/demo DOIs use the reserved documentation prefix `10.5555/` and are flagged `isExample` /
`example-not-resolvable`. The UI renders them as plain text (never outbound links) and validation
short-circuits without any network call.

## The default-branch caveat

GitHub default-branch content may differ from a deposited release. The exact reviewed state is the
recorded **commit SHA** — always cite that, not "the repository".
