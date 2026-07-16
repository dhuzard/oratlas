# Synthesis freshness and regeneration proposals

KG-14 evaluates only the authoritative, editor-accepted synthesis head. Before comparison it runs
the complete KG-13 public-integrity validation; corrupt heads produce no freshness claim or proposal.
The evaluator then rematerializes the accepted draft's exact canonical selector with the current
bounded KG-13 loader: newest valid node heads without fallback, exact editor-confirmed relations,
and authoritative relation-specific TRUST only.

Each immutable evaluation stores a versioned canonical identity, accepted/evaluated packet bytes and
hashes, selector identity, materialization policy versions, sorted reason codes, and a sorted preview
of at most 100 affected node/edge/TRUST/policy references. The full affected count and a truncation
flag remain available to editors. Reasons distinguish policy drift, node-head and membership drift,
confirmed-edge changes, TRUST changes, residual packet drift, and fail-closed materialization failure.
Materialization failures intentionally remain actionable but expose only that bounded reason code;
raw loader/database errors are neither persisted in evaluation summaries nor returned to editors.

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

Public synthesis DTOs expose only `unchecked`, `fresh`, or `stale`, the versioned reason codes, the
evaluation timestamp, and affected-reference count. Evaluation packet bytes, selectors, proposal
IDs, editor decisions, run IDs, and draft IDs remain private. Invalid freshness rows degrade to
`unchecked` without weakening the accepted-review integrity boundary. Malformed or obsolete private
proposal rows are omitted from the editorial queue rather than partially decoded or exposed.
