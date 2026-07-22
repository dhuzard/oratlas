# End-to-end test budget

The Chromium end-to-end suite is a single seeded, serial Playwright run. CI reuses that seed for
every spec; individual specs must not reset or reseed the shared database.

CI records Playwright's JSON timing report and enforces an **eight-minute wall-time budget** for the
complete suite. The budget leaves headroom over the observed four-minute class of runs while still
detecting sustained growth before it consumes the twenty-minute job limit. A change that needs more
time must explain the measured increase and update the budget in
`scripts/check-e2e-budget.ts` explicitly.

CI permits one retry only to classify intermittent behavior. A test that passes on retry is reported
as flaky and still fails the budget gate. Fix or quarantine the cause with an owner and follow-up;
do not increase retries to make the job green.

When removing overlap, retain an equivalent assertion for every immutability, provenance,
authorization, fail-closed, accessibility, and scholarly-identity invariant. The timing budget is
not permission to reduce invariant coverage.

Run the browser suite locally with:

```bash
pnpm --filter @oratlas/web test:e2e
```

The JSON report and budget gate are enabled in CI. To inspect a downloaded CI report locally, place
it at `apps/web/test-results/e2e-results.json` and run `pnpm e2e:budget`.
