# Agent governance

Open Review Atlas uses automated agents in bounded, transparent, human-supervisable ways. This
document states where agents are and are **not** used.

## Where agents are NOT used

- **Structural compatibility** is decided by transparent deterministic rules over repository
  files (`packages/extractor/src/compatibility.ts`), never by an opaque language-model verdict.
  Every signal carries plain-language evidence and the level carries a rationale.
- **Metadata extraction** is deterministic and priority-ordered with field-level provenance. LLM
  extraction is optional, disabled when no provider key is configured, and never overwrites a
  deterministic value without preserving both.
- **DOI validation** is deterministic (normalization + resolution + metadata comparison).

## Where agents ARE used (and how they are governed)

### Atlas Discuss

- Runs in **deterministic mode** when no LLM key is configured: it retrieves relevant claims,
  groups them by evidence relation, and returns a structured summary. It does **not** fabricate
  prose pretending to be an AI answer.
- In **LLM mode**, a provider-neutral adapter receives **only the evidence packet** (never
  unrestricted database access). The answer must validate against a Zod schema, and any answer
  that references a review/claim/citation identifier absent from the packet is **rejected and
  retried once**.
- Each run persists an `AgentRun`: provider, model, model version, prompt version, evidence-packet
  hash, output, and grounding-validation result. Chain-of-thought is never requested or exposed.
- Answers must distinguish agreement, disagreement, and missing evidence, note whether supporting
  TRUST is a repository assertion or has a current Atlas structural-review marker, and must **not imply consensus from the number of
  reviews** (several reviews citing the same source are not independent replication).

### TRUST assessments

Repository TRUST records are always imported as `unverified-import`; source status and assessor
claims remain provenance only. Atlas `human-reviewed`/`adjudicated` is carried by a separate,
hash-bound editor marker. Even a current marker confirms structural/provenance review only and is
not an assertion of scientific correctness.

### Cross-review link proposals

`packages/knowledge` proposes conservative links (shared citations, normalized text similarity)
as **proposals** (`status = proposed`), never facts. The public UI labels unreviewed proposals as
such. States: `proposed` → `accepted` / `rejected` / `superseded`.

## Provenance and audit

Every agent action records its provenance (`AgentRun`, `KnowledgeLinkProposal.agentProvenance`,
`FieldProvenance`). Editorially meaningful changes are written to the append-only `AuditEvent`
log. Prompt versions and protocol versions are recorded so results are reproducible and
attributable.
