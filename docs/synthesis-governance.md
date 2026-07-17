# AI synthesis governance and attribution policy

| Field                      | Normative value                             |
| -------------------------- | ------------------------------------------- |
| Status                     | Normative                                   |
| Policy identifier          | `synthesis-attribution/1.0.0`               |
| Checklist identifier       | `synthesis-checklist/1.0.0`                 |
| Materialization identifier | `synthesis-materialization/1.0.0`           |
| Applies to                 | `ai-synthesis` drafts and accepted versions |

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, and **MAY** in this document are
normative. This policy governs AI-generated synthesis reviews; it does not govern ordinary
repository-authored review contributor credit.

The operative contracts are
[`packages/contracts/src/synthesis-editorial.ts`](../packages/contracts/src/synthesis-editorial.ts),
the [synthesis editorial lifecycle](synthesis-editorial.md), and the strict
[`PublicSynthesisReview`](openapi.yaml) API schema. If explanatory prose conflicts with those
fail-closed contracts, publication MUST stop until the conflict is corrected and versioned.

## 1. Terms and non-negotiable boundary

- An **AI-generated synthesis** is a six-section grounded document produced by the disclosed Open
  Review Atlas synthesis software, using either an LLM or the deterministic template.
- The **software agent** is the non-person contributor with identifier
  `software:oratlas-synthesis-writer`. It MUST NOT be represented as a `Person`, human researcher,
  editor, or fabricated human author.
- The **approving editor** is the authenticated `EDITOR` or `ADMIN` whose display name, GitHub
  login, and role snapshot are fixed at acceptance. “Approving” means accountable for the
  editorial publication decision and checklist; it does not mean authorship of generated prose.
- An **accepted version** is one immutable materialization. A **series** is the lineage of accepted
  versions for one canonical seed or topic.
- **Editorial acceptance** is curation permission to publish. It MUST NOT be described as peer
  review, scientific correctness, consensus, truth adjudication, replication, or a blanket TRUST
  assessment.

No agent, provider, model, scheduled job, retry, or administrator script MAY autonomously publish a
synthesis. Generation and regeneration MUST create a private draft. Only an explicit authenticated
editorial `accept` transition that satisfies the complete checklist MAY advance the public head.
Reject and request-regeneration transitions MUST remain non-public.

## 2. Authorship, credit, and accountability

Every public accepted version MUST disclose two distinct contributors in this order:

1. the Open Review Atlas Synthesis Writer as `software-agent`, role `synthesis-generation`, with its
   stable software ID, display name, and pipeline version; and
2. the approving editor as `approving-editor`, role `editorial-approval`, with their display name,
   GitHub login, role snapshot, and acceptance time.

The software agent MUST receive software-agent credit and MUST NOT receive a human identity,
ORCID, institutional affiliation, or invented biography. The editor MUST NOT be presented as the
author of model-generated sentences merely because they accepted the version. The editor is
responsible for completing the checklist, deciding whether the version may be published under the
stated rights, initiating corrections or incident response when needed, and ensuring the public
label remains accurate.

Acceptance does not warrant that cited claims are correct, that evidence is complete, that TRUST
assertions are scientifically valid, or that independent consensus exists. Evidence authors retain
responsibility for their source works. This operational allocation of accountability does not
create a legal warranty or transfer third-party liability to the editor.

## 3. Required public wording

KG-15 and every other public reading surface MUST use the contract constants:

- label: **“AI-generated synthesis — editor-accepted”**;
- scope notice: **“Generated from cited evidence by software. Editorial acceptance permits
  publication; it does not establish peer review, scientific correctness, or consensus.”**

The surface MUST also name the software agent and approving editor, state that the editor accepted
the version for publication and is accountable for the editorial decision/checklist, and keep this
disclosure visible without requiring a citation popover. “AI-written,” “AI-authored,” “approved,”
or “reviewed” MAY appear only when the canonical label and scope notice remain present and the
additional wording cannot imply human authorship or scientific endorsement.

## 4. Public allowlist and private denylist

Public serialization is an allowlist, not a redaction pass. The top-level public DTO MUST contain
only `slug`, `reviewType`, `title`, `abstract`, `document`, `provenance`, `citations`, `version`, and
`freshness`. Unknown fields MUST be rejected.

Public `provenance` MUST contain only:

- generation mode; software ID/kind/name/version;
- provider, model, model version, prompt version;
- prompt, packet, and document SHA-256 hashes (never their private bytes);
- generation and acceptance timestamps;
- attribution and materialization policy versions;
- approving-editor display name, GitHub login, and role snapshot;
- rights statement, SPDX license expression, checklist version;
- accepted ordinal and exact predecessor version ID/ordinal.

Public citations MAY contain only the strict citation DTO: exact reference, node, node-version and
kind; title; occurrence location/ordinal; exact internal node-version link; and optional identifier
scheme/role/value. Public version data MAY contain only ID, ordinal, current-head status, and
optional distinct version/concept DOIs.

Public `freshness` MUST contain only `status`, `policyVersion`, optional `evaluatedAt`,
`reasonCodes`, and `affectedReferenceCount`, validated by the strict freshness contract. It is a
bounded staleness signal, not a correctness or consensus claim. Freshness observation IDs,
evaluation keys, stored packet material, proposals, editor decisions, run IDs, and draft IDs MUST
remain private. Invalid or unverifiable freshness state MUST degrade to `unchecked` rather than
leaking internal state or making a stale/fresh claim.

The approving editor's GitHub login is intentionally public accountability metadata. Email,
internal user ID, session data, and other personal data MUST NOT be added to the public DTO.

The following MUST remain private and MUST NOT appear in HTML, API, metadata, structured data,
exports, logs intended for readers, or error responses:

- draft ID/status/revision, parent draft, series key, selector, generation key, request key, lease
  state, and decision idempotency key;
- `AgentRun` ID, internal/private database IDs (except the allowlisted public review-version,
  node, and node-version IDs above), exact packet JSON/bytes, system or user prompt bytes, provider
  request/response bytes, raw or rejected output, and chain-of-thought;
- API keys, credentials, environment values, exception text/stacks, provider errors, retries, and
  internal diagnostics;
- editorial rationale, notes, conflicts, incident notes, rejected drafts/content, and
  regeneration-requested content.

Private records MAY be retained for bounded audit/reproducibility purposes under access control.
Their retention does not authorize public disclosure. A new public field requires a policy-version
review, contract/OpenAPI change, privacy review, tests, and migration analysis; it MUST NOT be added
ad hoc in a UI mapper.

## 5. Model, prompt, and exact evidence disclosure

Public readers MUST receive generation mode, provider, model, model version, pipeline version,
prompt version, prompt hash, packet hash, document hash, and generation time. These values identify
the recorded generation event; they are not performance claims and MUST NOT imply access to model
weights, hidden configuration, or provider reproducibility.

Prompt text, provider payloads, packet bytes, and raw output MUST remain private. Prompt hashes and
versions enable comparison without exposing instructions or injected repository content. The
system prompt MUST remain static instructions; repository/node prose, including prompt-injection
strings, MUST remain canonical user data.

Every accepted citation MUST resolve to the exact immutable node and node version in the accepted
packet, and every citation occurrence MUST retain its location/ordinal and reference ownership.
The public href MUST be `/nodes/{nodeId}/versions/{nodeVersionId}`. Packet and document hashes MUST
match the accepted materialization. Missing, fabricated, example, mismatched, or out-of-packet
references MUST stop publication. Grounding proves attribution to stored evidence, not scientific
truth.

## 6. Rights and licensing

Acceptance MUST include a bounded, parser-validated SPDX license expression composed only from the
contract's supported SPDX license/exception identifiers and `AND`, `OR`, `WITH`, or parentheses,
plus a rights statement. A free-form license label MUST NOT pass as an SPDX expression. The editor MUST
confirm, to the best of the information available to them, that Atlas may publish the synthesis
under that license and that the generated text does not reproduce protected source material beyond
permitted quotation/citation. If provider terms, source licenses, or jurisdictional rules leave
publication rights unclear, the editor MUST reject or request regeneration and escalate for legal
review; the checklist MUST NOT be guessed or delegated to the model.

The synthesis license applies to the accepted synthesis text as stated. It MUST NOT be represented
as relicensing cited nodes, repositories, datasets, code, figures, or third-party works. Their own
licenses and provenance continue to govern. Atlas does not claim ownership of model weights,
provider services, evidence sources, or a human identity for the software agent.

## 7. DOI policy

Atlas MUST NOT mint, reserve, or pretend to create a DOI.

- A **version DOI** identifies exactly one immutable accepted synthesis version.
- A **concept DOI** identifies the synthesis series across versions.
- When both exist they MUST be normalized and distinct. A concept DOI MUST NOT be used as the
  version DOI or cited as though it fixed one version.
- A version DOI MUST be globally unique across accepted synthesis versions and MUST NOT equal any
  synthesis concept DOI. A concept DOI MUST remain stable within one series, MUST NOT identify a
  different series, and MUST NOT equal any synthesis version DOI. Acceptance MUST enforce these
  role constraints in the serializable publication transaction.
- DOIs are optional. Their presence MUST NOT be treated as evidence quality, peer review, or
  scientific endorsement. Without a DOI, the stable Atlas version URL remains authoritative.
- `10.5555/*` and any identifier marked as an example are documentation fixtures. They MUST NOT be
  accepted as live synthesis identifiers, resolved outward, or rendered as clickable DOI links.
- A correction MUST receive its own version DOI if a DOI is assigned; it MAY retain the series
  concept DOI. An existing accepted version DOI MUST never be rewritten or reassigned.

## 8. Editorial checklist and transitions

An editor MUST inspect the immutable draft and affirm all six checklist fields as `true`:

1. grounding and every citation/reference/node-version link were reviewed;
2. contradictions, uncertainty, evidence dependence, and non-consensus framing were reviewed;
3. software-agent/editor attribution and AI disclosure were reviewed;
4. limitations and the difference between synthesis and truth adjudication were reviewed;
5. privacy, prompt-injection leakage, private fields, and identifier leakage were reviewed; and
6. rights, source-license boundaries, synthesis license, and publication authority were confirmed.

The checklist is an attributable attestation, not a UI convenience. It MUST be bound to the
decision body, expected revision, idempotency key, editor identity, rationale, checklist version,
rights statement, license, and optional DOI roles. A model or software agent MUST NOT complete it.

- **Accept** MUST revalidate the draft and AgentRun, mark the run human-approved, materialize one
  immutable successor, and atomically advance the public head.
- **Reject** MUST close the private draft without public materialization.
- **Request regeneration** MUST close the private draft and create no public change; a later
  generation is a new private draft with explicit lineage.

Rationales are required for accountability but remain private. Acceptance MUST fail on stale
revision, role loss, invalid checklist, rights/DOI error, broken provenance, duplicate decision, or
corrupt lineage. An exact idempotent retry MAY return the already-committed outcome; it MUST NOT
create another version.

## 9. Fail-closed integrity and privacy

Public reads MUST begin at the authoritative current synthesis head and revalidate the accepted
draft, successful AgentRun, hashes, packet/document/citations, exact node versions, source union,
predecessor lineage, contributor ordering, editor snapshot, rights, DOI roles, checklist, and every
supported policy version. Missing or inconsistent data MUST return the same not-found boundary as
an absent public synthesis. It MUST NOT return a partial record, fall back to an older version,
rematerialize from the current graph, expose an internal error, or repair data during a public read.

Private editorial endpoints MUST return bounded typed errors and MUST NOT echo provider payloads,
private content, credentials, or exception details. Integrity failure requires investigation from
the retained audit data, not a relaxed public parser.

## 10. Corrections, withdrawals, and incidents

Accepted versions are immutable and MUST NOT be edited in place. A substantive correction MUST be
generated as a new private draft, pass the full current checklist, and be accepted as the next
ordinal with exact predecessor ID/ordinal. The previous version remains attributable in lineage;
the public head moves only after the successor transaction commits. Regeneration alone is not a
correction and MUST NOT alter the public head.

On suspected fabrication, unsafe disclosure, rights violation, compromised credentials, corrupt
provenance, or material scientific misstatement, an editor or operator MUST:

1. stop or fail closed affected public delivery without exposing private diagnostics;
2. preserve immutable versions, AgentRun/audit evidence, and incident timestamps under access
   control;
3. assess affected versions/citations and notify accountable editors/operators;
4. publish an immutable corrected successor when correction is sufficient; or
5. withdraw/tombstone with a public reason and non-content tombstone when a synthesis-capable
   lifecycle is available, preserving audit and DOI history.

The current POC has immutable successor correction through synthesis generation/acceptance but no
dedicated public synthesis withdrawal/tombstone transition or reader UI. Until that ships, an
operator MUST fail closed the affected synthesis and record the incident through controlled
operations; they MUST NOT silently delete, mutate, or falsely label the accepted version as
withdrawn. This limitation is tracked in [POC limitations](poc-limitations.md).

## 11. Policy evolution and compatibility

Policy, checklist, and materialization identifiers are immutable semantics. A semantic change MUST
introduce a new version; code and OpenAPI MUST NOT silently redefine an existing identifier.
Supported-version registries are append-only while accepted records reference a version. A new
current version MUST be added without removing old entries, and public read validation MUST use the
historical registry/schema so a policy release cannot turn valid older accepted versions into 404s.

The current constants, public field allowlists, private denylist, wording, version-aware checklist
validator, strict DTO tests, OpenAPI drift checks, and UI imports are machine-checked in CI. A
policy bump is incomplete until this document, registries/schemas, OpenAPI, UI wording, migration
impact, and regression fixtures are updated together.

## 12. Related governance

- [Agent governance](agent-governance.md) defines bounded generation and AgentRun handling.
- [Editorial governance](editorial-governance.md) defines roles and archive curation.
- [Synthesis editorial lifecycle](synthesis-editorial.md) describes the shipped transaction and
  public-read integrity checks.
- [Grounding evaluation](grounding-evaluation.md) tests adversarial citations and prompt injection.
- [DOI and versioning](doi-and-versioning.md) defines general identifier semantics.
- [Privacy and takedown operations](operations/privacy-and-takedown.md) defines operator response.
