# ORAtlas UI/UX rules

> **ORAtlas is a GitHub-native archive and interaction layer for AI-generated scientific reviews.**
> Readers must be able to inspect a preserved review, move to a claim and its evidence, discuss or
> challenge it, and derive new synthesis without overwriting the original record.

This file is the normative UI and release contract. See
[`docs/product-experience.md`](docs/product-experience.md) for the information architecture,
scientific semantics, and current implementation boundary.

## 1. Make the operating model obvious

A first-time visitor should understand within ten seconds that:

- reviews originate in **public GitHub repositories** built with, forked from, or compatible with
  the official
  [AllenNeuralDynamics Computational Review Template](https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate);
- ORAtlas captures an **exact release, tag, or commit** rather than accepting a manuscript upload;
- GitHub sign-in is required for deposit and attributable participation; and
- archive acceptance is an **editorial decision**, not peer review, correctness, or consensus.

The primary actions are **Reviews**, **Explore evidence**, **Compare**, and **Create & deposit**.
Review generation happens in the Allen workflow; ORAtlas explains that workflow and then accepts
an exact repository version for editorial consideration.

### Five-step author flow

1. Create a repository from the AllenNeuralDynamics template.
2. Configure the title and scope, then run the template review pipeline.
3. Check the review, evidence packages, figures, provenance, and pipeline gates; do not present
   partial output as complete.
4. Push the complete repository and publish an immutable tag or GitHub release. A Zenodo DOI is
   recommended, not required.
5. Sign in to ORAtlas, paste the repository URL, choose the exact source version, verify the
   extracted metadata and validation report, and deposit it for acceptance, changes, or rejection.

## 2. Preserve the review first and anchor participation

- The complete review must remain easy to read; the graph and Atlas Discuss must not replace or
  bury it. Figures and plots must be readable, expandable, captioned, and linked to exact source
  provenance.
- The default path is **review → claim passport → evidence → assessment or disagreement → preserved
  source context**. Repository, release/tag/commit, version, AI/run provenance, and editorial status
  remain visible.
- Comments may address the whole review, an exact claim, or a selected passage in a preserved MyST
  page. Formal challenges may target an exact claim, claim–evidence relation, or assessment
  criterion.
- Support attributed questions, concerns, suggestions, endorsements, and one-level replies. Clearly
  distinguish open discussion, formal challenge, TRUST assessment, and editorial decision.
- A comment never edits an accepted review in place. An addressed suggestion must link to its
  resolution, replacement GitHub version, diff, and lineage. Historical-version discussions remain
  readable but read-only; moderation leaves an auditable tombstone.
- Graphs disclose why records appear, result bounds or truncation, and honest empty states. Demo
  content is unmistakably labelled.

### Current safe-rendering boundary

The reader captures the Markdown and notebook files explicitly listed by the pinned `myst.yml`
table of contents, parses them into a sanitized MyST AST, and renders source TRUST v2 assertions as
a provenance-distinct layer. Repository HTML, iframes, styles, and plugins are never executed.
Relative figures resolve against the exact accepted commit. Passage comments store a source hash,
page path, rendered-text position, and quote-with-context selector. They are version-bound,
highlighted in the reader, and exposed as public W3C-style JSON-LD annotations for agents. A reply
inherits its parent passage; neither comments nor annotations mutate the archived source.

## 3. Let the knowledge graph evolve without hidden mutation

- Reviews, immutable versions, claims, evidence, figures, datasets, code, and typed relationships
  are canonical graph entities with stable identities and immutable versions.
- Comments, challenges, and update or link proposals are attributable records anchored to exact
  graph subjects. **A comment is not automatically a scientific graph edge.**
- Humans and LLMs may propose a relationship; only an explicit editor-confirmed proposal becomes a
  public canonical edge. Never invent an edge to force connectivity. An editor-approved new root or
  isolated concept is valid.
- Every node and edge exposes provenance, exact version, status (`proposed` or `confirmed`), and
  change history. Semantic similarity may suggest a link but never silently merges identities,
  evidence works, or conflicting interpretations.

## 4. Make Explore and Atlas Discuss one grounded workflow

- Explore starts from an explicit question, topic, or interest and offers a small set of explanatory
  starter paths. Complete indexes and specialist controls use progressive disclosure.
- The selected graph path and source records remain visible before or beside Atlas Discuss.
- Cross-review synthesis uses canonical identities, confirmed relations, or clearly labelled
  reviewable proposals. Shared underlying sources are grouped so repeated citation does not create
  false consensus; disagreements, scope differences, missing evidence, and uncertainty remain
  visible.
- Every generated statement cites exact node versions and source reviews and highlights its
  supporting path. Model/provider, task or prompt, run, evidence packet, and generation status are
  inspectable.
- An LLM may propose links or draft a synthesis. It may not rewrite a preserved review or confirm an
  edge. A saved or published synthesis is a **separate, versioned derivative record** with source
  lineage, software provenance, staleness detection, and an accountable editorial decision.

## 5. End-to-end release gate

A route or button is not sufficient. Releases must verify these journeys with real, non-demo
accepted records:

1. Home → review archive → Create & deposit → Allen template guidance → clear deposit instructions.
2. GitHub sign-in → repository inspection → exact-version capture → validation → editorial status →
   public immutable review.
3. Full review and figures → claim → evidence → assessment/disagreement → provenance.
4. Select a preserved passage → attributed comment → author reply → formal challenge or update
   proposal → resolution or new version → diff and lineage.
5. Explore at least two reviews → grounded multi-review answer → exact source highlighting → draft
   or published synthesis, without mutating source reviews.

Fail the release when a core action is a placeholder, demo content appears real, the graph shows
unrelated records, an accepted review cannot be read in full, or an LLM statement cannot resolve to
exact source versions.

## Language rules

Use **deposit repository**, **accepted into the archive**, **AI-generated synthesis**, **proposed
relation**, and **editor-confirmed relation**. Avoid **upload paper**, **peer-reviewed**, **truth
score**, or **consensus** unless the underlying record explicitly supports that wording.
