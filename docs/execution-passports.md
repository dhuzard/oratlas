# Execution Passports

Execution Passports preserve and verify evidence about a completed computational workflow run. A
valid public record is labelled **`execution-attested`**. That label is deliberately narrow: it
does not mean Open Review Atlas executed submitted code, reproduced a result, or found a scientific
claim to be true.

## Safety boundary

Atlas never clones the attested repository, evaluates the workflow, loads submitted modules, or
makes a network request during registration, re-verification, display, or export. Verification is
deterministic over a size-bounded JSON package:

1. a Workflow Run RO-Crate-style JSON-LD graph;
2. a canonical JSON attestation statement in a DSSE envelope; and
3. an Ed25519 signature matched to an operator-configured key, issuer, and subject.

The accepted profile is Workflow Run RO-Crate 0.5 over Process Run 0.5, Workflow RO-Crate 1.0, and
RO-Crate 1.1. Both JSON-LD contexts are required; profile references resolve to `CreativeWork` entities, the licensed root
names the triple-typed main workflow and mentions its completed `CreateAction`, and the workflow names
a declared computer language. It contains exactly one root dataset, immutable repository source,
computational workflow, and completed `CreateAction`. The run names its exact inputs, outputs,
workflow run id and attempt. The source names full immutable commit and tree object ids. Each
artifact has an exact SHA-256 digest and byte size in both the crate and signed statement. Each claim
binding contains the collision-free Atlas claim id derived from its immutable review-version id and
repository-local id.

The bounded Atlas subset accepts only the two pinned JSON-LD contexts and an explicit property
allowlist. It does not accept the optional Workflow RO-Crate `FormalParameter` model. Unknown,
aliased, and parameter-definition properties are rejected rather than retained without validating
their conditional profile requirements; exact run inputs and outputs remain represented by the
completed action.

Registration fails closed for malformed or duplicate graph entities, unresolved references,
branch/tag/ref selectors, unknown claims, mismatched commit/tree/workflow/artifact/claim data,
non-canonical payloads, future-dated attestations, unknown keys, identity mismatches, and invalid
signatures. At least one input and output are required. Limits are 256 KB at the HTTP boundary, 160
KB for the canonical crate, 256 graph entities, 128 artifacts, 64 claims, and four signatures.

## Offline trust policy

`EXECUTION_PASSPORT_TRUSTED_KEYS_JSON` is a JSON array of:

```json
{
  "keyId": "sha256-of-DER-SPKI",
  "algorithm": "ed25519",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "https://github.com/OWNER/REPO/.github/workflows/analysis.yml@refs/heads/main"
}
```

The key id is the lowercase SHA-256 digest of the public key's DER SPKI bytes. A submitted public
key is never treated as trust evidence. Empty or invalid trust configuration makes registration and
public projection fail closed. Rotating the configured policy and calling the re-verification API
updates a revision with an attributable audit event; a failed re-verification removes the passport
from public projections.

## APIs and persistence

- `POST /api/editorial/execution-passports` registers a package after editor authorization,
  same-origin validation, rate limiting, schema validation, offline verification and claim lookup.
- `POST /api/editorial/execution-passports/{id}/verify` repeats verification against the current
  trust policy using optimistic concurrency (`expectedRevision`).
- `GET /api/execution-passports/{id}` returns the public archive-only JSON export, including the
  crate and DSSE envelope but excluding editorial internals.
- Claim-passport and review pages show verified summaries and link the export.

SQLite and PostgreSQL use identical provider-portable models. The exact source package, materialized
query fields, claim joins, artifacts, signing identity, revision and verifier attribution are stored.
Public reads re-run cryptographic verification and compare the source package with every
materialized field, so database drift or a no-longer-trusted identity is not displayed.

Audit actions are `execution-passport.registered`, `execution-passport.verified`, and
`execution-passport.verification-failed`.
