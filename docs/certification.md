# Generic certification infrastructure

ORAtlas hosts certification infrastructure. It does not automatically endorse certification
results. A certification is an attributable assertion by one accountable certifier about one exact
`PublicationVersion`, evaluated under one exact immutable `CertificationProtocol` version.

Never read an unqualified “certified” label from this model. The meaningful statement is always:
“Certifier X reported outcome Y under protocol family P, version V.” Different certifiers may issue
contradictory results for the same publication version; ORAtlas exposes both and computes no
reconciliation, scientific score, or universal trust score.

```text
PublicationVersion
       │
       ▼
CertificationRun
       │
       ▼
immutable input snapshot
       │
       ├──────────────┐
       ▼              ▼
 Certifier A      Certifier B
       │              │
       ▼              ▼
 Result A         Result B
       └──── coexist ─┘
```

## Exact input and completeness

Starting a run builds and validates the current common PublicationVersion packet v1.2.0. It
contains the persisted normalized scientific content corpus alongside identity, captures, claims,
production provenance and the public ORAtlas knowledge state. ORAtlas stores its exact canonical
JSON, the SHA-256 of those exact JSON bytes, its packet schema version, capture time, and
completeness object. That snapshot never changes. Later canonical bindings, relations, production
assertions, public assessments, or changes to the external website may affect future observations
but cannot reinterpret an old certification. A run never fetches the mutable website after it
begins.

Protocols specify which packet sections must be complete. A run fails closed if one of those
sections is truncated. For `content`, completeness additionally requires `coverage: complete`; a
bounded maximum, `partial`, `unknown`, or `unsupported` never masquerades as whole-publication
coverage. Other protocols may explicitly accept incomplete inputs; the result still exposes the
exact captured completeness state.

```text
PublicationVersion
       │
       ├── exact source/captures
       ├── claim occurrences
       ├── normalized scientific content corpus
       └── public ORAtlas knowledge state
                │
                ▼
        PublicationVersion packet 1.2
                │
                ▼
        CertificationRun snapshot
```

The normalized content corpus is deterministic inert evaluation text, not a statement that
ORAtlas has scientifically validated the article.

## Protocol and result contracts

A protocol belongs to one certifier and is identified by `(certifier, seriesKey, version)`. Its
canonical definition and SHA-256 are immutable. Criteria have stable identifiers, required flags,
allowed bounded statuses, and optional evidence requirements. Assessment mode (`human`, `ai`, or
`hybrid`) describes the certification process and is unrelated to the publication's production
mode. Outcome vocabulary is bounded by the exact protocol and is never a numeric score by default.

A result is immutable and exactly bound to its run, subject version, certifier, protocol,
assessment mode, and captured packet hash. Packet-local evidence references are typed and must
resolve inside the snapshot. An external resource requires both an HTTPS URL and SHA-256. Conflict
of interest and independence are attributable declarations, not inferred facts. AI/hybrid results
link to a verified `ExecutionPassport` or a succeeded `external-certification` `AgentRun` whose
non-null packet hash matches the captured input. Human results do not require either reference, but
any reference they supply is validated to the same standard. No prompt, token, reasoning, secret,
or rejected raw output is made public.

Issued, superseded, withdrawn, and revoked are append-only lifecycle events. Public summaries expose
both the history and its current lifecycle state; history is never deleted. A later
`PublicationVersion` has no inherited result: it needs a new run, snapshot, and result.

## Scoped external API journey

An administrator creates a certifier and exact protocol version, then issues a credential with
only `certification:read` and/or `certification:submit`. The random bearer secret is shown once;
only its SHA-256 and a non-secret lookup prefix are stored. Credentials can expire or be revoked,
and issuance/revocation is audited. They confer no editor, graph governance, registration,
canonical identity, production provenance, relation, or TRUST capability.

An external certifier needs only documented HTTP APIs:

1. `POST /api/certification-runs` with one exact version, protocol, mode, and idempotency key.
2. `GET /api/certification-runs/{id}/input` to receive the immutable snapshot and hash.
3. Evaluate outside ORAtlas.
4. On success, `POST /api/certification-runs/{id}/result` with protocol-valid criteria and evidence.
5. If evaluation cannot complete, instead `POST /api/certification-runs/{id}/transition` with
   `failed` or `cancelled` and an explicit reason. Only the owning certifier can close its open run;
   an exact terminal replay is idempotent and a conflicting transition is rejected.
6. `GET /api/publication-versions/{id}/certifications` to observe all public results.

The framework-free implementation in `packages/certifier-client` performs this journey with
`fetch` only and has no repository or database access. `scripts/certifier-api-client.ts` is its
public example entrypoint.

## Epistemic separation

- A source publication assertion is what the publication declares.
- Structural provenance says which published structure/source bytes ORAtlas captured and checked.
- Production provenance attributes authoring actors, workflows, and activities.
- Canonical graph confirmation is an explicit identity or relationship governance decision.
- TRUST assesses exact claim–evidence or graph relations.
- Certification applies a versioned certifier-owned protocol to one exact PublicationVersion input.

Certification cannot mutate any of the other layers. It does not imply scientific truth,
publication continuity, claim identity, authorship, or ORAtlas endorsement.
