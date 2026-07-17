# Synthesis freshness and regeneration proposals

KG-14 evaluates only the authoritative, editor-accepted synthesis head. Before comparison it runs
the complete KG-13 public-integrity validation; corrupt heads produce no freshness claim or proposal.
The evaluator then rematerializes the accepted draft's exact canonical selector with the current
bounded KG-13 loader: newest valid node heads without fallback, exact editor-confirmed relations,
and authoritative relation-specific TRUST only.

Each immutable evaluation stores a versioned canonical identity, accepted/evaluated packet bytes and
hashes, selector identity, materialization policy versions, sorted reason codes, and a sorted preview
of at most 100 affected node/edge/TRUST/policy references. Node references retain safe exact old/new
version links. The full affected count (bounded at 1,201) and a truncation flag remain available to
editors. Reasons distinguish policy drift, node-head and membership drift, confirmed-edge changes,
TRUST changes, residual packet drift, and fail-closed materialization failure.

One CAS-updated `SynthesisStalenessHead` row is the authoritative current observation for each
accepted version. Immutable evaluations may be reused, so A→B→A points back to the original A bytes
while advancing the observation revision/time and proposal lifecycle. Unchanged retries do not
advance the pointer. Public reads, proposal listing, and decisions use this pointer rather than
guessing from immutable evaluation timestamps.

Materialization failures intentionally remain actionable but expose only a bounded typed class;
raw loader/database errors, messages, and stacks are neither persisted nor returned. A safe failure
fingerprint combines the class, selector/accepted packet/policy hashes, and a bounded graph watermark
(counts plus latest IDs/timestamps for node versions, confirmed edges, and relation TRUST). This is a
conservative state token, not a claim that a failed selector was fully materialized.

Stale evaluations create a private `SynthesisRegenerationProposal`. Serializable transactions and a
nullable unique accepted-head key allow at most one open proposal per head. Repeated scans reuse the
same evaluation/proposal; a changed evaluation supersedes the prior proposal. Accepting a newer head
atomically supersedes proposals for older heads. Editor actions use role rechecks, revision CAS, and
idempotency-bound decision hashes. “Request regeneration” records intent only: scans and decisions
never call an AI provider, create a draft, or publish.
Evaluation creation, proposal creation, editor resolution, and every automatic supersession append
transactional audit events with deterministic idempotency keys and bounded canonical details.

Run the bounded internal scan with:

```bash
pnpm refresh:syntheses
```

The API scan accepts a deterministic `cursor` and bounded `limit` (maximum 100); the CLI follows all
pages. One corrupt head produces an allowlisted `evaluation-failed` item and audit event but does not
block later heads. The editorial proposal queue is likewise cursor-paged. Each successful
materialization is performed twice and accepted only when the canonical packet hash is stable,
detecting graph mutations that overlap the read window.

Public synthesis DTOs expose only `unchecked`, `fresh`, or `stale`, the versioned reason codes, the
evaluation timestamp, and affected-reference count. Evaluation packet bytes, selectors, proposal
IDs, editor decisions, run IDs, and draft IDs remain private. Invalid freshness rows degrade to
`unchecked` without weakening the accepted-review integrity boundary. Malformed or obsolete private
proposal rows are omitted from the editorial queue rather than partially decoded or exposed.
Both listing and decisions also rerun the complete KG-13 accepted-head integrity boundary.
