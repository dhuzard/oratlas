# Review manifest

Compatible review repositories may include a `review-manifest.json` at the repository root. It is
the **highest-priority** deterministic extraction source, but it is always **optional** — the
platform still extracts metadata from `CITATION.cff`, `.zenodo.json`, `codemeta.json`, MyST
configuration, repository metadata, and the README when the manifest is absent.

- Zod schema: `packages/contracts/src/manifest.ts` (`reviewManifestSchema`)
- JSON Schema: [`packages/contracts/schemas/review-manifest.schema.json`](../packages/contracts/schemas/review-manifest.schema.json)
- Schema version: `1.0.0`

## Example

```json
{
  "schemaVersion": "1.0.0",
  "review": {
    "title": "Example review",
    "abstract": "Example abstract",
    "reviewType": "computational-literature-review",
    "language": "en",
    "keywords": ["example"],
    "license": "CC-BY-4.0"
  },
  "repository": {
    "url": "https://github.com/owner/repository",
    "commit": "full-commit-sha",
    "releaseTag": "v1.0.0"
  },
  "publication": {
    "reviewUrl": "https://owner.github.io/repository/",
    "versionDoi": "10.5281/zenodo.example",
    "conceptDoi": "10.5281/zenodo.example-concept",
    "zenodoRecordId": "1234567"
  },
  "contributors": [],
  "artifacts": {
    "claims": "knowledge/claims.jsonl",
    "citations": "knowledge/citations.jsonl",
    "relations": "knowledge/claim-evidence-relations.jsonl",
    "trustAssessments": "knowledge/trust-assessments.jsonl",
    "provenance": "provenance.json"
  }
}
```

## Rules

- **Version DOI and concept DOI are distinct fields** and must not be collapsed.
- DOIs in the manifest must be **bare** (`10.xxxx/suffix`) — no `doi:` / `https://doi.org/`
  prefixes (normalization happens in `@oratlas/zenodo`).
- **Artifact paths must be safe repository-relative paths**: no absolute paths, no `..`, no URL
  schemes, no backslashes. Both the Zod schema and the JSON Schema enforce this; the extractor
  re-validates every path before reading a file (defence in depth).

## Knowledge artifacts

The `artifacts` block points at JSONL files inside the repository:

- **claims** — `{ id, text, section?, anchor?, claimType?, qualification? }`
- **citations** — `{ id, doi?, pmid?, openAlexId?, title?, authors?, year?, source?, url? }`
- **relations** — `{ claimId, citationId, relationType, supportDirection?, … }`
- **trustAssessments** — `{ claimId, citationId, protocolVersion, assessorType, criteria, … }`

First-class node-relation TRUST belongs in the optional `trustAssessments` JSONL source of
`node-manifest.json`; see `docs/trust-model.md`. Mixed repositories can declare both streams and
the extractor retains both subject forms.

Each JSONL file is parsed with strict per-line validation and a record cap; invalid lines are
reported but never abort the file. Relations/TRUST that reference unknown claims or citations are
dropped (referential integrity).
