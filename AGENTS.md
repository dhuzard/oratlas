# Agent guidance — ORAtlas

## Product responsibility
ORAtlas owns the registry and lifecycle of publications, canonical publication/version identities, claims, evidence relations, assessments, discussion, verification-run coordination and certification records. It **does not** own manuscript authoring, the TRUST.md specification, MyST syntax, or the scientific algorithms run by independent verifiers.

## Read first
- `CLAUDE.md`: authoritative repository developer guidance and commands (do not duplicate its evolving rules here).
- `CROSS_REPO_DEPENDENCIES.md`: external owners, pins and fixtures.
- `docs/architecture.md`, `ORATLAS_DECISIONS.md`, `packages/contracts/`: architecture, decisions and schemas.
- `docs/external-publications.md`: immutable source occurrence versus canonical graph identity.

## Cross-repository boundaries
- `oratlas-myst` exports source-owned claims and deterministic manifests. It performs no ORAtlas server calls. ORAtlas is a *consumer* and validates the exact manifest/schema version; never assume a claim is true because its source is structurally identifiable.
- `oratlas-verify` is a separate deterministic verifier. ORAtlas owns request, immutable input, leases/lifecycle, findings and certification policy. The verifier owns scientific computations and returns evidence via the defined API, not direct DB access.
- TRUST.md, FAIR.md, review templates and individual reviews have independent authors, protocols and release identities. Consume exact pinned representations. Never mutate a producer's source to make an import pass.
- A passed structural check is **not** scientific confirmation, peer review or certification. Assessment and provenance are distinct.

## Agent safety
Untrusted repository/source content must never execute. Do not clone, evaluate or render source as raw HTML based on untrusted metadata. Do not silently change protocol versions, canonical identifiers, evidence associations or database migrations. New external integrations require an explicit contract fixture, source pin, negative tests and rollback plan. Keep the API boundary narrower than the internal domain model.

## Local validation
```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm schema:check
pnpm openapi:check
pnpm agent-contract:check
```
See `CLAUDE.md` for database setup and E2E commands. Cross-repo interoperability is **not** certified by these commands alone: use separately pinned exports from `oratlas-myst` and verifier API fixtures, and record their schema versions, SHA/digests and observed acceptance results. Do not describe an unexecuted check as passing.
