# Source-derived POC review corpus

ORAtlas includes three pinned public repositories as a small scientific stress-test corpus. These
records are example fixtures, not editorial acceptance, peer review, or complete mirrors of the
upstream publications.

| Repository                                                                                        | Pinned commit                                                                                                                   | Corpus role                 | ORAtlas coverage                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| [ComputationalReviewTemplate](https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate) | [`7312d15`](https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate/commit/7312d15c12443031d9806a0550a4e665bd45ca92) | Structural control          | Repository identity and compatibility only; zero scientific claims |
| [ComputationalReviewVIP](https://github.com/AllenNeuralDynamics/ComputationalReviewVIP)           | [`a04f01d`](https://github.com/AllenNeuralDynamics/ComputationalReviewVIP/commit/a04f01d37994c6a14e4bc7ec1b3d0a869144e98d)      | AI-assisted critical review | Four representative synthesis claims and six evidence links        |
| [openscope_p3_data_release_paper](https://github.com/jeromelecoq/openscope_p3_data_release_paper) | [`4cb9f31`](https://github.com/jeromelecoq/openscope_p3_data_release_paper/commit/4cb9f3125a103d8eaa14650302a4ffdf3eb74daf)     | Reproducible data release   | Four study-design/resource/provenance claims and six links         |

## Why these records are different

The template is a negative control: it can be structurally compatible without being a scientific
review. It must not contribute claims or evidence to Explore.

The VIP repository is an evidence-rich AI-assisted review. Its upstream audit reports 3,816
citation triples, including 403 residual `INSUFFICIENT_EVIDENCE` outcomes. ORAtlas imports a small,
manually curated subset so readers can exercise claim passports, evidence relations, TRUST
limitations, Explore, discussion, and formal challenges. The subset must never be described as the
complete upstream audit.

The OpenScope repository is a data release rather than a completed review. Its records deliberately
separate study-design capabilities from scientific findings. At the pinned commit, the abstract and
final limitations are unfinished, authorship is provisional, figures and metadata still have open
migration work, and the DANDI identifiers reference draft datasets.

## Current ingestion gap

Running deterministic ingestion against each repository succeeds, but returns zero structured
claims, citations, relations, and TRUST assessments. The repositories contain MyST, bibliographies,
evidence packages, and provenance, but do not publish the `review-manifest.json` plus ORAtlas JSONL
contracts needed for lossless claim-level ingestion.

```bash
pnpm ingest https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate
pnpm ingest https://github.com/AllenNeuralDynamics/ComputationalReviewVIP
pnpm ingest https://github.com/jeromelecoq/openscope_p3_data_release_paper
```

The seeded representative records bridge that POC gap transparently. Every source-derived detail
page displays its coverage, limitations, and suggested fixes. It does not preserve a synthetic
article under an upstream filename; readers are sent to the pinned repository and published site.

## POC walkthrough

1. Seed the database and open Archive. Confirm that the template is visibly a structural control,
   while the VIP review and OpenScope data release are source-derived example records.
2. Open the VIP record. Inspect the synthesis, model-derived, and translational claims, their exact
   DOI links, relation-specific limitations, and the seeded critique threads.
3. Open the OpenScope record. Confirm that `study-design`, `resource-capability`, and
   `hypothesis-capability` claims remain qualified and are not phrased as results.
4. Search Explore for `disinhibition`, `prediction-violation`, or `mismatch responses`. Follow
   the graph back to exact review-version claims and evidence.
5. Sign in and file a formal challenge against an exact claim, relation, adjudication, or TRUST
   criterion. The POC evaluation card supplies concrete questions and fixes to test.

## Highest-value follow-up fixes

1. Add an upstream export from the Computational Review pipeline to ORAtlas claim, citation,
   relation, and TRUST JSONL, including per-triple verification outcomes.
2. Add first-class claim semantics for `finding`, `synthesis`, `model-derived`, `study-design`,
   `resource-capability`, and `hypothesis-capability`, with result-only filters in Explore.
3. Add structured species, area, layer, state, subtype, cohort, modality, and dataset-version facets
   so comparisons do not silently cross incompatible scopes.
4. Promote immutable dataset releases and analysis outputs to first-class evidence nodes instead of
   leaving dataset identifiers only inside citation metadata.
5. Require human adjudication before a source-derived POC record becomes a non-example public
   archive record.
