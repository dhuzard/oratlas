# Source assessment documents

ORAtlas recognizes only the exact, case-sensitive root paths `TRUST.md` and `FAIR.md` during a
bounded repository inspection. They are source-native methodology documents: the inspector
captures their UTF-8 text within the ordinary per-file, total-byte, and file-count limits, and an
accepted version copies that text into its immutable preserved-file package.

The extraction report records, for each exact path, its kind, preservation status, captured size,
SHA-256 (when preserved), source commit, and extractor version. It deliberately records no
Markdown sections, criteria, ratings, scores, validation result, or crosswalk. Public review pages
link to preserved documents as plain-text attachments with `nosniff`; repository Markdown is never
rendered as HTML.

## Protocol boundary

An Ethical Debt source review's `TRUST.md` follows Computational Review TRUST v2 from
`Neuronautix/ComputationalReviewTemplate_trust-knowledge`. It is not validated against the
standalone `Neuronautix/TRUST.md` v0.4 interchange convention, and neither source protocol is
translated into ORAtlas TRUST. The immutable repository pins and their distinct ownership are
recorded in [`CROSS_REPO_DEPENDENCIES.md`](../CROSS_REPO_DEPENDENCIES.md).

## Findings for structured ingestion

Structured ingestion would require an upstream, versioned machine-readable declaration separate
from the prose, with at least:

- an explicit protocol identifier and version;
- an explicit assessment unit and stable subject identifier;
- a schema for criterion identifiers, values, missing/not-applicable states, and provenance;
- an immutable artifact version or checksum and documented supersession rules.

Until such a declaration is separately specified, pinned, and governed, ORAtlas preserves the two
Markdown files only. Their presence never establishes scientific validity or Atlas verification.
