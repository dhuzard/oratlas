# Public discovery GET batch

This additive batch starts from `main` at `a442e1d`. It adds no production logic,
private tables, producer code, sessions or access policy. Its fixtures are synthetic
public archive rows. A-only/B-only/A+B remain public-user labels; equivalent public
responses do not establish private workspace authorization or complete G1.

## Inventory and independently required outcomes

`publicDiscoveryScenarios()` defines **378 requests**: 63 cases under each of the
six existing principal/session recipes, with **186 expected 200s** and **192 declared
404s**. It covers **20 GET route files**, including the already-captured graph/search
files. Each file has a populated positive case for every principal. A static test
checks that these files currently export GET only and fails if another HTTP method
appears without coverage.

The batch exercises:

- Canonical confirmed graph, hidden/missing seeds, and two pages of node-only search.
  Graph cases use distinct reserved `192.0.2.0/24` fixture IPs so every principal and
  seed control starts with the same explicit rate budget. Rate headers are checked,
  never normalized away; these fixtures do not test rate-limit exhaustion or deployment
  proxy trust.
- Node archive pagination, detail, version list, exact version, wrong-version ownership,
  hidden nodes and a populated confirmed-edge DTO. The added edge is explicitly
  synthetic and editor-confirmed; existing source assertions remain unchanged and
  cannot become confirmation merely because the query needs a positive fixture.
- Claim passports with one exact citation relation; missing, hidden and an actually
  populated tombstoned claim all deny. Public landscape returns at least one scoped
  recommendation without treating it as a truth/quality score.
- Review/current and exact-version reads, a wrong-owner version, a deterministic diff
  with a known added claim/file, and tombstoned diff denial. The existing public review
  tombstone is a **200 redacted DTO**, not an invented 404: assertions require empty
  claims/citations/contributors, omitted version metadata, and withheld text.
- All nine review export formats: CSL, BibTeX, RIS, JATS, RO-Crate, PROV, preservation
  package, scholarly JSON and DocMap. Every positive case checks format-specific data
  or text markers, exact media type/disposition, `nosniff`, `no-store` and `Pragma`;
  each format has missing and pre-seeded tombstoned version denials.
- A separate publication with one source occurrence, content document, human author,
  software production assertion and explicit reviewed publication relationship.
  Assertions keep `canonicalBinding: null`, source-declared strength and software
  versus human channels separate. Bibliographic/source metadata grants no authority.

Other route files, mutation methods, populated protocol/TRUST adjudication/execution/
challenge subrecords, corrupt persisted-data branches, pages, deployed caching,
non-HTTP channels and actual private data are outside this batch. This inventory is
not a claim that those surfaces are covered elsewhere.

## Native synthetic publication contract

The discovery publication uses a closed-schema MyST **0.3.0** manifest; its claim
stream retains the supported claim-record **0.2.0** format. Exact committed
`fixtures/discovery.manifest.json` bytes are captured in the SQL, with their byte
length, SHA-256 and capture-slot identity. The manifest declares the human author's
key, kind, name, role and position, and the software actor and drafting activity.
Contributor provenance points to that same exact manifest capture. Source capture
identity is derived from its declared path using the production identity helper.
The source-set digest is explicitly synthetic: SHA-256 of canonical JSON containing
the single source path and its content SHA-256. It is not evidence of a producer run.

`discovery-native-fixtures.test.ts` parses these bytes with the production native
schema and normalizes them with `normalizeMystPublication`, then compares the
resulting adapter, contributor/provenance, production and occurrence fields with
committed SQL. It also binds the native claim stream, source bytes and document
corpus to their hashes. Negative controls independently reject contributor and
production declarations under frozen manifest 0.2.0, and reject native contributor
normalization without the exact manifest capture. No production schema is relaxed.

This repair followed independent review of the original probe fixture: its 0.2
adapter and underspecified captured JSON did not support the persisted author and
production DTOs, even though all HTTP expectations passed. The corrected fixture is
synthetic contract evidence only; native producer execution and scientific validation
remain separate acceptance claims. Fixture row counts and HTTP expectations do not
change.

## Root integration

1. Import `publicDiscoveryScenarios` into the shared scenario program and append its
   cases after the common reset and before new discovery-related mutations. This name
   intentionally avoids the older private `discoveryScenarios()` helper.
2. Add `bodyIncludes?: readonly string[]` to the shared expectation/comparator and its
   rejection regression. The root owns this approved extension. These markers are
   independent assertions; a golden must never bless a malformed/error export.
3. Use `bindDiscoveryRoutes` with **literal imports in the `.g1.spec.ts` runner** for
   each `DISCOVERY_ROUTE_MODULES` entry. The declarative module imports no application
   internals and performs no computed import. Preserve the already-existing graph and
   search loaders when composing maps.
4. Load `fixtures/discovery-fixtures.sql` after `public-fixtures.sql` inside every
   reset transaction. `DISCOVERY_FIXTURE_COUNT_DELTAS` records the exact additional
   rows. Merge deltas with other batches; newly granted tables without a listed insert
   remain empty unless another batch populates them. No base row is updated.
5. Add only the measured `DISCOVERY_ADDITIONAL_SELECT_GRANTS` missing from the integrated
   role. The twelve exported entries have per-handler reasons. No additional write,
   ownership, CREATE or role membership privilege is required.
6. Integrate exact GET entries into the method-aware coverage manifest. Regenerate and
   independently inspect the golden only after real restricted-role program checks pass.
   The dedicated full harness must repeat reset/baseline/after captures and run T-ROLE,
   public grant equality and cleanup; this module does not replace those checks.

## Observed local evidence

On PostgreSQL 16.15 / Node 24.16.0, a separate loopback cluster and database were seeded
with only the public base and discovery SQL. A temporary handler probe used the real
Next request context and actual production handlers, signed session recipes and blocked
outbound HTTP. The initial probe caught a malformed occurrence target and an incorrectly
assumed source-assertion/confirmed-edge equivalence; fixtures and expectations were
corrected without weakening the schemas or changing production code.

A direct restricted public role started with the existing G1 grant list. Missing-table
failures identified only twelve necessary SELECT dependencies. After those grants,
**all 378 requests passed** their status/body/header/JSON/text-marker expectations and
cross-principal response comparisons in one capture. Additional write grants were not
added. This single capture is not the root's full repeated G1 acceptance run, does not
prove private-schema/RLS isolation and is not a reviewed golden.

Probe evidence remains in `/tmp/oratlas-g1-discovery-pg/probe-capture.json` and
`restricted-probe.log`. The temporary probe source is kept alongside that evidence,
not shipped as an additional test runner. A separate, initially empty database on the
same task-owned cluster is available to the root through the protected environment file
`/tmp/oratlas-g1-integration-pg.env`; credentials are not recorded here.

The committed offline tests check matrix coherence, populated outcomes, source/credit
boundaries, append-only fixture count deltas, exact loader injection and method inventory.
Run them with:

```bash
pnpm exec vitest run scripts/private-workspace-g1/discovery-scenarios.test.ts scripts/private-workspace-g1/discovery-native-fixtures.test.ts scripts/architecture-boundaries.test.ts
pnpm exec tsc --project scripts/private-workspace-g1/tsconfig.json
```

The root remains responsible for integrated PostgreSQL, complete CI and independent
review. No network producer, real research data or hosted/private enablement was used.
