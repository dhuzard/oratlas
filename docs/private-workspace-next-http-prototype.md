# Real Next HTTP serving prototype

This additive G1 prototype starts actual Next production servers and captures HTTP response bytes. It does not extend the G1 orchestrator or declare G1 passed. Application middleware, CSP, authentication and rendering are unchanged.

## Observed result

On source `9ed83ed391c7415ee58db5aabde804923167ff1d`, Node 24.16.0 and Next 15.5.20, one prepared production build was reused by two fresh server processes. Each process handled 30 sequential requests: `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/`, and `/connect`, each with the existing six synthetic session recipes. All returned nonempty 200 responses.

The 18 metadata responses matched exactly across processes, including all captured headers except the existing Date/request-ID allowance. The sitemap included the public fixture review and excluded its hidden control. This is real serving evidence against a synthetic, public-only PostgreSQL fixture database; it is not before/after private-schema evidence.

All 12 HTML bodies differed. Production middleware generated fresh cryptographic CSP nonces, which appeared in raw CSP and HTML (and, for the home page, Link headers). The comparator reported 24 differences: headers and body for each HTML response. The test preserves and characterizes these differences. It never strips HTML, RSC, CSP, Link headers or nonces, and never mocks entropy. HTML equality remains blocked under the current Date/request-ID-only normalization rule.

The compact evidence in `scripts/private-workspace-g1/next-serving/evidence/prototype-result.json` records response lengths and hashes, runtime preload hash, build identity and raw capture hashes. The raw synthetic captures remain local to the experiment. The build used the equivalent earlier CommonJS Date preload; its original digest was not recorded, so this experiment does not provide a complete build/preload attestation. A repeatable integrated run must record the build inputs and artifact hashes before capture.

## Execution and isolation

The modules require a separately prepared production build in `apps/web/.next`; they do not rebuild per capture. The development experiment used a separate synthetic PostgreSQL cluster on loopback port 55465 and a SELECT-only `oratlas_g1_public_*` role, seeded with the existing public fixture SQL. No production database, provider, external tester or data was used. The prototype neither provisions nor resets that database; integration must supply setup, private-state comparison and final cleanup.

The server starts on `127.0.0.1` with a closed environment derived from `publicChildEnv`, telemetry disabled and a synthetic Date preload. Root and web dotenv files are refused to prevent Next from loading secrets after the whitelist. The Node preload refuses outbound fetch and HTTP requests. This is a Node guard, not a firewall or proof against native engines, subprocesses or separate Edge isolates. Provider credentials are absent. Date is frozen for synthetic cookie validity; timers, monotonic deadlines and cryptographic randomness remain real.

The POSIX lifecycle refuses occupied ports, requires the owned child's readiness marker and a listening loopback port, bounds startup time, and stops the owned process group. Capture returns only after the leader and group are gone and the port is closed. Windows is explicitly unsupported. A lifecycle test exercises the readiness deadline with an owned synthetic child that never becomes ready.

With Node 24 on PATH and dependencies available, run offline checks with:

```sh
node_modules/.bin/vitest run scripts/private-workspace-g1/next-serving/serving.test.ts
node_modules/.bin/vitest run --config scripts/private-workspace-g1/vitest.config.ts scripts/private-workspace-g1/next-serving/lifecycle.g1.spec.ts
```

After preparing the isolated fixture database and one production build using the closed child environment, create an output directory and a private file containing its restricted database URL. Explicitly opt into real HTTP capture:

```sh
G1_NEXT_PROBE_URL_FILE=/absolute/private/public.url \
G1_NEXT_PROBE_OUTPUT=/absolute/synthetic/captures \
node_modules/.bin/vitest run --config scripts/private-workspace-g1/vitest.config.ts \
  scripts/private-workspace-g1/next-serving/probe.g1.spec.ts
```

The probe uses loopback port 32571 and writes full synthetic capture JSON and bounded server logs with mode 0600. Do not point it at a production target. Its successful assertion means metadata equality plus expected HTML variance, not HTML equality or G1 acceptance. It is intentionally excluded from ordinary offline test discovery.

## Remaining work

Integrate one attested build and fresh-process captures into the existing before/after database lifecycle, reset state between compared programs, and include the serving records in the manifest and golden comparison. Add broader page and RSC coverage only with faithful actual response bytes. Any future test-only entropy replay needs a separate reviewed contract, strict runtime/module identification, per-request nonce uniqueness, unhooked production controls and changed-seed rejection. No entropy replay fixture is implemented here.
