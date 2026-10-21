# Public protocol and execution GET batch

This isolated batch starts at `main` `78c3df09cdc5127e771cb9fee07464694c1a1a6c`.
It adds synthetic public archive rows and declarative acceptance cases. It changes no
production handler, validator, database schema, private workspace data or access policy.

## Exact scope

`publicProtocolScenarios()` declares **162 requests**: 27 cases under each of the six
existing principal/session recipes. Expected outcomes are **54 × 200**, **72 × 404**,
**30 × 401** and **6 × 409**. Seven new GET methods have populated positive outcomes:

- Execution passport detail: exact native signature/provenance, claim and artifacts;
  missing, hidden-claim, tombstoned-claim, tampered and unknown-signing-key denials.
- Verification run detail: exact subject, protocol, verifier, findings, completed
  artifacts, lifecycle and limitations. Raw input JSON and lease token digests stay absent.
- Verification findings: two source-attributed synthetic assertions (`unverifiable`
  and `discrepancy`) retain evidence and completed-artifact references.
- Verification artifact content: exact public bytes, digest, byte length and immutable
  cache headers; credential-protected bytes deny, prepared/missing rows deny, and
  deliberately corrupt stored bytes produce an integrity conflict.
- Publication-version verifications: one populated run and exact status summary;
  missing version denies and a different existing version returns an empty list.
- Certification result: exact immutable input/protocol/result attribution, human
  assessment, inconclusive outcome, declared lack of independence, and withdrawal history.
- Publication-version certifications: withdrawal remains visible as historical context;
  a different existing version returns an empty list and a missing version denies.

Four additional GET methods receive **denial-only** coverage: verifier input/source
artifact reads and certifier run/input reads. The exact production bearer-credential
parsers reject all six public session recipes with 401 before a credential lookup.
These are not worker-positive tests. Credential scopes, leases, expiry, replay and
worker-authorized source transfer remain separate obligations. The static method inventory
contains 143 methods: this batch reduces methods without any declared cases from 86
to 75, adding eleven methods with cases and seven with positive cases. This is an
inventory count, not proof of G1 acceptance. Mutation methods exported
alongside covered GETs remain uncovered by this batch.

The `private` verification-artifact visibility control is synthetic retained public
archive infrastructure requiring worker authentication. It is not private workspace
data or evidence of private workspace authorization. A-only/B-only/A+B remain public
fixture labels. No scientific verification, external certification or workflow executed.

## Native fixtures and database guards

`fixtures/protocol-input.json` was captured using the actual production
`createVerificationRun` and `createCertificationRun` builders against the dedicated
synthetic database with the fixed G1 clock. Both produced the same native 1.3.0 packet.
Its canonical snapshot digest is
`890bdbdfaafb0db8bae2370c838704ff684969413a79160f6e1bd2f89c87bd6e`.
Offline tests parse the packet and verify its internal digest and both stored snapshots.

Five execution sources use the existing native Workflow Run RO-Crate/DSSE validator.
The signed fixture bytes and **public** verification keys are committed; no private key
is retained. Four explicitly configured synthetic keys are in
`protocol-trusted-keys.json`. A fifth valid source has its own public key in
`protocol-untrusted-key.json`, deliberately excluded from that trust policy. Tests
verify the fifth source with its own key and reject it under the configured policy;
the real public handler also returns 404. Another source is deliberately tampered and
must fail native verification and the real public read. Valid source signatures never
assert that a workflow actually ran or that a scientific claim is true.

`PROTOCOL_FIXTURE_COUNT_DELTAS` records **40 inserted rows** across twelve tables.
The native database guards require evidence inserts under an active claimant, so the
SQL inserts its new synthetic run as running, inserts its evidence, then performs one
exact guarded transition of **that newly inserted run** to completed. No existing row
is updated, no trigger is disabled and no additional runtime write privilege is granted.
The SQL is loaded after public, discovery, editorial and scholarly fixtures inside each
reset transaction. The readable passport binds the second review's existing claim,
leaving the earlier first-claim packet expectations intact.

## Minimum additional public grants

Measured from current main's exact restricted public grants, only SELECT was added:

| Table                         | Read dependency                                                           |
| ----------------------------- | ------------------------------------------------------------------------- |
| ExecutionPassportArtifact     | Native materialized artifact comparison during public passport validation |
| VerificationRun               | Run detail, findings container and publication-version run list           |
| VerificationArtifact          | Completed run metadata and content lookup                                 |
| VerificationArtifactBlob      | Exact bounded artifact content and integrity verification                 |
| VerificationFinding           | Findings list, run detail and publication summary                         |
| VerificationRunLifecycleEvent | Ordered public run lifecycle                                              |
| CertificationRun              | Result's immutable input metadata                                         |
| CertificationLifecycleEvent   | Withdrawal history and public summary lifecycle state                     |

Each missing table was observed as a permission error before its grant was added.
`VerificationFindingArtifact` receives inserted fixture links but requires no new SELECT:
the public finding reader projects the validated immutable payload's references.
Worker credential tables require no grant for these authentication-rejection controls.

## Root integration and evidence limits

1. Add literal `.g1.spec.ts` imports matching `bindProtocolRoutes`; append the declarative
   program after a reset and before relevant new mutations. Add fixture counts and the
   eight measured SELECT grants to the shared harness; root owns those shared files.
   In the existing discovery publication-version case, independently require
   `/certificationCount: 1` before reviewing its six changed golden bodies.
2. Keep `EXECUTION_PASSPORT_TRUSTED_KEYS_JSON` forbidden as an inherited child environment
   value. **After** the existing closed-environment assertion and **before** production
   handler imports, the test runner may set only the exact committed public synthetic
   keys with `vi.stubEnv`, then reset the production config cache. Restore it on cleanup.
   No runtime loader, validator, cryptography or credential check is mocked.
3. Independently review the expanded golden after the full repeated PostgreSQL harness,
   role/auth evidence and cleanup pass. A static obligation inventory or one successful
   handler probe is not full G1 acceptance.

Local PostgreSQL 16.15 / Node 24.16.0 evidence lives under
`/tmp/oratlas-g1-protocol-pg`: `probe-capture.json`, `restricted-probe.log`,
`observed-grants.json`, `old-program-capture.json`, `old-program-probe.log` and
`old-program-golden-differences.json`. Only the dedicated `oratlas_g1_protocol` database
was reset. The separate integrated/index targets and cluster were preserved. Temporary
probe suites stay alongside local evidence and are not duplicated in the committed runner.

All 162 proposed requests passed under the restricted role, with actual production
handlers, Next request context, signed user sessions, native cryptography and blocked
outbound HTTP. The unchanged earlier 895-record program also passed its existing assertions against
the added fixtures. Comparison with the reviewed golden found exactly **six changed
records**: the discovery publication-version DTO under each principal changes only
`certificationCount` from 0 to 1. All other **889 record values are unchanged**. Root
integration must explicitly assert the new count in that existing discovery case and
review those six golden changes; this is a populated-fixture effect, not a handler fix.
These are
single local captures. The root still owns repeated integrated G1 evidence, CI and review.

Offline checks:

```bash
pnpm exec vitest run scripts/private-workspace-g1/protocol-scenarios.test.ts scripts/architecture-boundaries.test.ts
pnpm exec tsc --project scripts/private-workspace-g1/tsconfig.json
```

Other uncovered methods, real Next HTML/metadata serving, non-HTTP channels and private
workspace authorization remain explicit separate work. This batch cannot enable private
research or mark G1 complete.
