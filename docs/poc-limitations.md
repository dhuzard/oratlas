# POC limitations

Open Review Atlas is a proof of concept. This document is an honest inventory of what it does not
do and where it is intentionally narrow.

## Excluded by design (POC boundary)

Not implemented, deliberately: file uploads, private repositories, DOI minting by the platform,
full journal peer-review management, manuscript editing, billing, institutional SSO, complex
social networking, autonomous publication without validation, and a fully automated
knowledge-consensus engine.

## Known limitations

- **Ingestion is synchronous.** `inspectRepository` runs inside the request behind
  `IngestionRunner`. Large repositories are bounded by file-count/size caps and may be inspected
  partially (surfaced as warnings). A queue/worker is the production replacement.
- **Search is in-process and lexical.** Good for a POC-sized archive; not a substitute for
  PostgreSQL FTS or a search engine at scale. Semantic search is not implemented.
- **The knowledge index is rebuilt per request.** Fine at small scale; should be cached with
  invalidation in production.
- **Guided exploration is explicit and bounded.** ORAtlas does not learn or infer a reader profile.
  The GUI landscape uses only the submitted query, filters, interests, focus node, explicit
  claim-to-node identities, and confirmed public graph relations. It considers at most 40 matching
  claim candidates, preloads at most six bridged graph candidates, and displays at most six claims,
  ten citation-evidence records, three graph seeds, and twelve graph identities. It is an
  orientation aid, not a complete corpus graph.
- **The recommendation API is not a second knowledge store.** `GET /api/landscape` returns only
  canonical graph references, relative ranking scores, and reasons. Presentation fields and focus
  state remain in Explore.
- **Guided ordering is navigation metadata.** Selection reasons and ordering are deterministic and
  inspectable, but they are not measures of truth, evidence quality, consensus, or TRUST.
- **First-reader validation has not been run.** The repository contains a privacy-minimal protocol
  and reporting CLI, not evidence that readers understand the interface or complete its tasks. See
  [First-time exploration evaluation](first-time-exploration-evaluation.md).
- **Rate limiting is in-process.** Per-node only; use a shared store for multi-node deployments.
- **Auth is minimal.** Cookie sessions + optional GitHub OAuth + dev mock. No org/OIDC, no email
  verification, no fine-grained permissions beyond USER/EDITOR/ADMIN.
- **LLM mode is single-provider.** Only an Anthropic adapter is wired, behind a provider-neutral
  interface. It is optional; the app is fully usable without it.
- **Cross-review links use two signals** (shared citations, lexical similarity). Embeddings are
  optional and not implemented.
- **Compatibility heuristics are tuned to the reference template.** They are transparent and
  rule-based, but a genuinely novel-but-valid review structure could be under-classified; the
  report always explains why, and editors can still accept.
- **Inspection capabilities expire after 30 minutes.** An expired or consumed capability requires
  reinspection. This deliberately favors source integrity over long-lived browser drafts.
- **Example data is synthetic.** Seed DOIs (`10.5555/…`) do not resolve and are flagged; do not
  mistake them for real deposits.
- **AI synthesis withdrawal is not yet a dedicated public lifecycle.** Accepted syntheses support
  immutable corrected successors, but the POC has no synthesis-specific withdrawal/tombstone
  transition or reader UI. A suspected privacy, rights, integrity, or scientific incident must be
  failed closed and handled by controlled operators without silently deleting or mutating the
  accepted version. See the [normative synthesis policy](synthesis-governance.md).

## What the platform explicitly does not verify

- Acceptance is **not peer review**.
- TRUST is **relation-specific**, never a whole-paper probability.
- Repository and agent TRUST records are **source assertions** until an Atlas editor records a
  current hash-bound structural-review marker.
- **DOI presence does not establish scientific quality.**
- **GitHub default-branch content may differ from a deposited release**; the exact reviewed state
  is the explicitly selected commit and its tree SHA. Version DOI claims cannot silently use the
  default-branch selection.
- Several reviews citing the same primary source are **not independent replication**.
- A validated Grounded Q&A (Atlas Discuss) evidence edge proves that the answer points to a
  recorded relation; it does **not** prove that the claim or cited study is scientifically correct.
- A guided Explore selection proves only that a record matched the declared navigation rules. It
  does **not** establish relevance for every reader, scientific priority, quality, or correctness.
- An editor-accepted AI synthesis is **not peer review, scientific correctness, consensus, truth
  adjudication, or a blanket TRUST assessment**. The software agent is not a person; the named
  editor is accountable for curation and the acceptance checklist, not attributed as the author of
  generated prose.
- The ingestion AI extraction slice currently provides versioned proposal contracts, deterministic
  commit/tree-pinned packet construction, and fail-closed source-span validation. It does not yet
  run a provider, persist proposals, or expose a human-review UI; deterministic ingestion remains
  the only authoritative extraction path.

## Suggested next production steps

See the final section of the execution report and `docs/deployment.md`. In short: PostgreSQL +
migrations, a real ingestion queue, cached/engine-backed search, full OAuth, background
re-validation of DOIs, and per-criterion TRUST authoring UI for editors.
