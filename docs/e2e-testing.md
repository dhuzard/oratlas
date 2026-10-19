# End-to-end test budget

The Chromium end-to-end suite runs as **six parallel shard jobs** (`e2e-shard (n/6)` in
`.github/workflows/ci.yml`). Each shard seeds its own SQLite database, so a spec must not depend on
state written by a spec in another shard, and individual specs must not reset or reseed the
database. A separate `e2e-agent-contract` job runs the live agent navigation contract.

The `e2e` job is the single gate. It needs every shard and the agent-contract job, downloads each
shard's Playwright JSON report, and runs `scripts/check-e2e-budget.ts`. Keep requiring `e2e`; the
shard job names are not a stable required-check interface.

The gate enforces a **9.75-minute budget on the sum of every shard's Playwright duration** (total
test work, not elapsed time, because shards run in parallel). The budget leaves headroom over the
observed run time while still detecting sustained growth. A change that needs more time must explain
the measured increase and update the budget in `scripts/check-e2e-budget.ts` explicitly.

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

The JSON report and budget gate are enabled in CI.

## Diagnosing a failed gate

When the gate fails, its log and the job's step summary list every `flaky` or `unexpected` test with
file, line, describe path and the first line of each failed attempt's error (no stacks). Each shard
also uploads artifacts:

- `e2e-report-<n>` (14 days): Playwright's JSON report for the shard.
- `e2e-traces-<n>` (7 days): the shard's `apps/web/test-results` directory, including retry traces.

Download them from the workflow run to inspect a flake. To reproduce one locally, place a report at
`apps/web/test-results/e2e-results.json` and run `pnpm e2e:budget`.

## Guided Explore coverage

The seeded public Explore journey preserves these user-facing invariants:

- blank Explore performs elicitation without silently selecting archive evidence or enabling Discuss;
- claims and reviews remain available through separate exhaustive indexes;
- topic, selected interests, filters, canonical focus, and the explicit known set persist in the URL;
- every visual landscape node has synchronized accessible details and an exact-version record link;
- canonical focus expands the selected node, while overview return preserves the remaining scope;
- anchored newcomers are preferred and named with familiar labels; disconnected items are explicit;
- Discuss receives only the canonical node versions and edges in the visible traversed path;
- `GET /api/landscape` exposes only canonical references, ranking scores, and reasons, with no GUI
  rendering fields.

These browser assertions establish implementation parity, not usability. First-reader comprehension
and task completion are evaluated separately with the
[first-time exploration protocol](first-time-exploration-evaluation.md); no human validation result
is implied by a green E2E suite.
