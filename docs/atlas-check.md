# Atlas Check

Atlas Check is deterministic evidence CI for computational-review repositories. It evaluates
`TRUST.md`, `FAIR.md`, `review-manifest.json`, and the manifest-declared claims, citations,
relations, TRUST assessments, and provenance artifact. It does not call an LLM or external
service, execute repository code, follow symbolic links, or infer scientific truth.

An Atlas Check pass means the machine-readable evidence graph is structurally coherent. It is
not peer review, replication, or an Atlas verification marker. In particular, a repository's
`human-reviewed` or `adjudicated` assertion remains unverified input until an Atlas editor creates
a separate, current verification marker.

## Repository convention

Use the existing [review manifest contract](review-manifest.md) to declare JSONL artifacts. Add:

- `TRUST.md`, with one substantive section for each of the ten relation-specific TRUST criteria.
- `FAIR.md`, with substantive `Findable`, `Accessible`, `Interoperable`, and `Reusable` sections.

The Markdown checks are intentionally structural. A section must explain concrete evidence,
limitations, or remediation in at least a short sentence. Headings, badges, links, HTML, and
headings hidden in fenced examples do not satisfy a section. The authoritative TRUST data remains
the relation-specific JSONL record described by the [TRUST model](trust-model.md).

## CLI

From this monorepo:

```sh
pnpm atlas-check --root path/to/review --format text
pnpm atlas-check --root path/to/review --format json --output atlas-check-report.json
pnpm atlas-check --root path/to/review --format github --json-output atlas-check-report.json
```

`--fail-on error` is the default. `--fail-on warning` makes advisory gaps blocking, while
`--fail-on never` always exits successfully. Usage/configuration failures exit with status 2.
When `GITHUB_ACTIONS=true`, the default format is `github`; otherwise it is `text`.

JSON follows
[`packages/contracts/schemas/atlas-check-report.schema.json`](../packages/contracts/schemas/atlas-check-report.schema.json).
It deliberately contains no timestamp or absolute checkout path, so identical inputs produce
byte-identical output.

## GitHub Action

Check out the review repository first, then invoke Atlas Check pinned to an immutable commit:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
    with:
      persist-credentials: false
  - uses: dhuzard/oratlas@<full-commit-sha>
    with:
      fail-on: error
      report-path: atlas-check-report.json
```

The action emits escaped GitHub annotations with rule, severity, file, and line where available,
and writes the canonical JSON report. Uploading or publishing that report is an explicit caller
choice. The action and its setup dependencies should remain pinned by full commit SHA in release
workflows.

## Safety limits

- Markdown/manifest: 1 MiB per file.
- Evidence/provenance artifacts: 5 MiB per file.
- Total read budget: 20 MiB.
- JSONL: 10,000 lines and 5,000 valid records per artifact.
- Findings: 1,000 per run; reaching the cap is itself an error.

Only regular files inside the selected root are read. Manifest paths use the existing safe
repository-relative-path contract. Symbolic links, path traversal, absolute paths, oversized
files, and unreadable inputs fail closed. Repository-derived text is escaped before GitHub
workflow commands are emitted.

## Rule catalog

Rule IDs and their meanings are stable within report schema `1.0.0`:

| Rule                     | Meaning                                             |
| ------------------------ | --------------------------------------------------- |
| `ORATLAS-DOC-001`        | `TRUST.md` is missing                               |
| `ORATLAS-DOC-002`        | `FAIR.md` is missing                                |
| `ORATLAS-DOC-003`        | Required TRUST/FAIR section is missing              |
| `ORATLAS-DOC-004`        | Required section lacks substantive documentation    |
| `ORATLAS-MANIFEST-001`   | Review manifest is missing                          |
| `ORATLAS-MANIFEST-002`   | Manifest is invalid JSON                            |
| `ORATLAS-MANIFEST-003`   | Manifest violates its schema                        |
| `ORATLAS-MANIFEST-004`   | Source commit is not pinned                         |
| `ORATLAS-ARTIFACT-001`   | Artifact is undeclared or missing                   |
| `ORATLAS-ARTIFACT-002`   | JSONL line is invalid JSON                          |
| `ORATLAS-ARTIFACT-003`   | JSONL record violates its contract                  |
| `ORATLAS-ARTIFACT-004`   | Claim/citation ID is duplicated                     |
| `ORATLAS-CLAIM-001`      | Claim has no source anchor                          |
| `ORATLAS-CLAIM-002`      | Claim has no evidence relation                      |
| `ORATLAS-CITATION-001`   | Citation lacks a persistent identifier              |
| `ORATLAS-RELATION-001`   | Relation references an unknown record               |
| `ORATLAS-TRUST-001`      | TRUST references an unknown record                  |
| `ORATLAS-TRUST-002`      | TRUST has no corresponding relation                 |
| `ORATLAS-TRUST-003`      | TRUST criterion is omitted                          |
| `ORATLAS-TRUST-004`      | TRUST rating and missingness status disagree        |
| `ORATLAS-TRUST-005`      | Imported review assertion is not Atlas verification |
| `ORATLAS-PROVENANCE-001` | Provenance artifact is undeclared                   |
| `ORATLAS-SECURITY-001`   | Input violates a file trust boundary                |
| `ORATLAS-LIMIT-001`      | JSONL record cap was reached                        |
| `ORATLAS-LIMIT-002`      | JSONL line cap was reached                          |
| `ORATLAS-LIMIT-003`      | Finding cap was reached                             |

Findings include a suggested fix. Consumers should key policy on `ruleId` and `severity`, not on
message text.
