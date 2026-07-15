# Replication Marketplace

The Replication Marketplace turns transparent evidence gaps into human-published, scoped
replication briefs. It is an editorial registry: Atlas does not run studies, execute repository
code, initiate payments, promise results, or publish a brief automatically.

## Evidence-gap triage

`packages/knowledge/src/replication.ts` applies a deterministic ordering to the current
independence-aware synthesis corpus. It uses only declared facts already visible in Atlas:

- scope-matched, scope-different, and scope-undeclared opposing claims;
- independent supporting and opposing evidence-family counts;
- duplicated evidence families and circular citations; and
- whether structured comparison scope was declared.

The output has categorical attention bands and human-readable signal codes. It deliberately has
no scalar quality score, truth probability, predicted replication outcome, or person ranking.
Lexicographic rules and a stable claim-id tie-break make identical inputs reproducible. The list is
shown to editors as triage only and cannot create a draft. Atlas keys computed triage snapshots by
the canonical readable-corpus hash, coalesces concurrent requests for the same corpus, and retains
only a small bounded set of corpus revisions per process. Evidence-family direction indexes avoid
all-pairs work for unrelated claims; work scales with declared relations and actual contradiction
pairs rather than the square of the whole corpus.

The anonymous marketplace never computes current-corpus synthesis. It scans at most fifty already
published briefs and shows at most thirty unique, publication-frozen triage rows, explicitly labeled
as historical provenance rather than a live or complete corpus ranking. Current triage remains in
the authenticated editor workflow. A cold public request therefore has a deterministic synthesis
cost of zero even when the readable corpus contains more than five thousand claims.

When an editor publishes a brief, Atlas stores the exact categorical triage snapshot for its
linked claims, its capture timestamp, and the canonical readable-corpus hash. Publication
recomputes that hash inside the serializable transaction and fails if the corpus changed before
commit. The snapshot is provenance for the editorial decision, not a scientific judgement.

## Registered briefs

Every draft links one to twenty claims from readable published review versions and records:

- a structured population/model/intervention/outcome/method scope;
- a plain-language summary and expected-information-gain rationale;
- an effort band (`small`, `medium`, `large`, or `consortium`);
- one to twenty clean public HTTPS citation links; and
- an optional clean public HTTPS protocol link.

Public links are trimmed and stored in canonical URL form. Validation is offline and rejects
credentials, queries, fragments, localhost, single-label or internal hostnames, and loopback,
private, link-local, multicast, documentation, or reserved IPv4/IPv6 literals. Atlas does not use
DNS or make a network request while validating a link.

The lifecycle is `draft → open → claimed → completed`, with `draft`, `open`, or `claimed` also able
to transition to `withdrawn`. Drafts are private. Publication and withdrawal are editor-only;
claiming requires an authenticated user; completion can be recorded only by the attributable
claimant. Completion means a public report was registered—it does not mean Atlas verified or
endorsed its methods or findings. Claim notes are public beside the attributable account, so the
claim form warns researchers not to include confidential contact, participant, or protocol data.

Every mutation uses strict bounded contracts, same-origin JSON checks, session authentication,
request-size and rate limits, and an optimistic `expectedRevision` compare-and-swap. Draft
registration uses a UUID idempotency key and content hash. The editor client binds that UUID to the
canonical draft payload: it retains the identity only for an identical retry after ambiguous
transport loss or a server error, and clears it after success or a definitive non-commit response.
Lifecycle changes and the responsible actor are written to the append-only audit trail in the same
serializable transaction.

## Surfaces

- `/replications` — public, filtered marketplace and bounded published-triage provenance.
- `/replications/{slug}` — linked claim passports, scope, rationale, protocol/citations, and
  attributable lifecycle.
- `/editorial/replications` — editor-only draft registration, explicit publication, withdrawal,
  and deterministic triage context.
- `/api/replications` — bounded public listing and editor-only draft creation.
- `/api/replications/{slug}` — one public brief.
- `/api/replications/{slug}/transitions` — authenticated CAS lifecycle actions.

The JSON contracts are documented in `docs/openapi.yaml`.

## Persistence portability

`ReplicationBrief` stores the lifecycle and attribution; `ReplicationBriefClaim` is the ordered
many-to-many link to archived claims. Structured values use canonical JSON strings, matching the
repository's provider-portable Prisma conventions. The canonical SQLite schema and generated
PostgreSQL schema/DDL contain identical models.

If a linked review or claim is no longer publicly readable, public marketplace queries fail closed
by omitting the brief. Claim and completion transitions use the same public-readability predicate
and return the same not-found response as any other inaccessible brief. Historical audit and
database records remain intact for editors.
