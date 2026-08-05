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

## Agent-facing guided exploration

Agents receive a bounded, derived ranking through `GET /api/landscape`. The versioned
`explicit-interest-recommendation@2.0.0` contract accepts only explicit query, interest, and filter
state; it does not infer a profile, accept GUI focus state, use behavioral telemetry, or mutate
preserved records. It returns canonical graph references, relative scores, and explanations only;
agents resolve record content through the reader-agnostic graph API.

An optional repeated `known` parameter is explicit reader-held state. Each recommendation returns
the exact editor-confirmed edges connecting it to those known identities in `anchors`; no lexical,
behavioral, or inferred familiarity is accepted.

The internal selection considers at most six claims, ten citation-evidence records, and twelve graph
identities reached from at most three seed claims. Only explicit graph identities and confirmed
public graph edges enter this overlay. Its ordering and plain-language reasons support navigation
only and are explicitly not truth, quality, consensus, or TRUST scores.
Unknown interests fail validation rather than becoming hidden personalization categories. See the
[agent-facing API guide](knowledge-landscape-api.md) and complete contract in
[`openapi.yaml`](openapi.yaml).

Atlas Discuss is a bounded lens beside graph traversal, not the canonical Explore front door. When
an explicit Explore topic, interest, filter, or graph focus is present, its evidence packet is
selected through the internal landscape service and
restricted to the exact accepted claim identities in the visible projection. Changing the question
may rank within that set but cannot silently broaden it. Generated statement highlighting uses only
returned claim/citation identifiers that already passed exact edge validation.

## Where agents ARE used (and how they are governed)

### Grounded Q&A (Atlas Discuss)

- Runs in **deterministic mode** when no LLM key is supplied for the request or configured on the
  server: it retrieves relevant claims,
  groups them by evidence relation, and returns a structured summary. It does **not** fabricate
  prose pretending to be an AI answer.
- In **LLM mode**, a provider-neutral adapter receives **only the evidence packet** (never
  unrestricted database access). Packet schema 1.1 requires explicit claim→citation evidence
  edges for every statement. Unknown identifiers, nonexistent edges, or a mismatch between those
  edges and the answer's evidence summary are **rejected and retried once**.
- Request-scoped BYOK supports Anthropic and OpenAI. The key is accepted only on a same-origin JSON
  request, is never persisted or logged, and is discarded after the provider call. Provider account
  terms and charges belong to the user; the selected provider receives the bounded evidence packet.
- Each run persists an `AgentRun`: provider, model, model version, prompt version, evidence-packet
  hash, exact canonical packet JSON, output, and grounding-validation result. The identical packet
  bytes are hashed, sent to the provider, and persisted. Chain-of-thought is never requested or
  exposed.
- Answers must distinguish agreement, disagreement, and missing evidence, note whether supporting
  TRUST is a repository assertion or has a current Atlas structural-review marker, and must **not imply consensus from the number of
  reviews** (several reviews citing the same source are not independent replication).
- Edge validation establishes structural provenance, not scientific correctness.

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
  prose is present only in the user-data bytes and can never modify the static system instructions.
- Model output is accepted only as one strict six-section JSON document. Every citation repeats its
  exact node/version ownership, and prose identifiers require both their packet identifier reference
  and owning node reference. Unknown, example, `10.5555`, malformed, or mismatched citations are
  rejected without persisting or returning the raw response.
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

### AI-assisted graph curation

Only authenticated editors can request AI graph curation from an explicit bounded Explore scope.
The provider receives at most twelve existing public node versions and their confirmed edges. Its
strict JSON output may reference only packet node-version and landscape identifiers, an allowed
relation type, a rationale, and exact basis nodes. Unknown identifiers, self-edges, duplicates,
already-confirmed edges, prose fences, and schema extensions are rejected.

Each accepted candidate is persisted through the existing `NodeEdgeProposal` lifecycle as
`proposed-by-agent`, linked to a succeeded `AgentRun` and its canonical packet hash. It remains
private until a human editor confirms or rejects it in the existing queue. Generation cannot create
a public edge, TRUST assessment, consensus label, confidence score, or scientific-truth decision.
The request-scoped provider key is cleared by the client and never written to the run or proposal.

### Claim and evidence extraction proposals during ingestion

AI extraction is an optional proposal layer after deterministic inspection; it never replaces the
manifest, JSONL, metadata, compatibility, DOI, or provenance extractors. The versioned packet is
pinned to the explicitly selected repository commit and tree, includes at most twelve eligible text
files within fixed byte budgets, and hashes every exact file. Proposed claims and citations must
name a packet file and an exact UTF-8 byte span whose SHA-256 is independently verified. Citation
text must equal that source span, and relations may reference only proposal identifiers in the same
validated output.

Validated output is still `human-review-required`: it is not an accepted claim, evidence relation,
public graph edge, TRUST assessment, consensus label, or scientific finding. Unknown files,
out-of-bounds or multibyte-splitting spans, changed hashes, duplicate identifiers, dangling
relations, and schema extensions fail closed. This slice defines the provider-neutral packet and
validation boundary; provider execution, durable proposal storage, and the ingestion review UI must
preserve those constraints when added.

## Provenance and audit

Every agent action records its provenance (`AgentRun`, `KnowledgeLinkProposal.agentProvenance`,
`FieldProvenance`). Editorially meaningful changes are written to the append-only `AuditEvent`
log. Prompt versions and protocol versions are recorded so results are reproducible and
attributable.
