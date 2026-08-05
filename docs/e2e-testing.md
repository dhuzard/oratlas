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

## Guided Explore coverage

The seeded public Explore journey preserves these user-facing invariants:

- claims and reviews remain available as canonical result lists;
- selected interests persist transparently in the URL across search, filters, tabs, and pages;
- every visual landscape node has synchronized accessible details and a preserved-record link;
- selection reasons, publication context, one-hop focus, and overview return remain available;
- `GET /api/landscape` exposes only canonical references, ranking scores, and reasons, with no GUI
  rendering fields.

These browser assertions establish implementation parity, not usability. First-reader comprehension
and task completion are evaluated separately with the
[first-time exploration protocol](first-time-exploration-evaluation.md); no human validation result
is implied by a green E2E suite.
