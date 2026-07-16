# Privacy & takedown

How Open Review Atlas honors a takedown or privacy request while preserving citation
integrity. The repository-backed review mechanism is the **tombstone**, and it is implemented for
repository publication. AI syntheses do not yet have synthesis-specific tombstone state.

See also: [article-lifecycle.md](../article-lifecycle.md) for the full lifecycle ledger, the
[operations index](./README.md), and the repository `SECURITY.md`.

## Tombstoning a request (fail closed)

This standard tombstone flow applies only to repository-backed review versions. For an AI-synthesis
incident, operators MUST immediately contain exposure by disabling or restricting the affected
public synthesis route, preserve the immutable accepted record and audit evidence, escalate to an
ADMIN and the publication-rights owner, and publish an honest incident notice through an available
operational channel. Operators MUST NOT silently delete or mutate an accepted synthesis. Restoration
requires editor re-review or an immutable corrected successor; see
[AI-written synthesis governance](../synthesis-governance.md#11-incidents-corrections-and-withdrawal).

A takedown or privacy request is actioned by tombstoning the affected article version. A
tombstoned article **fails closed**:

- **What stops being served** — no article body, no metadata, no claims, and no exports are
  returned for a tombstoned version. Every public projection (reader, JSON APIs, search, home,
  claim explorer, Atlas Discuss, preserved files, exports, diffs) withholds it. Only the
  generic tombstone notice plus the public lifecycle reason/actor/time is exposed.
- **What remains** — the **version DOI stays resolvable to the tombstone**, so existing
  citations do not dangle. Citation integrity is preserved without disclosing the withheld
  content.

The full boundary matrix is in [article-lifecycle.md](../article-lifecycle.md).

## Untrusted-content stance

All repository content is treated as untrusted regardless of takedown state:

- Rendered as **escaped text only** — no raw HTML is ever activated.
- **No clone** of submitted repositories and **no code execution**.
- Example identifiers (`10.5555/…`) are flagged and **never rendered as outbound links**, so a
  placeholder DOI can never resolve to a third-party target.

## Routing a request

Route takedown and privacy requests through the repository security/reporting policy
(`SECURITY.md`) rather than ad-hoc channels. For repository-backed reviews, an editor then performs
the lifecycle transition via the standard editorial flow (editor session, same-origin JSON, a public
reason, and the expected lifecycle revision). Synthesis requests follow the containment and
escalation path above until synthesis-specific withdrawal state exists.

## Audit

Every lifecycle transition — correction, withdrawal, tombstone — is recorded in the append-only
lifecycle ledger together with an `AuditEvent` (target version, public reason, actor, time,
review-scoped revision). Transitions are accountable and reviewable after the fact; nothing is
silently withdrawn.
