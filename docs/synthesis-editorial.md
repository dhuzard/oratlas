# Synthesis editorial lifecycle

AI-written synthesis reviews are generated from a bounded, canonical KG-11 evidence packet and
remain private until an editor explicitly accepts them. The selector fixes current-version,
edge, contradiction, TRUST, traversal, and bound policies. The stable series identity hashes only
the canonical semantic seed or topic, while each generation snapshots its full selector, exact
node-version memberships, citation occurrences, packet bytes and hashes.

Before provider execution, the server permanently binds a request key to its canonical selector in
a durable, expiring lease claim. Recorder start atomically creates the `AgentRun` and attaches it to
the claim. An exact retry reclaims a stale pre-run or running lease, while provider failures remain
retryable. If a successful run exists before draft persistence, retry reconstructs the exact packet
from the run's canonical stored input rather than rematerializing a possibly changed graph, verifies
all hashes and selector binding, and resumes without another provider call. Private packets, prompts,
run IDs, request keys, errors, and editorial rationale are never included in public DTOs.

Accept, reject, and regeneration decisions require same-origin authenticated JSON and a current
`EDITOR` or `ADMIN` role rechecked inside a serializable transaction. The idempotency key is bound
to the canonical decision body and optimistic revision. Rejection and regeneration remain private.
Acceptance validates the immutable draft again, derives lineage and the next public ordinal only
from `Review.currentSynthesisVersionId`, snapshots the editor login/display name/role, checklist,
rights and license, optional distinct normalized version/concept DOIs, marks the linked run approved,
and advances the public head atomically. Reserved `10.5555/*` example DOIs cannot be accepted as live
synthesis identifiers.

Public reads start from that authoritative head and fail closed. They revalidate the linked draft,
successful run, canonical generation identity, hashes, exact node-version ownership, normalized
memberships/citations, source union, predecessor lineage, software/editor attribution, rights and
policy versions on every read. Corruption returns not-found rather than a partial record or server
error. Citation links use `/nodes/{nodeId}/versions/{nodeVersionId}` exactly.

Prisma schema application is followed by database-native guards on both SQLite and PostgreSQL.
These enforce source unions, lifecycle/lease states, and identifier-reference shapes even for direct
database writes. PostgreSQL CI introspects the installed constraints/triggers and exercises rejected
invalid writes.
