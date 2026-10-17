# Cross-repository evidence lineage (MVP v0.1, Gate G4)

Issue [#198](https://github.com/dhuzard/oratlas/issues/198) — stage **S4** of the evidence
interoperability MVP. It proves that the **existing** review-submission and canonical-graph pipeline
consumes real exported ComputationalReviewTemplate (CRT) claim / citation / relation JSONL and keeps
a traceable link to source-native Diggypaper evidence. It adds no second ingestion system, no Loom
adapter and no analysis worker.

```
Diggypaper                      CRT                                   ORAtlas (this repo)
source-evidence-packet/0.1.0 ─► S2 importer ─► source-evidence-    ─► S3 exporter ─► claims.jsonl
 (external, rights-aware)        (lineage        lineage.json   bridge  (comprev.     citations.jsonl
                                  sidecar)                              evidence-     relations.jsonl
                                                                        packet-links  source-native-trust.json
                                                                        /1)           review-manifest.json
                                                                                          │
   inspectRepository → review manifest → extractKnowledgeWithOutcomes → submission → acceptance
                                                                                          │
                       GET /api/graph   ·   GET /api/claims/{version}/{claim}   ·   preserved-file API
```

## What was added to ORAtlas

| Change                                                             | Why it is necessary                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SourceEvidenceLinks` contract + `projectSourceEvidenceLinks`      | ORAtlas already fetched and byte-preserved the manifest-declared `provenance` sidecar but never read it, so the lineage was unreachable except as a raw download.                                                    |
| `sourceEvidenceLinks` on the claim passport API / page             | The one public, read-only view that already joins a claim to its citations and TRUST. The view is **derived at read time from the preserved bytes**: nothing is stored, no schema change, no historical row touched. |
| `auditSourceEvidencePacket` (CI / reviewer tooling, never runtime) | Resolves a held copy of the external packet down to quote digest, match state and snapshot digest.                                                                                                                   |
| Fixture, builder, verifier, tests, this document                   | Gate G4 evidence.                                                                                                                                                                                                    |

Unchanged: `extractKnowledgeWithOutcomes`, the manifest contract, submission/acceptance, the canonical
graph schema and `/api/graph`. `pnpm evidence-lineage:verify` proves the five ingestion source files are
byte-identical to the pinned revision.

## Pins

| Repository                                                | Pinned commit                              | Role                                                          |
| --------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| `dhuzard/diggypaper`                                      | `d7e97e375de75c4e67cd94e0f4efb078f8f4282f` | `source-evidence-packet/0.1.0` contract + reference validator |
| `Neuronautix/ComputationalReviewTemplate_trust-knowledge` | `47b7acd20b7bde65d61ea23d584ef0d300400d28` | S2 importer (#10/#13) and S3 exporter (#11/#12)               |
| `dhuzard/oratlas`                                         | `9cd3a0c284400b30dd0044cf3acb24df1047275d` | extractor/contract baseline the S3 exporter targets           |

The committed manifest of fixture digests is
`packages/extractor/src/fixtures/crt-diggypaper-evidence-lineage/digests.json`; pins and the five
baseline file digests are in `pins.json` beside it.

## Reproduce

Offline, no network, no sibling checkout (this is what CI runs):

```bash
pnpm install --frozen-lockfile
pnpm --filter @oratlas/db db:generate
pnpm exec vitest run packages/extractor/src/evidence-lineage.test.ts \
  apps/web/src/lib/crt-diggypaper-lineage.integration.test.ts \
  apps/web/src/components/SourceEvidenceLinksCard.test.tsx \
  scripts/evidence-lineage/verify-fixture.test.ts
pnpm evidence-lineage:verify          # pass/fail report; add --json for machines
```

Rebuild the fixture byte-for-byte from the pinned upstreams (needs both clean checkouts on the pinned
commits, Node 22 and `python3` with `jsonschema` for Diggypaper's validator):

```bash
git clone https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge ../crt
git -C ../crt checkout 47b7acd20b7bde65d61ea23d584ef0d300400d28
git clone https://github.com/dhuzard/diggypaper ../diggypaper
git -C ../diggypaper checkout d7e97e375de75c4e67cd94e0f4efb078f8f4282f
pnpm evidence-lineage:build -- --crt-dir ../crt --diggypaper-dir ../diggypaper --check   # verify
pnpm evidence-lineage:build -- --crt-dir ../crt --diggypaper-dir ../diggypaper           # rewrite
```

The builder refuses an unpinned or dirty checkout. Stages, each run by the real upstream tool:
(1) write a canonical packet with CRT's packet writer; (2) validate it with Diggypaper's
`sep_validate.py`; (3) import it with CRT's S2 importer; (4) bridge accepted lineage entries to
`comprev.evidence-packet-links/1` (see blocker B2); (5) export with CRT's S3 exporter.

The fixture contains no PDF, full text, credential or private file. Packet sentences are placeholder
text marked `[SYNTHETIC FIXTURE]`; only the bibliographic metadata of the review's own citations is
real, and the packet is declared `creation_method: synthetic-fixture`.

## Following one claim

Claim `clm_7659634fb095cdce` cites two papers and has three producer findings, two of them about one
article:

| Hop                | Public representation                                                                           | What it shows                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| claim → works      | `GET /api/graph?seed=<claim node>&status=authoritative`                                         | `supports` → `10.1038/nature08002`, `partially-supports` → `10.1038/nature07991`; `trustAssessments: []`                           |
| claim → findings   | `GET /api/claims/{versionId}/{localClaimId}` → `sourceEvidenceLinks`                            | per citation: `finding:cardin2009-f1`, `finding:cardin2009-f2`, `finding:sohal2009-f1`, packet id + digest, source-snapshot digest |
| sidecar bytes      | `GET /api/reviews/{slug}/versions/{versionId}/files/knowledge/oratlas/source-native-trust.json` | byte-identical to the repository file; its SHA-256 equals `sourceEvidenceLinks.sidecar.sha256`                                     |
| findings → passage | `auditSourceEvidencePacket(packetFiles, declaredLinks)` (needs the packet)                      | quote digest, `exact` match state, snapshot ref and digest, native `seip-support-v1` judgments bound to that digest                |

The final hop is deliberately **not** a public ORAtlas feature: the sidecar does not carry passage
data (blocker B1) and ORAtlas has not imported the packet.

### Labels and boundaries

- **Producer** — every finding is labelled `producer: diggypaper` and described as a statement about
  the cited article, "not a claim of this review". Two findings of one article share one snapshot
  digest; no independence is inferred.
- **Assessment** — native Computational Review TRUST v2 is shown as `origin: source-native`,
  `isOratlasAssessment: false`, `reAdjudicatedByOratlas: false`, with its own rubric version and native
  0–100 scale. It is never written to an ORAtlas TRUST table, edge or aggregate. Passage-level
  Diggypaper judgments are reported as `not-carried-by-sidecar`, not omitted.
- **Packet** — `availability: location-not-declared`, `contentsImportedByOratlas: false`,
  `contentsVerifiedByOratlas: false`. The packet id and digest are the producer's declaration.
- **Repository content is untrusted** — rendered as escaped text only; an example DOI is never linked.

## Failure cases

| Case                                    | Detected by                                  | Result                                                                                                                                        |
| --------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing declared JSONL                  | `extractKnowledgeWithOutcomes`               | artifact outcome not `loaded`; no relations; every link `no-citation-relation`                                                                |
| Invalid JSONL line                      | `extractKnowledgeWithOutcomes`               | record skipped, warning names the file, `skippedCount: 1`                                                                                     |
| Edge to unknown citation                | `extractKnowledgeWithOutcomes`               | relation dropped with warning                                                                                                                 |
| Stale digest — claim text / claim graph | projection (`claim_text_sha256`, graph sha)  | `sidecar-stale`; lineage **and** native score withheld                                                                                        |
| Stale digest — packet / artifact        | `auditSourceEvidencePacket`                  | `packet-digest-mismatch`, `artifact-hash-mismatch`, `artifact-length-mismatch`                                                                |
| Wrong DOI                               | projection / audit                           | `doi-mismatch`; sibling findings unaffected                                                                                                   |
| Absent citation edge                    | projection                                   | `no-citation-relation`; graph shows no such edge                                                                                              |
| Unknown citation key                    | projection                                   | `citation-not-in-review`                                                                                                                      |
| Ambiguous source relationship           | projection                                   | every participant `ambiguous-source-relationship`; nothing chosen                                                                             |
| Unauthorized / restricted evidence      | packet validator, importer, audit, lifecycle | restricted unreviewed finding never reaches the sidecar; private packet refused; tombstoned version serves neither passport nor sidecar (404) |
| Duplicate version / import              | existing acceptance                          | re-accept is idempotent; fresh inspection of the same commit is refused; rows unchanged                                                       |
| Reordered records                       | projection + graph                           | identical projection and graph shape (order-independent)                                                                                      |
| Malformed link / sidecar                | projection                                   | `invalid-link-record` / `sidecar-invalid`                                                                                                     |

## Gate G4 result

Verified on the commit that introduced this document: `pnpm lint`, `pnpm typecheck`,
`pnpm schema:check`, `pnpm openapi:check`, `pnpm format:check`, the production `next build` and the whole
vitest suite pass (232 files / 1460 tests passed; the 16 skipped are the pre-existing Postgres-only
tests). Pre-existing ingestion, canonical-graph and passport suites were not edited.

| Gate item                                                                                                    | Result                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Clean offline seeded test, exact commits, committed digest manifest, no network                              | **Pass** — `crt-diggypaper-lineage.integration.test.ts`, 16 scenarios; `verify-fixture` PASS         |
| Direct source links + full lineage inspectable via public read-only view/API with producer/assessment labels | **Partial** — claim → findings → packet/snapshot **digests** are public; the passage hop is not (B1) |
| Faithful link to an externally preserved packet **or** explicitly marked unavailable                         | **Pass** — `location-not-declared`, never flattened                                                  |
| Existing MyST/review ingestion and `/api/graph` suites pass unchanged; no historical record mutated          | **Pass** — full suite below; earlier version rows asserted byte-identical                            |
| Reproducibility script/README and pass/fail report                                                           | **Pass** — this document, `pnpm evidence-lineage:verify`                                             |

## Blockers and gaps

Blockers are outside this repository; none prevents merging this PR, but B1 prevents declaring Gate G4
fully met.

- **B1 — The S3 sidecar cannot carry passage-level lineage.** `comprev.evidence-packet-links/1`
  records only `finding_id`, `source_sha256`, `packet {id, sha256}`, `cite_key`, `doi`, `claim_ids`.
  There is no finding revision, passage id, quote digest, match state, verification level, assessment
  reference or **packet locator**, and `source_sha256` is undefined in the link schema (this fixture
  uses the article's source-snapshot digest). Owner: CRT exporter (issue #11 follow-up).
- **B2 — No S2 → S3 bridge.** S2 emits `source-evidence-lineage.json`; S3 reads
  `comprev.evidence-packet-links/1`. Nothing connects them. `bridgeLineageToLinks` in
  `scripts/evidence-lineage/build-fixture.mjs` is a stand-in that binds a finding to a review citation
  by exact DOI equality only. Owner: CRT. The packet digest convention used here (SHA-256 of
  `manifest.json` bytes) also needs to be specified upstream.
- **B3 — No real Diggypaper-exported packet.** The packet is synthetic, written with CRT's packet
  writer and accepted by Diggypaper's reference validator at the pin. The Finding Curation export
  (#46) was not exercised end to end, as the issue permits.
- **B4 — Graph → passport hop is not id-based.** A graph claim node exposes its database claim id and
  `reviewVersionId` but not the repository-local claim id, and the passport's `graphIdentity` is only
  populated for repository-backed nodes. A client maps node → passport by version + anchor/text. A
  stable `claim` ↔ passport link belongs to the federation work (#195).
- **B5 — Browser E2E not added.** "E2E" here is the offline pipeline test driving the real route
  handlers against a real database, plus server-render tests of the passport card. A Playwright spec
  would need the fixture seeded into the dev database, which would add rows to seed data.

Decision for the maintainer: the passport shows the native TRUST v2 label and 0–100 value, clearly
marked source-native. If even that adjacency is unwanted, drop `nativeAssessment` from the projection;
nothing else depends on it.

## Out of scope

Knowledge Loom / SciClaim2Explore, any analysis worker, importing or hosting packets, verifying packet
contents beyond digest binding, scientific support or replication claims, and any crosswalk between
Diggypaper judgments, Computational Review TRUST v2 and ORAtlas TRUST.
