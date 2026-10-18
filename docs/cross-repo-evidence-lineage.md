# Cross-repository evidence lineage (MVP v0.1, Gate G4)

Issue [#198](https://github.com/dhuzard/oratlas/issues/198) — stage **S4** of the evidence
interoperability MVP. It shows that the **existing** review-submission and canonical-graph pipeline
consumes real exported ComputationalReviewTemplate (CRT) claim / citation / relation JSONL and keeps a
traceable link to source-native Diggypaper evidence. It adds no second ingestion system, no Loom adapter
and no analysis worker.

**Status: engineering integration proof, not a validated real-data workflow.** The packet is
synthetic, it was not exported through Diggypaper's Finding Curation workflow (#46), and no real
immutable packet deposit exists. Gate G4 stays open until those exist (see [Open](#open)).

```
Diggypaper packet ─► CRT S2 importer ─► Phase 2 package (cluster_evidence.json) ─► Phase 2 / Phase 5 gates
 source-evidence-      (accepted /       + source-evidence-lineage.json
 packet/0.1.0           rejected /              │
                        withheld)               │  + reviewed claim→finding map (comprev.claim-finding-map/1)
                                                ▼
                        CRT lineage-to-links ─► comprev.evidence-packet-links/2
                                                ▼
                        CRT S3 exporter ─► review-manifest.json, knowledge/oratlas/{claims,citations,relations}.jsonl,
                                           source-native-trust.json (the declared `provenance` sidecar)
                                                ▼
   ORAtlas: inspectRepository → review manifest → extractKnowledgeWithOutcomes → submission → acceptance
                                                ▼
            GET /api/graph   ·   GET /api/claims/{version}/{claim}   ·   preserved-file API
```

## Evidence versus candidates

A shared DOI shows only that a finding and a claim concern the same paper. A paper can report several
outcomes, so a DOI match is **never** treated as evidence for a claim:

| Binding                | Comes from                                                                                                                          | Shown as                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `reviewed-mapping`     | A recorded decision in `knowledge/claim-finding-map.json`, bound to the exact lineage bytes and the imported Phase 2 finding digest | this claim's evidence (`findings`), with the decision reference, date and basis |
| `same-paper-candidate` | Exact DOI equality only                                                                                                             | a separate, collapsed `candidateFindings` list, labelled "not evidence"         |
| `binding-not-declared` | A `links/1` sidecar, which cannot say                                                                                               | a candidate                                                                     |

The fixture's review claim `clm_7659634fb095cdce` is mapped to `finding:cardin2009-f1` and
`finding:sohal2009-f1`. `finding:cardin2009-f2` is about the same paper but deliberately unmapped, so it
appears only as a candidate. This is the "two outcomes, one paper" case.

## What was added to ORAtlas

| Change                                                             | Why it is necessary                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SourceEvidenceLinks` contract + `projectSourceEvidenceLinks`      | ORAtlas already fetched and byte-preserved the manifest-declared `provenance` sidecar but never read it, so the lineage was unreachable except as a raw download.                                                    |
| `sourceEvidenceLinks` on the claim passport API / page             | The one public, read-only view that already joins a claim to its citations and TRUST. The view is **derived at read time from the preserved bytes**: nothing is stored, no schema change, no historical row touched. |
| `auditSourceEvidencePacket` (CI / reviewer tooling, never runtime) | Checks a held copy of the external packet against every declared field: digests, revision, verification level, passages, judgments.                                                                                  |
| Fixture, builder, verifier, tests, this document                   | Gate G4 evidence.                                                                                                                                                                                                    |

Unchanged: `extractKnowledgeWithOutcomes`, the manifest contract, submission/acceptance, the canonical
graph schema and `/api/graph`. `pnpm evidence-lineage:verify` checks that the five ingestion source files
are byte-identical to the pinned revision.

The projection fails closed and never throws on repository content:

- a sidecar whose `evidence_links` or `claims` contain anything but objects (`null`, arrays, primitives)
  is `sidecar-invalid`;
- conflicting records for one finding (differing in any declared field: citation, digests, revision,
  verification level, passages, native judgments, binding or this claim's decision) are all rejected as
  `ambiguous-source-relationship`. One packet id with two digests or two locators is rejected the same
  way, and two differing records for the claim are `claim-record-conflict`. Identical duplicates collapse,
  so the result is independent of record order;
- a link without a DOI is `doi-unconfirmed`: these links are DOI-based.

## Pins

| Repository                                                | Pinned commit                              | Role                                                                                     |
| --------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `dhuzard/diggypaper`                                      | `9cfd46c2b17903656eb06afe51ee8c69a7f75ae0` | contract (normative packet digest, §2.1) + reference validator (PR #50 merge)            |
| `Neuronautix/ComputationalReviewTemplate_trust-knowledge` | `ce8f29cf251aadfc4c44d109db65d15dd0f629c0` | S2 importer + gates, claim-finding map, `links/2` bridge, S3 exporter (CRT PR #15 merge) |
| `dhuzard/oratlas`                                         | `9cd3a0c284400b30dd0044cf3acb24df1047275d` | extractor/contract baseline the S3 exporter targets                                      |

Both upstream pins are merge commits on the upstreams' `main` branches. The builder also asserts that
Diggypaper's reference validator reports the same `packet_digest` (contract §2.1: SHA-256 of the exact
`manifest.json` bytes) that the sidecar carries.

The committed manifest of fixture digests is
`packages/extractor/src/fixtures/crt-diggypaper-evidence-lineage/digests.json`; pins and the five
baseline file digests are in `pins.json` beside it.

## Reproduce

Offline, no network, no sibling checkout (this is what CI runs). It checks the committed fixture and
drives the ORAtlas pipeline; it does **not** rerun the upstream producer tools:

```bash
pnpm install --frozen-lockfile
pnpm --filter @oratlas/db db:generate
pnpm exec vitest run packages/extractor/src/evidence-lineage.test.ts \
  apps/web/src/lib/crt-diggypaper-lineage.integration.test.ts \
  apps/web/src/components/SourceEvidenceLinksCard.test.tsx \
  scripts/evidence-lineage/verify-fixture.test.ts
pnpm evidence-lineage:verify          # pass/fail report; add --json for machines
```

Rerun the whole producer → consumer chain from the pinned upstreams and compare byte-for-byte (needs
both clean checkouts on the pinned commits, Node 22, and `python3` with `jsonschema` for Diggypaper's
validator):

```bash
git clone https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge ../crt
git -C ../crt checkout ce8f29cf251aadfc4c44d109db65d15dd0f629c0
git clone https://github.com/dhuzard/diggypaper ../diggypaper
git -C ../diggypaper checkout 9cfd46c2b17903656eb06afe51ee8c69a7f75ae0
pnpm evidence-lineage:build -- --crt-dir ../crt --diggypaper-dir ../diggypaper --check   # verify
pnpm evidence-lineage:build -- --crt-dir ../crt --diggypaper-dir ../diggypaper           # rewrite
```

The builder refuses an unpinned or dirty checkout. Stages, each run by the real upstream tool:

1. Write a canonical packet with CRT's packet writer.
2. Validate it with Diggypaper's `sep_validate.py`.
3. Import it with CRT's S2 importer, running its executable Phase 2 import gate and Phase 5 gate
   (`--check-gates`; a gate failure aborts the build). The Phase 2 package is kept.
4. Write the reviewed claim→finding map and bridge to `links/2` with CRT's `lineage-to-links.mjs`.
5. Export with CRT's S3 exporter.

The fixture contains no PDF, full text, credential or private file. Packet sentences are placeholder
text marked `[SYNTHETIC FIXTURE]`; only the bibliographic metadata of the review's own citations is real,
and the packet is declared `creation_method: synthetic-fixture`.

## Following one claim

| Hop                | Public representation                                                                           | What it shows                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| claim → works      | `GET /api/graph?seed=<claim node>&status=authoritative`                                         | `supports` → `10.1038/nature08002`, `partially-supports` → `10.1038/nature07991`; `trustAssessments: []`                                                             |
| claim → evidence   | `GET /api/claims/{versionId}/{localClaimId}` → `sourceEvidenceLinks.citations[].findings`       | `finding:cardin2009-f1`, `finding:sohal2009-f1`, each with its mapping decision and Phase 2 finding digest                                                           |
| claim → candidates | `sourceEvidenceLinks.citations[].candidateFindings`                                             | `finding:cardin2009-f2` (same paper, not mapped)                                                                                                                     |
| finding → passage  | `…findings[].passages` (same response)                                                          | passage id, **quote SHA-256**, quote state, match state, finding revision, packet verification level, native `seip-support-v1` status                                |
| packet bytes       | `sourceEvidenceLinks.packets[].locator` → DOI or GitHub release asset                           | where to fetch the exact packet; hash its `manifest.json` and compare with `packetSha256` (`auditSourceEvidencePacket` does this and re-checks every declared field) |
| sidecar bytes      | `GET /api/reviews/{slug}/versions/{versionId}/files/knowledge/oratlas/source-native-trust.json` | byte-identical to the repository file; its SHA-256 equals `sourceEvidenceLinks.sidecar.sha256`                                                                       |

The pipeline test runs the packet audit using **only the public passport response** as the
declaration, and a corrupted packet copy fails it. Nothing here is verified by ORAtlas: the digests are
the producer's declaration, and the audit is how a reader holding the packet checks them.

### Labels and boundaries

- **Producer.** Every finding is labelled `producer: diggypaper` and described as a statement about the
  cited article, "not a claim of this review". Two findings of one article share one snapshot digest; no
  independence is inferred.
- **Native assessment.** Computational Review TRUST v2 is shown in a collapsed panel as
  `origin: source-native`, `isOratlasAssessment: false`, `reAdjudicatedByOratlas: false`, with its own
  rubric version and native 0–100 scale. ORAtlas rechecks the sidecar's recorded digests of the review's
  `knowledge/claim_graph.json` and `knowledge/trust_score_report.json` against the bytes preserved with
  the version. If both match, `verifiedAgainstPreservedSources: true`. If either was not preserved, the
  value is labelled an **unverified source declaration**. A claim-graph mismatch makes the sidecar stale;
  a TRUST-report mismatch withholds the value (`nativeAssessmentWithheld`). It is never written to an
  ORAtlas TRUST table, edge or aggregate.
- **Packet.** `availability` is `locator-declared` (a DOI or GitHub release asset, linked unless it is
  an example DOI) or `location-not-declared`; `contentsImportedByOratlas: false`,
  `contentsVerifiedByOratlas: false`. Id, digest and location are the producer's declaration.
- **Repository content is untrusted.** It is rendered as escaped text only, and an example DOI is never
  linked.

### Rights

No Diggypaper quote text reaches the sidecar or any ORAtlas response; only quote digests do. **The
sidecar does contain other quoted text**: CRT copies the review's own `citation_contexts`, including the
passage sentences its TRUST validator checked (for example short abstract sentences of the cited
articles). The passport does not render them, but the preserved-file API serves the sidecar byte for byte.
Whether those excerpts may be republished is a rights decision for the review repository and is
**not** settled by this work.

## Failure cases

| Case                                                                                      | Detected by                                  | Result                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| DOI match without a reviewed decision                                                     | bridge + projection                          | `same-paper-candidate` / `binding-not-declared`; never in `findings`                                                                          |
| Reviewed map bound to other lineage bytes, wrong revision/digest, claim not citing paper  | CRT bridge                                   | bridge fails closed; nothing exported                                                                                                         |
| Imported finding edited after import                                                      | Phase 5 gate                                 | `text_access: "unknown"` no longer vouched; gate fails                                                                                        |
| Missing declared JSONL                                                                    | `extractKnowledgeWithOutcomes`               | artifact outcome not `loaded`; no relations; every link `no-citation-relation`                                                                |
| Invalid JSONL line                                                                        | `extractKnowledgeWithOutcomes`               | record skipped, warning names the file, `skippedCount: 1`                                                                                     |
| Edge to unknown citation                                                                  | `extractKnowledgeWithOutcomes`               | relation dropped with warning                                                                                                                 |
| Non-object entries (`null`, arrays, primitives) in the sidecar                            | projection                                   | `sidecar-invalid`; no exception                                                                                                               |
| Malformed nested link fields                                                              | projection                                   | `invalid-link-record`                                                                                                                         |
| Conflicting duplicate findings, claim records or packet locators (either order)           | projection                                   | `ambiguous-source-relationship` / `claim-record-conflict`; nothing chosen                                                                     |
| Missing DOI                                                                               | projection                                   | `doi-unconfirmed`                                                                                                                             |
| Wrong DOI                                                                                 | projection / audit                           | `doi-mismatch`; sibling findings unaffected                                                                                                   |
| Absent citation edge                                                                      | projection                                   | `no-citation-relation`; graph shows no such edge                                                                                              |
| Unknown citation key                                                                      | projection                                   | `citation-not-in-review`                                                                                                                      |
| Stale digest — claim text / claim graph                                                   | projection                                   | `sidecar-stale`; lineage **and** native score withheld                                                                                        |
| Stale digest — native TRUST report                                                        | projection                                   | native score withheld                                                                                                                         |
| Stale digest — packet / artifact                                                          | `auditSourceEvidencePacket`                  | `packet-digest-mismatch`, `artifact-hash-mismatch`, `artifact-length-mismatch`                                                                |
| Passage declaration drift (digest, match state, set, revision, verification, assessments) | `auditSourceEvidencePacket`                  | `passage-declaration-mismatch`, `passage-set-mismatch`, `finding-superseded`, `verification-level-mismatch`, `assessment-set-mismatch`        |
| Look-alike or non-https packet locator, half-declared passage fields                      | projection                                   | `invalid-link-record`; locator never linked                                                                                                   |
| Unauthorized / restricted evidence                                                        | packet validator, importer, audit, lifecycle | restricted unreviewed finding never reaches the sidecar; private packet refused; tombstoned version serves neither passport nor sidecar (404) |
| Duplicate version / import                                                                | existing acceptance                          | re-accept is idempotent; fresh inspection of the same commit is refused; rows unchanged                                                       |
| Reordered records                                                                         | projection + graph                           | identical projection and graph shape                                                                                                          |

## Gate G4 result

| Gate item                                                                                                      | Result                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean offline seeded test, exact commits, committed digest manifest, no network                                | **Pass** on the synthetic fixture                                                                                                               |
| Direct source links + full lineage inspectable via a public read-only view/API with producer/assessment labels | **Pass** on the synthetic fixture: claim → reviewed findings → passage digests → snapshot digest → packet digest and location; candidates apart |
| Faithful link to an externally preserved packet **or** explicitly marked unavailable                           | **Mechanism passes**; no real packet deposit exists, so the fixture uses an example DOI that is not linked                                      |
| Existing MyST/review ingestion and `/api/graph` suites pass unchanged; no historical record mutated            | **Pass**; earlier version rows asserted byte-identical                                                                                          |
| Reproducibility script/README and pass/fail report                                                             | **Pass**: this document, `pnpm evidence-lineage:verify`, `pnpm evidence-lineage:build --check`                                                  |
| **Real data**: a packet from Diggypaper Finding Curation, a real deposit, a reviewed real mapping              | **Open**                                                                                                                                        |

Phase 2 → Phase 5: the imported package passes CRT's executable Phase 2 import gate and Phase 5 gate,
and every reviewed mapping's digest is a finding of that package. **The Phase 2 gate passes with 24 checks
exempted** as pilot corpus-size exceptions (paper count, bibliography floor, effect-size and sample-size
rates, search and saturation logs, DOI resolution, full-text rates and others; listed in
`build-report.json`). These are executable ports of the skill gates; the agent-run skills remain the
authority, and nothing here shows that a real fixed-corpus import would satisfy the exempted checks.

## Open

- **Real-data workflow.** A packet exported by Diggypaper's Finding Curation (#46) from human-reviewed
  findings, deposited under a real DOI or GitHub release asset, with a real reviewed claim→finding map.
- **Rights** of the review's `citation_contexts` excerpts in the sidecar (above).
- **Pilot exemptions** in the Phase 2 import gate (above).
- **B4 — Graph → passport hop is not id-based.** A graph claim node exposes its database claim id and
  `reviewVersionId` but not the repository-local claim id, and `graphIdentity` is only populated for
  repository-backed nodes. Fixing it changes the public `/api/graph` response (federation #195).
- **B5 — Browser E2E not added.** "E2E" is the offline pipeline test over real route handlers plus
  server-render tests of the passport card.
- **Re-vendor** Diggypaper's reconciled contract README into CRT (`UPSTREAM-README.md` is still the
  `303e377` copy; the schemas are unchanged).

## Out of scope

Knowledge Loom / SciClaim2Explore, any analysis worker, importing or hosting packets, verifying packet
contents beyond digest binding, scientific support or replication claims, and any crosswalk between
Diggypaper judgments, Computational Review TRUST v2 and ORAtlas TRUST.
