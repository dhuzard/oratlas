# Synthetic replay seams: source findings and unresolved G1 limit

Status: design for independent review only. No replay implementation, production change or G1 acceptance-rule change is proposed by this note. Real unhooked HTML nonce differences remain preserved by the HTTP prototype. Random IDs must not be removed from bodies, rewritten in database triggers, or accepted by repeatedly regenerating golden output.

## Observed installed artifacts

The inspected installation is Node **24.16.0**, Next **15.5.20**, and Prisma client **6.19.3** (not 6.19.0). The generated PostgreSQL client selects the native **library** engine, commit `c2990dca591cba766e3b7ef5d9e8a84796e47ab7`. The inspected artifact tree was `/tmp/oratlas-g1-next`, including its own generated PostgreSQL client and resolved shared dependency installation. A generated client in another worktree can have a different index hash, so these identities must be checked against that exact observation context. These are observed installed artifacts; they are not a claim that the entire build was independently reproduced.

| Inspected artifact                                                          | SHA-256                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/db/generated/client/index.js`                                     | `920b8dd59072c1aa47322551d429a888dc503eee1c01712baf7aa728ce0e0825` |
| `packages/db/generated/client/runtime/library.js`                           | `5a72b6f69474641f48a0f5ffee45802dc939c6333467371ebbd9102353eb7aae` |
| `packages/db/generated/client/libquery_engine-debian-openssl-3.0.x.so.node` | `a2924eab1c78a0a7bb67edac5738939fa10589ef073af5542f53812a22e4a7d8` |
| `next/dist/compiled/edge-runtime/index.js`                                  | `06703ed6b001b0f02f8043bb499f3716f2c3b76b7df628a1cea30d1ee671edb2` |
| `next/dist/server/web/sandbox/context.js`                                   | `21a4546515b2a23b0130ba13a421928b7b7b3f9882771a7a50e536c6f19aca53` |
| `apps/web/src/middleware.ts`                                                | `780dcc19ddaede74caafa0247ddf047e90223e033e917b1654595abb59eb4bb7` |
| `packages/db/src/index.ts`                                                  | `43a95343b3217e7a2257fb612f6698a6acb9d5d25d7396d91196bc91c3ab5490` |

Paths for Next are relative to its resolved package installation. Generated client artifacts are ignored build outputs, not committed changes. Any future fixture must verify the exact versions, source/preload/build hashes and runtime topology before activation, and reject mismatches.

## Prisma source boundary

The pinned native engine parser evaluates absent schema defaults before query execution. The default generator dispatches CUID to `cuid::cuid1()` and UUID to the Rust UUID implementation. Thus an application-level Node crypto or Date replacement does not control these generators. Explicit values bypass that default evaluation, which is the basis of the conditional input-fixture proposal below. [Pinned parser](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/query-engine/core/src/query_document/parser.rs#L706), [pinned default generator](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/query-engine/query-structure/src/default_value.rs#L323).

The engine lockfile pins Prisma's `cuid-rust` fork at `dc68c4f47a3dbcd511f605135ac7c948775a3ab9`. CUID1 combines a native timestamp, process-global counter, cached host/process fingerprint and random blocks. The fingerprint uses hostname and process ID; its fallback can generate a UUID. Random blocks use Rust `thread_rng()`. The counter is atomic, so concurrent generation order is another input. [Engine lockfile](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/Cargo.lock#L1033), [CUID1 composition](https://github.com/prisma/cuid-rust/blob/dc68c4f47a3dbcd511f605135ac7c948775a3ab9/crates/cuid1/src/lib.rs#L17), [fingerprint](https://github.com/prisma/cuid-rust/blob/dc68c4f47a3dbcd511f605135ac7c948775a3ab9/crates/cuid1/src/fingerprint.rs), [random source](https://github.com/prisma/cuid-rust/blob/dc68c4f47a3dbcd511f605135ac7c948775a3ab9/crates/cuid1/src/random.rs).

Native time comes from Rust `SystemTime`, independently of JavaScript Date. The inspected schema also has 95 fields containing 96 `@default(now())` or `@updatedAt` annotations (one field contains both); native timestamps are a separate obstacle for mutation paths that expose them. Freezing only JS Date is not evidence that these values repeat. [Pinned native clock](https://github.com/prisma/cuid-rust/blob/dc68c4f47a3dbcd511f605135ac7c948775a3ab9/crates/cuid-util/src/lib.rs#L8).

A process-wide OS entropy/clock/PID interposer is not a narrow CUID seam: it can alter credentials, transport cryptography, unrelated threads and native dependencies. Replacing the native engine, switching engine type, patching its binary or its default implementation would change the tested execution substrate. None is recommended as strict evidence for the unchanged deployed engine.

## Conditional explicit-ID input fixture, not native-generator replay

The existing `getPrisma()` singleton creates a real Prisma client with its existing audit stamping extension. A separately reviewed test child could obtain that real client, add one narrow query extension, and install the extended client in the existing singleton slot **before any application DB import**. Application handlers, transaction processing, engine execution, real constraints and existing audit stamping would still execute. No Prisma delegate result, transaction, authorization module or database method would be mocked. This is a proposed seam, not an implementation or verified transaction-extension behavior.

The extension's only initial permitted mutation would be adding an explicit synthetic ID to a reviewed top-level `create` input whose ID is genuinely absent and whose pinned native schema declaration is the reviewed CUID default. It would call the real `query(args)` exactly once. It must not replace a supplied ID, bypass database checks, repair failed operations or synthesize returned rows. This supplies a controlled input in place of the generator; it cannot demonstrate the native CUID generator's isolation or behavior.

Required constraints before an implementation can be considered:

1. Pin exact generated DMMF/schema, client/native-engine/source/preload hashes and a closed disposable target. Verify each allowed model/field/default against those native declarations. Refuse an existing or unexpected singleton, production build/runtime activation, providers, inherited fixture flags and all undeclared operation sites.
2. Use one sequential authority with an ordered transcript: model, operation, invocation ordinal, scenario, exact argument digest before injection, ID source and exact reviewed synthetic ID. Record failure/rollback consumption as well as success. Reject extra or missing calls, repeated IDs, unexpected ordering, schema drift and transcript leftovers. No secret or unexpected caller-supplied value may be silently canonicalized away.
3. Preserve an explicit supplied ID unchanged only when it matches that operation's reviewed explicit-input expectation; otherwise reject before dispatch. A secret-derived explicit ID must cause a transcript mismatch, never be overwritten by a fixture ID.
4. Initially reject nested create/connect-or-create, upsert, bulk create/create-many-and-return, raw writes and other unsupported implicit-generation paths. A top-level query hook does not by itself establish nested operation coverage. Do not infer comprehensive coverage from hook call count. Nested/bulk support would require its own reviewed native-operation inventory and negative tests.
5. Keep the real Prisma query, existing client extension, actual transaction and restricted PostgreSQL constraints. Prove transaction-client extension propagation, rollback, constraint violations, foreign-key linkage and audit projection with concrete tests. Propagate real errors. Do not retry with altered inputs until a failing operation passes.
6. Deal separately with native now/updatedAt values, DB defaults and application-generated random tokens. ID injection alone cannot establish exact output for those paths. Exclude an unsupported path from claimed coverage rather than implicitly freezing additional data or normalizing its response.

Positive controls would run the same explicitly reviewed transcript through four fresh isolated captures with raw bodies and persisted projections compared exactly. Mandatory negatives would include changed seed, reordered/extra/missing calls, supplied unexpected ID, nested/bulk bypass, wrong schema/hash, FK/unique rejection and transaction rollback. Changed input must fail the existing comparison or fail closed; it cannot trigger golden regeneration.

Separate **unhooked** runs must retain the actual production defaults and show that generated values vary while their real database/response associations and invariants hold. Those observations must be reported separately, with their raw evidence preserved. Neither the unhooked invariant checks nor the conditional fixture comparison alone proves four-run byte equality for native random defaults.

## Next crypto identity: correction to the proposed realm-only seam

The installed sandbox constructs `EdgeRuntime` with an `extend` callback and does not replace crypto there. The compiled runtime's primitive loader can select host `globalThis.crypto`. A read-only experiment with the actual installed module on Node 24 found:

```text
Object.hasOwn(runtime.context, "crypto") === true
runtime.context.crypto === require("node:crypto").webcrypto === globalThis.crypto
Object.hasOwn(runtime.context.crypto, "randomUUID") === false
Object.getPrototypeOf(runtime.context.crypto) === Object.getPrototypeOf(globalThis.crypto)
```

Consequently, assigning `context.crypto.randomUUID` in this installation would mutate the shared host Crypto object. Patching its prototype would also affect host users. The earlier idea of changing only an already distinct realm-owned UUID property is **not established** here. No such patch was applied during this investigation. The Next source/module hashes above bind this observation; another runtime version or extend callback must be re-examined.

A potential alternative is a new per-context crypto facade installed after the original extend callback, with a narrowly supplied synthetic UUID method and native forwarding for the other capabilities. That is a different proposal: it changes object identity and must handle WebCrypto branded receivers without modifying host objects or prototypes. It must prove untouched host UUID/getRandomValues/subtle behavior, original constructors and native signing. A facade is not approved or implemented by this note.

If independently accepted, a fixture would also need an exact module-loader/constructor wrapper restricted to its own test child, one PID/thread authority and a process-wide counter shared across context instances. It would provide unique synthetic UUIDs to a strictly ordered request program, with one independently correlated UUID per middleware match. Fail on unrecognized callers, extra realms/workers/processes, missing/extra UUIDs or unmatched requests. Preserve complete CSP, Link, HTML and RSC bytes. Record original wrapper/extend/build/preload identities and prove the fixture cannot enter an application build or deployment. No production environment switch or CSP change is appropriate.

Unhooked fresh processes must continue to demonstrate real varying nonces, and a changed synthetic seed must break exact comparison. A fixture cannot establish production unpredictability, safe concurrency, collision probability or a CSPRNG property. Build reproducibility and other Next/RSC nondeterminism remain separate obligations.

## Current strict acceptance constraint

Under the currently unchanged engine/runtime and allowed Date/request-ID-only normalization, no reviewed seam makes native CUID generation or real HTML nonces byte-identical across four fresh captures. The Node-only realm UUID idea additionally fails its host-identity premise in the inspected installation. A conditional explicit-ID test or a separately reviewed per-context facade could add useful bounded isolation evidence; neither automatically discharges this strict native-output requirement.

The next sound step is independent review of these distinctions and one narrowly scoped fixture contract, while retaining both unhooked observations and the unresolved gate. Continue adding deterministic successes and meaningful denial/invariant controls in parallel. Do not mark native mutation/HTML equality or G1 complete on the basis of this design.
