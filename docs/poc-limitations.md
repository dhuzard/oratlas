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
- **Example data is synthetic.** Seed DOIs (`10.5555/…`) do not resolve and are flagged; do not
  mistake them for real deposits.

## What the platform explicitly does not verify

- Acceptance is **not peer review**.
- TRUST is **relation-specific**, never a whole-paper probability.
- Repository and agent TRUST records are **source assertions** until an Atlas editor records a
  current hash-bound structural-review marker.
- **DOI presence does not establish scientific quality.**
- **GitHub default-branch content may differ from a deposited release**; the exact reviewed state
  is the commit SHA.
- Several reviews citing the same primary source are **not independent replication**.
- A validated Atlas Discuss evidence edge proves that the answer points to a recorded relation; it
  does **not** prove that the claim or cited study is scientifically correct.

## Suggested next production steps

See the final section of the execution report and `docs/deployment.md`. In short: PostgreSQL +
migrations, a real ingestion queue, cached/engine-backed search, full OAuth, background
re-validation of DOIs, and per-criterion TRUST authoring UI for editors.
