# DOI and versioning

## Distinct identifiers

Open Review Atlas preserves the distinction between four kinds of identifier:

| Identifier        | Identifies                     | Field                              |
| ----------------- | ------------------------------ | ---------------------------------- |
| GitHub repository | the evolving project           | `Repository.canonicalUrl`          |
| Commit SHA        | an exact repository state      | `RepositorySnapshot.commitSha`     |
| Git tree SHA      | the exact tree read by Atlas   | `RepositorySnapshot.sourceTreeSha` |
| Release / tag     | the ref selected for a version | `ReviewVersion.releaseTag`         |
| Version DOI       | one deposited release          | `ReviewVersion.versionDoi`         |
| Concept DOI       | the collection of all versions | `ReviewVersion.conceptDoi`         |
| Zenodo record     | a Zenodo deposit               | `ReviewVersion.zenodoRecordId`     |

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

## Publication consistency

The submission records a deterministic, public cross-check of:

- the explicitly selected source kind, tag/release, commit SHA, and commit tree SHA;
- repository metadata's commit and release declarations;
- version-DOI versus concept-DOI classification;
- the Zenodo record id and deposit version tag;
- commit- or tag-specific GitHub links in deposit metadata; and
- a DOI declared in the selected GitHub release body, when present.

Version and concept DOIs are validated independently for resolution, status, and role. Example,
unresolved, invalid, and unvalidated identifiers never pass. When a version deposit exposes a
concept DOI, it must match the declared concept DOI. Deposit GitHub URLs are normalized to
case-insensitive `owner/repository` identity (including `.git` forms) before commit or tag links
are compared, so a matching SHA from another repository cannot pass.

Failures remain in the immutable report. Editorial acceptance requires a check-scoped, attributed
override rationale for every failed check; warnings need no override. The accepted version exposes
the report, overrides, and exact inspection-capture hash.

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

GitHub default-branch content may differ from a deposited release. A repository-only submission is
valid only when deliberately selected and no version DOI/release is claimed. Atlas resolves the
selected commit's `commit.tree.sha`, traverses that tree, and reads all files at the selected commit.
Always cite the recorded commit, not merely "the repository".
