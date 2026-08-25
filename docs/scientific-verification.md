# Generic scientific verification

ORAtlas is the knowledge and evidence ledger. It identifies an exact scientific subject, creates a requested `VerificationRun`, freezes canonical input, and retains attributed findings and artifacts. ORAtlas Verify and any other compatible service are external scientific executors. ORA is a reference certifier. None of these roles is structurally privileged as scientific authority.

```text
Publication / exact subject → ORAtlas requested run + frozen input
                                  ↓ HTTP/OpenAPI
                         external verifier execution
                                  ↓
                     findings + checked artifacts
                                  ↓
                         immutable ORAtlas ledger
```

ORAtlas performs no statistics, figure comparison, analysis reproduction, arbitrary-code execution, notebook execution, container execution, or LLM scientific audit. Scientific work happens outside the web process across the documented HTTP boundary.

## Identity, protocols, and subjects

A `Verifier` is an accountable service, person, or organization. Its `active`, `suspended`, or `retired` state is operational, not an authority ranking. Machine secrets use the certification credential security pattern: a random `oratlas_verify_…` token is returned once, only its SHA-256 and a 12-character lookup prefix are stored, comparison is constant-time, expiry and revocation are enforced, and the verifier must remain active. Scopes are exactly `verification:read` and `verification:submit`; they confer no editorial, publication, graph, TRUST, certification, or user-management privilege.

Each immutable `VerificationProtocol` version records its authority, series/version, type, execution mode, supported exact subject types, canonical bounded definition JSON, and definition SHA-256. The initial descriptors are `reported-statistic-consistency/0.1.0`, `figure-structured-comparison/0.1.0`, and `analysis-result-comparison/0.1.0`. They describe external protocols; they do not implement the algorithms.

A run targets exactly one DB-enforced union member:

- `PublicationVersion`;
- `PublicationClaimOccurrence`;
- `KnowledgeNodeVersion`.

There is no arbitrary `subjectType` plus string/URL escape hatch.

## Frozen input and bias reduction

For a publication version, `full` freezes exact canonical packet 1.3.0 JSON. `blinded-scientific` uses the explicit `verification-publication-input/1.0.0` derivative, records `sourcePacketSchemaVersion: 1.3.0`, and deterministically removes contributor and production-actor presentation metadata/links while retaining scientific content, occurrences, captures, relations, completeness, and necessary provenance. It is described as “bias-reduced” or “blinded scientific input,” never “unbiased.” Claim and node inputs are bounded immutable derivatives. Every run stores the exact JSON, schema/profile versions, SHA-256, and capture time; database guards prohibit later mutation.

Verification remains later evidence. It is never added to or used to bump the immutable PublicationVersion packet.

## Claim and lease

An editor creates a `requested` run. A submit-scoped verifier calls `POST /api/verification-runs/{id}/claim` with a requested lifetime of 60–900 seconds. A successful compare-and-set returns one opaque `oratlas_lease_…` secret once; only its SHA-256 is stored. The claimant sends it in `X-ORAtlas-Verification-Lease` for run input, private/source download, artifact operations, finding submission, and worker transitions.

Only one unexpired lease exists. An expired `claimed` or `running` run can be reclaimed, increments its generation, records an append-only lifecycle event, and attributes future evidence to the new claimant. A live lease, wrong verifier, expired lease, concurrent state change, or terminal run fails closed. Legal states are `requested → claimed → running → completed`; explicit failure/cancellation branches are supported. Completion requires at least one finding. Only an editor can cancel.

## Artifacts

Artifact transfer uses `oratlas-direct-binary-v1`:

1. prepare immutable metadata under the run lease;
2. `PUT` raw bytes to `/api/verification-artifacts/{id}/content` with the exact media type and lease;
3. ORAtlas checks the 8 MiB bound, byte length, media type, and SHA-256 and stores the bytes in a dedicated binary table;
4. complete the artifact under the same run lease.

Only completed same-run artifacts can be cited. Public completed artifacts are immutable downloads. Private artifacts require the active claimant lease. A verifier-provided URL is never accepted as proof. Source captures can be downloaded only through the run-scoped endpoint when their exact identity occurs in the frozen input; returned headers expose expected type, length, and digest.

## Findings and semantics

`VerificationFinding` is immutable and attributed. Generic bounded JSON preserves reported, observed, and tolerance structures without defining SciPy or any other engine as the universal format. Status meanings are:

- `verified`: protocol-defined comparison succeeded;
- `partially-verified`: only a bounded portion met the protocol;
- `discrepancy`: reported and observed evidence differ under the protocol;
- `unverifiable`: required scientific evidence was unavailable or insufficient;
- `failed`: the verification procedure itself failed, or the protocol explicitly defines a failed verification state;
- `not-applicable`: the protocol does not apply to this exact input.

Impact (`informational`, `minor`, `major`, `critical`) is only the scientific/procedural importance under that protocol. It is not author reputation, publication rank, a truth score, or a certification score. Contradictory findings coexist.

`findingKey` is unique within a run. Exact canonical replay returns the existing record. Reuse with any different payload returns HTTP 409. Concurrent identical submissions converge through the unique constraint; corrections are new findings with explicit same-run supersession.

Evidence references are closed typed references validated against ids present in frozen input or completed same-run artifacts. No mutable URL is valid evidence.

## Boundary statements

- verification != certification: verification is procedure-specific evidence; certification is a separately attributed protocol outcome;
- structural verification != scientific verification: capture integrity says nothing about scientific correctness;
- execution-attested != reproduced: an ExecutionPassport proves a chain, not the meaning of its result;
- regeneration != independent reproduction: rerunning the same implementation is a different method;
- visual similarity != replication: it is at most visual consistency evidence;
- unverifiable != failed: missing evidence is not a failed scientific result;
- AI audit != deterministic verification: execution mode and provenance remain explicit.

Completing a run does not update TRUST, complete a `ReplicationBrief`, create certification, or mutate publication/canonical graph state. Future assessments may cite the immutable evidence explicitly.

## External worker contract

The authoritative sequence and payloads are in `docs/openapi.yaml`. External clients must use Bearer verifier credentials, retain the one-time lease in memory, send `X-ORAtlas-Verification-Lease`, validate frozen-input and download digests, use raw `PUT` for negotiated artifact bytes, cite completed artifact ids, and treat HTTP 409 as an idempotency/state conflict. `@oratlas/verifier-client` demonstrates this boundary with no Prisma, DB, or internal application imports.

`SCIENTIFIC_VERIFICATION_DEMO_FINDINGS` supplies six calculation-free deterministic external-output fixtures for the correct t-test, deliberately incorrect p-value, insufficient parameters, structured figure equality/mismatch, and independently reproduced analysis cases. CI validates their contract shape; they are not attached to real publications and contain no SciPy implementation.
