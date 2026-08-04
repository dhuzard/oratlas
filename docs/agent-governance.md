# Agent governance

Open Review Atlas uses automated agents in bounded, transparent, human-supervisable ways. This
document states where agents are and are **not** used.

## Where agents are NOT used

- **Structural compatibility** is decided by transparent deterministic rules over repository
  files (`packages/extractor/src/compatibility.ts`), never by an opaque language-model verdict.
  Every signal carries plain-language evidence and the level carries a rationale.
- **Deterministic metadata and knowledge extraction** remains the authoritative representation of
  source-authored repository records. Optional AI extraction is a separate proposal layer and can
  neither overwrite deterministic values nor silently enter a submission.
- **DOI validation** is deterministic (normalization + resolution + metadata comparison).
- **Guided Explore ranking and graph traversal** are deterministic. An LLM does not infer a hidden
  reader profile, decide graph publication state, assign TRUST, or determine scientific truth.

## Provider and credential boundary

Grounded generation can use either an operator-configured platform provider or a user-supplied
browser credential for Anthropic or OpenAI.

- The browser credential is encrypted into an eight-hour `HttpOnly`, `SameSite=Lax` cookie using
  authenticated AES-256-GCM encryption derived from the server `SESSION_SECRET`.
- The raw key is never returned by the credential-status API, written to the database, copied into
  an `AgentRun`, included in audit data, or placed in a URL or browser storage API.
- A browser credential takes precedence over a platform credential for that request and can be
  deleted explicitly. Expired, malformed, or tampered credentials fail closed.
- ORAtlas sends only the bounded packet declared by the relevant workflow. Provider billing,
  retention, and data-processing terms still apply and are disclosed before connection.
- When no provider is available, Atlas Discuss remains deterministic. Generation-only workflows
  return an explicit unavailable state rather than fabricating an AI result.

The provider-neutral interface is implemented in `packages/knowledge`; Anthropic and OpenAI are
transport adapters behind the same prompt, packet, token, byte, parsing, and grounding constraints.

## Agent-facing guided exploration

Agents may read the same bounded knowledge landscape shown to human readers through
`GET /api/landscape`. The endpoint and Explore page call the same deterministic service and return
the versioned `explicit-interest-graph-landscape@2.0.0` projection. It accepts only explicit query,
interest, filter, and optional focus state; it does not infer a profile, use behavioral telemetry,
or mutate preserved records.

The response contains at most six claims, ten citation-evidence records, and twelve graph
identities reached from at most three displayed seed claims. Only explicit claim-to-node identities
and confirmed public graph edges enter this projection. Its ordering and plain-language selection
reasons support navigation only and are explicitly not truth, quality, consensus, or TRUST scores.
Unknown interests fail validation rather than becoming hidden personalization categories. See the
[agent-facing API guide](knowledge-landscape-api.md) and complete contract in
[`openapi.yaml`](openapi.yaml).

## Where agents ARE used (and how they are governed)

### Grounded Q&A (Atlas Discuss)

Atlas Discuss is embedded directly in Explore and remains available as a specialist page.

- Runs in **deterministic mode** when no LLM credential is available: it retrieves relevant claims,
  groups them by evidence relation, and returns a structured summary. It does **not** fabricate
  prose pretending to be an AI answer.
- In **LLM mode**, the selected provider receives **only the canonical evidence packet** (never
  unrestricted database access). Packet schema 1.1 requires explicit claim-to-citation evidence
  edges for every statement. Unknown identifiers, nonexistent edges, or a mismatch between those
  edges and the answer's evidence summary are rejected and retried once.
- Each successful or failed provider run persists an `AgentRun`: provider, model, model version,
  prompt version, evidence-packet hash, exact canonical packet JSON, validated output, and
  grounding-validation result. The identical packet bytes are hashed, sent to the provider, and
  persisted. Chain-of-thought is never requested or exposed.
- Answers must distinguish agreement, disagreement, and missing evidence, note whether supporting
  TRUST is a repository assertion or has a current Atlas structural-review marker, and must **not
  imply consensus from the number of reviews**. Several reviews citing one source are not
  independent replication.
- Edge validation establishes structural provenance, not scientific correctness.

### AI-assisted graph curation

An authenticated editor may ask an agent to compare two exact, readable public node versions.

- The packet includes stable node IDs, exact node-version IDs, repository and commit identity,
  bounded node text, payload, and an optional editorial question.
- The model must either abstain or propose exactly one relation from the controlled node-relation
  vocabulary. It cannot invent a relation type or return a probability/confidence score.
- Every proposal must include verbatim quotes from **both** exact node versions. Quotes are checked
  as literal substrings of the transmitted packet. Invalid output is rejected and retried once.
- A validated result creates an ordinary `NodeEdgeProposal` with `proposed-by-agent` provenance and
  an attached `AgentRun`. It is not public or authoritative.
- Only the existing editor confirm/reject lifecycle can produce a confirmed public edge. The
  generation request cannot call that decision path, and abstention creates no proposal.

### Claim and evidence extraction during ingestion

After deterministic repository inspection, the owner of the unexpired inspection capability may
request a separate AI annotation pass.

- The pass is bound to the exact immutable capture, selected commit, capture hash, and inspecting
  user. Consumed, expired, missing, or foreign capabilities are refused.
- ORAtlas sends only a bounded allowlist of captured textual files: no cloning, code execution, web
  browsing, or implicit paper retrieval. Likely secret-bearing paths, environment files, lockfiles,
  and minified artifacts are excluded.
- Every candidate claim or evidence object must identify a transmitted source path and contain an
  exact verbatim quote. Relations may reference only temporary identifiers created in the same
  validated response. Duplicate declared claims and dangling identifiers are rejected.
- The result is stored as an `AgentRun` and displayed as a reviewable annotation. It is never merged
  into deterministic extraction, source-authored manifests, the immutable inspection capture, or a
  submission automatically.
- A model may abstain. No candidate is generated when explicit source material is insufficient.

### TRUST assessments

Repository TRUST records are always imported as `unverified-import`; source status and assessor
claims remain provenance only. Atlas `human-reviewed`/`adjudicated` is carried by a separate,
hash-bound editor marker. Even a current marker confirms structural/provenance review only and is
not an assertion of scientific correctness.

### Long-form synthesis writer

The normative policy is [AI synthesis governance and attribution](synthesis-governance.md). Its
software-agent authorship, editor-accountability, public/private disclosure, and incident rules are
mandatory for every accepted synthesis version.

- The writer receives only a canonical, hash-bound graph-native evidence packet. Untrusted node
  prose is present only in user-data bytes and can never modify the static system instructions.
- Model output is accepted only as one strict six-section JSON document. Every citation repeats its
  exact node/version ownership, and prose identifiers require both their packet identifier
  reference and owning node reference. Unknown, example, `10.5555`, malformed, or mismatched
  citations are rejected without persisting or returning the raw response.
- With no provider, a deterministic bounded template produces the same grounded bytes for the same
  packet. A configured provider failure is recorded as a sanitized failure and never silently
  switches to fallback.
- A required `AgentRun` recorder persists `running` before generation and `succeeded` or `failed`
  before return. It records provider/model versions, prompt and packet hashes, exact packet JSON,
  and only validated output JSON. Chain-of-thought and rejected provider text are never retained.
- The separate [grounding evaluation harness](grounding-evaluation.md) exercises the production
  prompt builder, parser, and validator against bounded adversarial fixtures. Its offline CI mode
  reads no provider key and its report never contains packets, prompts, hashes, model output, or
  `AgentRun` data.
- Generation and regeneration create private drafts only. The software agent is not a `Person` and
  cannot complete the editorial checklist or publish. Only an authenticated editor can accept a
  version; that curation decision is not peer review, scientific correctness, consensus, or TRUST.

### Cross-review link proposals

`packages/knowledge` proposes conservative links (shared canonical DOI/PMID/OpenAlex aliases,
normalized text similarity) as **proposals** (`status = proposed`), never facts. Conflicting work
identifier clusters are flagged and excluded from alias-based linking. The public UI labels
unreviewed proposals as such. States: `proposed` → `accepted` / `rejected` / `superseded`.

## Provenance and audit

Every agent action records its provenance (`AgentRun`, `NodeEdgeProposal.agentRunId`,
`KnowledgeLinkProposal.agentProvenance`, `FieldProvenance`). Editorially meaningful changes are
written to the append-only `AuditEvent` log. Prompt versions and protocol versions are recorded so
results are reproducible and attributable. API credentials are never part of provenance records.
