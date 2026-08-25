# ORA Scientific Merit Pilot 0.1.0

ORA is the first reference certifier using ORAtlas’s generic certification platform. It is an
ordinary accountable `Certifier` (`slug: ora`), not a platform truth flag. Its immutable protocol
is `scientific-merit-pilot` version `0.1.0` and assesses scientific reporting and evidential
support visible in one frozen PublicationVersion packet. It is explicitly a pilot, not definitive
peer review.

```text
ORA
 │
 ▼
scoped CertifierCredential (certification:read + certification:submit)
 │
 ▼
generic Certification API
 │
 ▼
CertificationRun
 │
 ▼
immutable PublicationVersion packet 1.2.0 or 1.3.0
 │
 ▼
provider-neutral ORA evaluator
 │
 ▼
strict, evidence-bound criterion results
 │
 ▼
deterministic outcome rule 0.1.0
 │
 ▼
generic attributed CertificationResult
```

The API-only orchestrator lives in `@oratlas/ora-certifier`. It imports neither Prisma nor web
application internals. It uses the same framework-free `CertifierApiClient` available to an
external certifier to create the run, retrieve the packet, submit the result, and mark a failed
run. The web host records a succeeded `external-certification` AgentRun for an AI execution, but
that host adapter cannot bypass HTTP result submission.

## What the statement means

“ORA Certified under Scientific Merit Pilot 0.1.0” means that the exact PublicationVersion
satisfied that protocol according to the recorded assessment and evidence.

It does not mean:

- the paper is universally true;
- all claims are correct;
- all independent certifiers agree;
- ORAtlas endorses every conclusion; or
- certification replaces peer review.

Third-party certifiers own their own immutable protocols, credentials, runs, and attributed
results. They are equivalent at the infrastructure level. A third party can publish an outcome
that contradicts ORA; both remain visible and ORAtlas calculates no consensus or scientific score.

## Evaluation boundaries

The evaluator receives only the exact frozen packet. It has no web search, refetch, tools, or code
execution. Every `pass`, `concern`, or `fail` cites an exact packet object ID. Invented IDs are
rejected before submission and again by the generic API. Source claims, citations, canonical graph
relations, and TRUST assessments are not treated as interchangeable. Citation existence is not
evidence that the citation supports a claim, and `challenges: []` is not evidence that no concern
exists.

Missing information is not failure. Partial content is allowed because current MyST 0.2.0
coverage is conservative. When unavailable material prevents assessment the status is
`insufficient-evidence`; empty or unsupported content will normally make applicable methods,
analysis, and evidence criteria inconclusive. Human, AI-assisted, and agentic publication
production modes do not themselves change scientific criterion outcomes.
Packet 1.3 contributor credit is retained in the frozen run and its digest, but names,
identifiers, affiliations, perceived prestige, contributor completeness, and contributor links are
excluded from the ORA scientific-evidence projection. Two packets with the same scientific
publication/evidence and different contributor names therefore produce the same evaluator input
and outcome rule. Historical 1.2 run snapshots remain byte-exact and readable.

The final outcome is never selected by the model:

- any required `fail` → `not-certified`;
- otherwise any required `insufficient-evidence` → `inconclusive`;
- otherwise any `concern` → `certified-with-conditions`;
- otherwise every applicable criterion passes → `certified`.

Changing that rule, the criteria, or the prompt contract requires a new protocol/evaluator
version. The prompt identifier is `ora-scientific-merit-pilot-0.1.0`.

## Production configuration

An administrator creates an ORA credential with exactly `certification:read` and
`certification:submit` using `POST /api/editorial/certifiers/{ora-id}/credentials`. The raw token
is displayed once. Store it as the deployment secret `ORA_CERTIFIER_API_TOKEN`; never commit it.

Real initiation is available to signed-in EDITOR/ADMIN users only when all of these are set:

```dotenv
ORA_CERTIFIER_API_TOKEN=oratlas_cert_…
ORA_EVALUATOR_PROVIDER=anthropic # or openai
ORA_EVALUATOR_MODEL=explicit-provider-model
ANTHROPIC_API_KEY=…              # or OPENAI_API_KEY
```

Provider requests reuse ORAtlas’s bounded transport adapters: 30-second timeout, bounded response
bytes and output tokens, two evaluator attempts, strict JSON schema validation, and no provider
tools. If configuration is absent, the editorial endpoint returns an explicit unavailable error;
it never falls back to the deterministic fixture.

The COI policy is conservative: ORA records `not-provided` unless a specific determination exists.
Its independence statement says only that the reference service assessed independently of the
publication’s declared production workflow; it does not claim broader institutional independence.

## Synthetic demonstration

Database seed creates a clearly labeled `Demo / synthetic` PublicationVersion at
`/publications/ora-demo-publication/versions/ora-demo-publication-version` and seeds the ORA
certifier/protocol, but deliberately does not write a CertificationResult directly. With a local
server and an ephemeral scoped ORA token, run `pnpm demo:ora-certification`. That development-only
script runs the deterministic strong fixture through the real run/input/result HTTP journey and
creates a real AgentRun plus an `ORA Certified · Pilot` result. It refuses production execution.
It also refuses non-local targets by default; `ORA_DEMO_ALLOW_REMOTE=1` is an explicit escape hatch
only for an isolated remote demo deployment and does not override the production-mode prohibition.

Later PublicationVersions inherit nothing. Each needs a new run, packet snapshot, evaluation, and
result. Withdrawal, revocation, and supersession remain visible lifecycle history and remove the
active Certified presentation.
