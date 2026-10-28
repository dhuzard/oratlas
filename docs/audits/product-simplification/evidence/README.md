# Audit evidence record

Date: 2026-10-28 (user's Europe/Paris date). Checkout: `c02db1bf55fce2bc5a98ea3c915a22e9885e30bc`. Working tree was clean before audit artifacts were created. No production code, contracts, migrations, pinned fixtures or governance files were edited. All retained additions are under `docs/audits/product-simplification/`.

## Sources and coverage

Read repository instructions, CLAUDE, CROSS_REPO_DEPENDENCIES, ratified decisions, architecture and external-publication docs; inspected routing/layout, all significant page families, UI components, auth/config, canonical/legacy read models, occurrence materialization, identity/edge decisions, discussion scope, scientific verification/certification boundaries, current Prisma models and relevant contracts/tests. Reviewed UI_UX_RULES/product-experience and private-workspace execution/owner/gate documentation. Source presence is not operational acceptance.

GitHub read-only search returned open issues 248, 243, 204, 203, 205, 206, 221, 201, 199, 198, 207, 195, 178, 173, 123 and 162. Issue statements about production incidents are attributed reports, not reproduced measurements. No issues, PRs or messages were created. Competitor context in [strategy](../03-product-strategy.md) uses linked official documentation, not hands-on competitive benchmarks.

## Local execution

Existing dependencies were used; no install or version updates. `pnpm` was not on this shell's PATH; commands used the installed pnpm 10.33.0 `bin/pnpm.cjs` via Node. Runtime reported Node 24.16.0, Next 15.5.20, Prisma client 6.19.3 and Vitest 3.2.7.

Dedicated database: `file:C:/Users/damie/AppData/Local/Temp/oratlas-product-audit-20261028.db`. An initial Prisma push to a nonexistent file returned a generic schema-engine error. A diagnostic copy of the old frontend fixture lacked the Publication table and was not used for observations. Creating the new empty SQLite file with Node's SQLite API, then pushing the current schema, applying existing guards, seeding and canonical materialization succeeded. No existing development/production database was reset or migrated.

Equivalent setup commands (with the dedicated `DATABASE_URL` set in the child process):

```text
prisma db push --schema packages/db/prisma/schema.prisma --skip-generate
tsx packages/db/scripts/apply-database-guards.ts
tsx packages/db/src/seed/seed.ts
tsx --conditions=react-server scripts/materialize-seed-canonical-graph.ts
```

Started `apps/web` with `next dev -p 3187`, mock auth explicitly enabled, local session secret/base URL and server LLM mode disabled. Browser used installed Chromium 1248 headlessly. No provider key was entered, external source was imported, or verifier service was called. Mock sign-in writes affected only the disposable audit database.

## Browser observations

[browser-observations.json](browser-observations.json) records headings, main content, local links and overflow for 13 successful HTTP route/query cases: `/`, `/explore`, `/explore?q=replay`, `/publications`, `/compare`, `/claims`, `/archive`, `/discuss`, `/connect`, `/submit`, `/coverage`, `/verification`, `/certifications`. The synthetic publication detail also loaded. The 390×844 Explore case showed no document-wide horizontal overflow; full-page capture height is 5,841px. Desktop viewport: 1440×1000. These are fixture-dependent observations, not production performance measurements.

[interaction-observations.json](interaction-observations.json) records an anonymous deterministic Q&A response, review → exact claim passport traversal, and mock editor sign-in with rendered queue headings. A first interaction run timed out while compiling the cold review route; the later warmed run completed. No editorial acceptance, challenge mutation, relationship confirmation or full import was performed.

Screenshots:

- [Home](home-desktop.png), [empty Explore](explore-desktop.png), [scoped Explore](explore-scoped-desktop.png), [mobile Explore](explore-mobile.png).
- [Review comparison](compare-desktop.png), [publications](publications-desktop.png), [synthetic publication](publication-detail-desktop.png).
- [Claim passport](claim-detail-desktop.png), [editorial queues](editorial-desktop.png).

Home, scoped Explore and mobile Explore were directly visually inspected. Other captures support DOM observations and are available for review; no claim is made that every page or viewport received a visual audit.

## Accessibility

Local axe scans with WCAG 2 A/AA and 2.1 A/AA tags:

| Page                | Observed violations                                                          |
| ------------------- | ---------------------------------------------------------------------------- |
| `/`                 | None returned in this scan                                                   |
| `/compare`          | None returned in this scan                                                   |
| `/explore?q=replay` | One serious `nested-interactive`: SVG `role="img"` has focusable descendants |

[axe-explore.json](axe-explore.json) contains the exact target and failure summary. Initial audit harness required an explicit Playwright BrowserContext; rerun with that harness correction produced the results above. No application changes were made. These scans do not cover all routes, keyboard behavior, screen readers, contrast states or mobile controls; they are not certification of accessibility.

## Executed checks and outcomes

| Check                                                                                               | Observed outcome                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema:check`                                                                                      | Passed review/node manifest and atlas-check schema/reference/unsafe-path checks                                                                                                                                                                           |
| `openapi:check`                                                                                     | Passed generated artifacts and route coverage: 138 documented JSON operations; 140 route operations including two OAuth exclusions                                                                                                                        |
| `agent-contract:check`                                                                              | Initial run lacked BASE_URL; next cold-server run timed out. Rerun with `BASE_URL=http://localhost:3187` on warmed server passed: 14 advertised links, exact graph 2 pages/4 edges, stable graph 3 pages/6 edges, hostile archived text preserved as data |
| Targeted Vitest: node-identity/publications/discussion-scope/SpecialistTools/source-credit-adapters | Four files passed, 33 tests passed; source-credit-adapters failed at suite collection with `packet-artifact-digest-mismatch`                                                                                                                              |
| `test:producer-contracts`                                                                           | Failed: 11 tests passed, 2 MyST tests failed on pinned claim bytes, 2 scientific-verification integration tests skipped after beforeAll hook timeout; both test files reported failed                                                                     |
| Full lint/typecheck/test/build/E2E/G1/PostgreSQL suites                                             | Not run for this documentation-only audit; no passing claim                                                                                                                                                                                               |

Targeted command:

```text
vitest run packages/contracts/src/node-identity.test.ts packages/contracts/src/publications.test.ts packages/knowledge/src/source-credit-adapters.test.ts apps/web/src/components/SpecialistTools.test.tsx apps/web/src/lib/discussion-scope.test.ts
```

No tests were changed to make these checks pass. Source-credit failure was not repaired or fully diagnosed. Existing [Windows test reliability issue 162](https://github.com/dhuzard/oratlas/issues/162) is contextual evidence, not an automatic explanation for every failure.

## Pinned producer observations

Pins read from [pins.json](../../../../scripts/producer-contracts/fixtures/pins.json): MyST repository `1343684403`, commit `51336a5446b449d4d661a4f46d8f8913a0bac2cb`, manifest/claim schema `0.2.0`; verifier repository `1345833003`, commit `9b8455f5bfe9a411a7f1f06d13e4de97e539ac16`, API `1.0.0`, protocol `reported-statistic-consistency/0.1.0`.

| MyST `claims.jsonl`                | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| Pinned / committed Git blob        | `824de638f3fb9b8450d746460181032e42f23f0e265a4e5d4a0511e0db5eaf14` |
| Working-tree bytes actually tested | `4338480d8485fab64df3a7d6949c9af2f6703a2b4f3346cb66a6ab49db4e3c3f` |

[Read-only byte diagnostic](producer-byte-observation.json): working file has four CRLF sequences; committed blob has none; diagnostic LF normalization produces the pinned digest. This explains that observed digest mismatch. It does **not** convert failed acceptance into a pass. Producer bytes, pins, git attributes and protocol versions were left unchanged. The suite's verifier finding/report adapter test passed, but its end-to-end HTTP integration did not execute successfully because setup timed out. Full cross-language interoperability is not certified.

## Limits and reproduction

No user study, usage analytics, production inspection, real private-workspace test, full security audit or scientific benchmark was performed. Detailed inventory maturity refers to implementation presence and bounded observations. Frozen public fixtures and offline observations cannot establish live source grants or private isolation. Reproduce browser paths against a fresh guarded seed with the same explicit local environment; exact database-generated IDs will differ, so resolve claim links from the source page rather than copying the audit's transient IDs.

Final artifact checks: all ten requested documents exist; every one of the 37 tracked page routes has a source link in the inventory; all local Markdown link targets resolve; Prettier check passes for audit Markdown/JSON. Git reports only the new audit directory and no tracked production-file changes. The local audit server was stopped after evidence collection.
